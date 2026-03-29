// Wave sim fragment: R = u, G = u_prev (GPUComputationRenderer).

uniform float uTime;
uniform float uDeltaTime;
uniform float uWaveSpeed;
uniform float uDamping;
uniform float uFlowFieldStrength;
uniform float uFlowFieldFrequency;
uniform float uGpgpuSize;
uniform float uMeshSpacing;
uniform float uKNeighbors;
uniform float uBoundaryAbsorb;

uniform sampler2D uNeighborTex0;
uniform sampler2D uNeighborTex1;
uniform sampler2D uWeightTex0;
uniform sampler2D uWeightTex1;
uniform sampler2D uBasePosTex;
uniform sampler2D uBoundaryTex;

uniform vec4 uSources[8];
uniform vec4 uSourceParams[8];
uniform int uNumSources;

vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
float permute(float x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt(float r) { return 1.79284291400159 - 0.85373472095314 * r; }

vec4 grad4(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;
  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;
  return p;
}

float simplexNoise4d(vec4 v) {
  const float F4 = 0.309016994374947451;
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);

  vec4 i = floor(v + dot(v, vec4(F4)));
  vec4 x0 = v - i + dot(i, C.xxxx);

  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;

  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);

  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;

  i = mod289(i);
  float j0 = permute(permute(permute(permute(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute(permute(permute(permute(
    i.w + vec4(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4(i1.x, i2.x, i3.x, 1.0));

  vec4 ip = vec4(1.0/294.0, 1.0/49.0, 1.0/7.0, 0.0);
  vec4 p0 = grad4(j0, ip);
  vec4 p1 = grad4(j1.x, ip);
  vec4 p2 = grad4(j1.y, ip);
  vec4 p3 = grad4(j1.z, ip);
  vec4 p4 = grad4(j1.w, ip);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  p4 *= taylorInvSqrt(dot(p4, p4));

  vec3 m0 = max(0.6 - vec3(dot(x0,x0), dot(x1,x1), dot(x2,x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3,x3), dot(x4,x4)), 0.0);
  m0 = m0 * m0; m1 = m1 * m1;
  return 49.0 * (dot(m0*m0, vec3(dot(p0,x0), dot(p1,x1), dot(p2,x2)))
    + dot(m1*m1, vec2(dot(p3,x3), dot(p4,x4))));
}

vec2 indexToUV(float idx) {
  float y = floor(idx / uGpgpuSize);
  float x = idx - y * uGpgpuSize;
  return (vec2(x, y) + 0.5) / uGpgpuSize;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 state = texture2D(uWaveState, uv);
  vec4 basePos = texture2D(uBasePosTex, uv);
  float boundary = texture2D(uBoundaryTex, uv).r;

  float u = state.r;
  float uPrev = state.g;

  vec4 nIdx0 = texture2D(uNeighborTex0, uv);
  vec4 nIdx1 = texture2D(uNeighborTex1, uv);
  vec4 nWt0  = texture2D(uWeightTex0, uv);
  vec4 nWt1  = texture2D(uWeightTex1, uv);

  float laplacian = 0.0;
  laplacian += nWt0.r * (texture2D(uWaveState, indexToUV(nIdx0.r)).r - u);
  laplacian += nWt0.g * (texture2D(uWaveState, indexToUV(nIdx0.g)).r - u);
  laplacian += nWt0.b * (texture2D(uWaveState, indexToUV(nIdx0.b)).r - u);
  laplacian += nWt0.a * (texture2D(uWaveState, indexToUV(nIdx0.a)).r - u);
  laplacian += nWt1.r * (texture2D(uWaveState, indexToUV(nIdx1.r)).r - u);
  laplacian += nWt1.g * (texture2D(uWaveState, indexToUV(nIdx1.g)).r - u);
  laplacian += nWt1.b * (texture2D(uWaveState, indexToUV(nIdx1.b)).r - u);
  laplacian += nWt1.a * (texture2D(uWaveState, indexToUV(nIdx1.a)).r - u);

  float h2 = uMeshSpacing * uMeshSpacing;
  float trueLaplacian = laplacian * uKNeighbors / max(h2, 1e-12);

  float noiseVal = simplexNoise4d(vec4(basePos.xyz * uFlowFieldFrequency, uTime * 0.1));
  float localSpeed = uWaveSpeed * (1.0 + uFlowFieldStrength * noiseVal);

  float dt = uDeltaTime;
  float maxCfl = 0.45 / sqrt(uKNeighbors);
  float cfl = localSpeed * dt / max(uMeshSpacing, 1e-8);
  if (cfl > maxCfl) {
    dt = maxCfl * uMeshSpacing / max(localSpeed, 1e-8);
  }

  float uNext = 2.0 * u - uPrev + (localSpeed * dt) * (localSpeed * dt) * trueLaplacian;

  uNext -= uDamping * dt * (u - uPrev);

  for (int i = 0; i < 8; i++) {
    if (i >= uNumSources) break;

    float active = uSourceParams[i].w;
    if (active < 0.5) continue;

    vec2 srcUV = uSources[i].xy;
    float srcRadius = uSources[i].z;
    float srcAmp = uSources[i].w;
    float srcFreq = uSourceParams[i].x;
    float srcStart = uSourceParams[i].y;
    float srcType = uSourceParams[i].z;

    float dist = length(uv - srcUV);
    if (dist < srcRadius) {
      float falloff = 1.0 - smoothstep(0.0, srcRadius, dist);
      float t = uTime - srcStart;

      float injection = 0.0;
      float frameDt = uDeltaTime;
      if (srcType < 0.5) {
        injection = srcAmp * falloff * smoothstep(0.0, 0.02, t) * (1.0 - smoothstep(0.02, 0.08, t));
      } else if (srcType < 1.5) {
        injection = srcAmp * falloff * sin(6.28318 * srcFreq * t) * frameDt;
      } else {
        float sigma = 1.0 / (srcFreq * 0.5 + 0.1);
        float envelope = exp(-t * t / (2.0 * sigma * sigma));
        injection = srcAmp * falloff * envelope * sin(6.28318 * srcFreq * t) * frameDt;
      }
      uNext += injection;
    }
  }

  uNext *= mix(1.0, 0.92, boundary * uBoundaryAbsorb);

  gl_FragColor = vec4(uNext, u, 0.0, 0.0);
}
