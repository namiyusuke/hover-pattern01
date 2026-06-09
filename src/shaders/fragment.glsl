precision highp float;

#define NUM_OCTAVES 2

varying vec2 vUv;
uniform sampler2D uTex;
uniform float uTime, uHover, uPlaneAspect, uTexAspect;
uniform float uWarp, uScale, uSpeed, uFocus, uContrast;
uniform vec2 uHoverPos;
uniform int uNoiseType;     // 0:Cos*Sin 1:Value 2:Simplex（domain-warping-demo と同じ）
uniform float uShadowMin;   // f3 の暗部の下限
uniform bool uMetaric;      // メタリック表現の ON/OFF
uniform float uMetal;       // メタリックの強さ（ホバー時に乗る量）
uniform float uIce;         // 寒色ティントの強さ
uniform vec3 uIceColor;     // 寒色の色
uniform float uMelt;        // 下に溶ける（ドリップ）の強さ

float map(float value, float min1, float max1, float min2, float max2){
  return min2 + (value - min1) * (max2 - min2) / (max1 - min1);
}

// 0: Cos*Sin (元のノイズ)
float noiseCosSin(in vec2 p){
  return cos(p.x) * sin(p.y);
}

// 1: Value Noise (ハッシュベース)
float hash(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noiseValue(in vec2 p){
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  ) * 2.0 - 1.0;
}

// 2: Simplex Noise
vec3 permute(vec3 x){ return mod(((x * 34.0) + 1.0) * x, 289.0); }
float noiseSimplex(in vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float noise(in vec2 p){
  if (uNoiseType == 1) return noiseValue(p);
  if (uNoiseType == 2) return noiseSimplex(p);
  return noiseCosSin(p);
}

float fbm(in vec2 st){
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < NUM_OCTAVES; i++){
    v += a * noise(st);
    st = st * 2.0;
    a *= 0.5;
  }
  return v;
}

// テクスチャをプレーンに cover 配置
vec2 coverFit(vec2 uv){
  vec2 st=uv;
  if(uPlaneAspect>uTexAspect) st.y=(uv.y-0.5)*(uTexAspect/uPlaneAspect)+0.5;
  else                        st.x=(uv.x-0.5)*(uPlaneAspect/uTexAspect)+0.5;
  return st;
}

void main(){
  vec2 uv=vUv;

  // ── ドメインワーピング（domain-warping-demo と同じ二段構成 f1 → f2） ──
  //   プレーンのアスペクトを補正してノイズ座標 st を作り、
  //   f1 で一度歪ませた座標から f2（ずらしベクトル場）を生成する。
  float aspect = uPlaneAspect;
  vec2 normalizeUvScale = vec2(min(aspect, 1.0), min(1.0 / aspect, 1.0));
  vec2 st = (uv - 0.5) * normalizeUvScale + 0.5;
  st += vec2(0.1, 2.0);
  st *= uScale;

  vec2 f1 = vec2(
    fbm(st + vec2(0.2)),
    fbm(st + vec2(0.1))
  );

  vec2 f2 = vec2(
    fbm(st + (6.0 * f1) + (0.10 * uSpeed * uTime)),
    fbm(st + (6.0 * f1) + (0.12 * uSpeed * uTime))
  );

  // カーソル近傍を強く、外側もほんのり歪ませる
  float d=distance(uv,uHoverPos);
  float local=mix(0.35,1.0,smoothstep(uFocus,0.0,d));
  float amt=uHover*local;

  // f2（符号付きのずらし場）をテクスチャの変位として使う
  vec2 warped=uv + f2*uWarp*amt;      // uWarp = 最大ゆがみ量

  // ── 下に溶ける（ドリップ） ──
  //   縦に引き伸ばしたノイズで列状のしずくを作り、時間で下へ流す。
  //   warped.y を +方向へずらす＝写真の内容が下へ垂れて見える。
  //   下にいくほど(1.0-uv.y)強く垂れるようにして溶け落ちる感じを出す。
  float dripN = fbm(vec2(st.x*2.0, st.y*0.5) - vec2(0.0, uTime*0.15*uSpeed));
  float drip  = (dripN*0.5 + 0.5) * (0.3 + 0.7*(1.0-uv.y));
  warped.y += drip * uMelt * amt;

  vec3 col=texture2D(uTex,coverFit(warped)).rgb;

  // ホバー時にわずかに明るさとコントラストを上げる（生っぽさ）
  col=mix(col, (col-0.5)*uContrast+0.5+0.02, uHover);

  // ── メタリック表現（domain-warping-demo と同じ f3 の作り方） ──
  if(uMetaric){
    float f3 = fbm(st + uWarp * f2);
    f3 = pow(f3, 4.0) + pow(f3, 3.0) + pow(f3, 2.0);
    f3 = map(f3, 0.0, 1.0, uShadowMin, 1.0);
    vec3 metaric = vec3(pow(f3, 3.0) + pow(f3, 3.0)) * 1.2;
    vec3 metal = mix(col, metaric, 0.5);
    metal *= metal * 1.7;
    col = mix(col, metal, clamp(uHover*uMetal, 0.0, 1.0));
  }

  // ── ② 寒色ティント（青白い氷の色味へ寄せる。ホバーで強まる） ──
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 cold = mix(col, vec3(lum) * uIceColor, 0.85);
  col = mix(col, cold, uIce * (0.4 + 0.6 * uHover));

  gl_FragColor=vec4(col,1.0);
}
