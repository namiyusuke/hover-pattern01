import * as THREE from 'three'
import GUI from 'lil-gui'
import './style.css'
import vertexShader from './shaders/vertex.glsl'
import fragmentShader from './shaders/fragment.glsl'

// ===================================================================
//  メンバーデータ（増減・写真差し替えはここだけ）
//  photo に画像URLを入れるとそれを使用、null ならイニシャルの自動生成。
// ===================================================================
const members = [
  { company:"Lorem Inc.",   first:"Lorem",  last:"Ipsum",   roles:["Lorem ipsum","Dolor sit amet"],
    bio:"Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod.",
    photo:"https://picsum.photos/id/1018/800/1000",   tint:["#bcd2e8","#7da4c7"] },   // 山と雲
  { company:"Dolor Co.",    first:"Dolor",  last:"Amet",    roles:["Consectetur","Adipiscing elit"],
    bio:"Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    photo:"https://picsum.photos/id/1015/800/1000",   tint:["#cdd6cf","#8f9b8f"] },   // 渓谷の川
  { company:"Sit Studio",   first:"Consectetur", last:"Elit", roles:["Tempor incididunt","Ut labore"],
    bio:"Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.",
    photo:"https://picsum.photos/id/1036/800/1000",   tint:["#cfe0d6","#7da48c"] },   // 滝
  { company:"Amet Lab.",    first:"Tempor", last:"Labore",  roles:["Quis nostrud","Exercitation"],
    bio:"Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.",
    photo:"https://picsum.photos/id/1043/800/1000",   tint:["#dfe6dd","#a9bda4"] },   // 森
]

// ===================================================================
//  lil-gui で調整するパラメータ（全プレーン共通）
// ===================================================================
const params = {
  warp:     0.24,  // 最大ゆがみ量（① 氷の割れ目を強く）
  scale:    4.5,   // ノイズの細かさ（周波数）（① 割れ目を細かく）
  speed:    0.0,   // 揺らぎの速さ
  focus:    0.7,   // カーソル集中度（小さいほど一点集中）
  contrast: 1.08,  // ホバー時のコントラスト
  easing:   0.04,  // ホバー追従の滑らかさ
  noiseType:2,     // 0:Cos*Sin 1:Value 2:Simplex（Simplex=凍りついた質感）
  shadowMin:0.75,  // f3 の暗部の下限
  metaric:  true,  // メタリック表現の ON/OFF
  metal:    0.85,   // メタリックの強さ
  ice:      0.0,  // ② 寒色ティントの強さ
  iceColor: "#fff", // ② 寒色の色
  melt:     0,  // 下に溶ける（ドリップ）の強さ
}

// ── DOM 構築 ──
const grid = document.getElementById("grid")
const slots = [] // { el, member }
members.forEach((m, i) => {
  const mirror = (i % 2 === 1) ? " p-member--mirror" : ""
  const initials = (m.first[0]||"") + (m.last[0]||"")
  const roles = m.roles.map(r => `<div>${r}</div>`).join("")
  const el = document.createElement("article")
  el.className = "p-member" + mirror
  el.innerHTML = `
    <div class="p-member__photo"><span class="p-member__initial">${initials}</span></div>
    <div class="p-member__meta">
      <div class="p-member__company">${m.company}</div>
      <div class="p-member__name">${m.first}${m.last}</div>
      <div class="p-member__bio">${m.bio || ""}</div>
      <div class="p-member__roles">${roles}</div>
    </div>`
  grid.appendChild(el)
  slots.push({ el: el.querySelector(".p-member__photo"), card: el, member: m })
})

// ===================================================================
//  プレースホルダー写真をテクスチャとして生成（差し替え用）
// ===================================================================
function makePortraitTexture(m){
  const W=800, H=1000, c=document.createElement("canvas")
  c.width=W; c.height=H; const ctx=c.getContext("2d")
  const g=ctx.createLinearGradient(0,0,0,H)
  g.addColorStop(0, m.tint[0]); g.addColorStop(1, m.tint[1])
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H)
  // やわらかいビネット
  const r=ctx.createRadialGradient(W/2,H*0.42,0,W/2,H*0.42,W*0.8)
  r.addColorStop(0,"rgba(255,255,255,0.18)"); r.addColorStop(1,"rgba(0,0,0,0.18)")
  ctx.fillStyle=r; ctx.fillRect(0,0,W,H)
  // イニシャル
  ctx.fillStyle="rgba(40,40,40,0.55)"
  ctx.textAlign="center"; ctx.textBaseline="middle"
  ctx.font=`700 ${Math.round(H*0.18)}px ${getComputedStyle(document.body).fontFamily}`
  ctx.fillText((m.first[0]||"")+(m.last[0]||""), W/2, H*0.45)
  const t=new THREE.CanvasTexture(c)
  t.minFilter=THREE.LinearFilter; t.magFilter=THREE.LinearFilter
  t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping; t.colorSpace=THREE.SRGBColorSpace
  t.needsUpdate=true; return t
}

// 外部 URL のダミー画像を CORS 対応で読み込む（picsum.photos など）
const texLoader=new THREE.TextureLoader()
texLoader.crossOrigin="anonymous"
function loadPhoto(url){
  const t=texLoader.load(url)
  t.minFilter=THREE.LinearFilter; t.magFilter=THREE.LinearFilter
  t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping; t.colorSpace=THREE.SRGBColorSpace
  return t
}

// ===================================================================
//  Three.js（ピクセル等倍の正射影。1ワールド単位 = 1px、原点は画面中央）
// ===================================================================
let renderer, scene, camera
const items = []
const canvas = document.getElementById("gl")

function initGL(){
  if (!window.WebGLRenderingContext) return false
  try{
    renderer=new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true })
  }catch(e){ return false }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  renderer.setClearColor(0x000000, 0) // 透過（写真以外は DOM が透ける）
  renderer.outputColorSpace=THREE.SRGBColorSpace

  scene=new THREE.Scene()
  const w=innerWidth,h=innerHeight
  camera=new THREE.OrthographicCamera(-w/2,w/2,h/2,-h/2,-1000,1000)

  const geo=new THREE.PlaneGeometry(1,1)
  slots.forEach(s=>{
    const tex=s.member.photo ? loadPhoto(s.member.photo) : makePortraitTexture(s.member)
    const uniforms={
      uTex:{value:tex}, uTime:{value:0}, uHover:{value:0},
      uHoverPos:{value:new THREE.Vector2(0.5,0.5)},
      uPlaneAspect:{value:0.8}, uTexAspect:{value:0.8},
      uWarp:{value:params.warp}, uScale:{value:params.scale}, uSpeed:{value:params.speed},
      uFocus:{value:params.focus}, uContrast:{value:params.contrast},
      uNoiseType:{value:params.noiseType}, uShadowMin:{value:params.shadowMin},
      uMetaric:{value:params.metaric}, uMetal:{value:params.metal},
      uIce:{value:params.ice}, uIceColor:{value:new THREE.Color(params.iceColor)},
      uMelt:{value:params.melt},
    }
    const mat=new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader })
    const mesh=new THREE.Mesh(geo,mat); scene.add(mesh)
    const item={ el:s.el, mesh, uniforms, hoverTarget:0 }
    items.push(item)

    // ── ホバー検知（カード全体＝写真＋テキストで受ける） ──
    //   テキスト側をホバーした場合もカーソルを写真の矩形にマッピングし、
    //   0〜1 にクランプして集中点を決める（外側でも近い端に寄る）。
    const clamp01=v=>Math.min(1,Math.max(0,v))
    s.card.addEventListener("pointerenter", ()=>{ item.hoverTarget=1 })
    s.card.addEventListener("pointerleave", ()=>{ item.hoverTarget=0 })
    s.card.addEventListener("pointermove", e=>{
      const rect=s.el.getBoundingClientRect()   // 写真の矩形を基準にする
      item.uniforms.uHoverPos.value.set(
        clamp01((e.clientX-rect.left)/rect.width),
        clamp01(1.0-(e.clientY-rect.top)/rect.height)   // UV は上が 1
      )
    })
  })

  // スロットの中身は WebGL が覆うのでイニシャルは隠す
  slots.forEach(s=>{ const ph=s.el.querySelector(".p-member__initial"); if(ph) ph.style.visibility="hidden" })
  return true
}

// DOM の矩形に合わせてプレーンを毎フレーム配置（スクロール／リサイズ追従）
function layout(){
  const w=innerWidth;
  const h=innerHeight;
  items.forEach(it=>{
    const r=it.el.getBoundingClientRect()
    it.mesh.scale.set(r.width, r.height, 1)
    it.mesh.position.set(
      r.left + r.width/2 - w/2,
      -(r.top + r.height/2 - h/2),
      0
    )
    it.uniforms.uPlaneAspect.value=r.width/r.height
  })
}

function onResize(){
  const w=innerWidth,h=innerHeight
  renderer.setSize(w,h)
  camera.left=-w/2; camera.right=w/2; camera.top=h/2; camera.bottom=-h/2
  camera.updateProjectionMatrix()
}

const clock={ start:performance.now() }
function tick(){
  const time=(performance.now()-clock.start)/1000
  items.forEach(it=>{
    it.uniforms.uTime.value=time
    it.uniforms.uWarp.value=params.warp
    it.uniforms.uScale.value=params.scale
    it.uniforms.uSpeed.value=params.speed
    it.uniforms.uFocus.value=params.focus
    it.uniforms.uContrast.value=params.contrast
    it.uniforms.uNoiseType.value=params.noiseType
    it.uniforms.uShadowMin.value=params.shadowMin
    it.uniforms.uMetaric.value=params.metaric
    it.uniforms.uMetal.value=params.metal
    it.uniforms.uIce.value=params.ice
    it.uniforms.uIceColor.value.set(params.iceColor)
    it.uniforms.uMelt.value=params.melt
    it.uniforms.uHover.value += (it.hoverTarget-it.uniforms.uHover.value)*params.easing // イージング
  })
  layout()
  renderer.render(scene,camera)
  requestAnimationFrame(tick)
}

// ── lil-gui パネル ──
function buildGUI(){
  const gui=new GUI({ title:"Domain Warp" })
  gui.add(params,"warp",0,0.4,0.005).name("歪み量")
  gui.add(params,"scale",1,8,0.1).name("ノイズ細かさ")
  gui.add(params,"speed",0,3,0.05).name("速さ")
  gui.add(params,"focus",0.1,1.5,0.02).name("カーソル集中")
  gui.add(params,"contrast",1,1.5,0.01).name("ホバー時コントラスト")
  gui.add(params,"easing",0.02,0.3,0.01).name("追従の滑らかさ")
  gui.add(params,"noiseType",{ "Cos*Sin":0, "Value":1, "Simplex":2 }).name("ノイズ種類")
  gui.add(params,"shadowMin",0,1,0.01).name("暗部の下限")
  gui.add(params,"metaric").name("メタリック")
  gui.add(params,"metal",0,1.5,0.01).name("メタリックの強さ")
  const ice=gui.addFolder("氷の質感")
  ice.add(params,"ice",0,1,0.01).name("寒色ティント")
  ice.addColor(params,"iceColor").name("寒色")
  ice.add(params,"melt",0,1,0.01).name("下に溶ける")
}

if(initGL()){
  onResize()
  window.addEventListener("resize", onResize)
  tick()
//  buildGUI()   // GUI は常に非表示（params の初期値で固定）
}
// initGL が false の場合は CSS のイニシャル表示がそのまま残る（フォールバック）
