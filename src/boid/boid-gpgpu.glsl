// boid gpgpu overview
uniform float uPass;

uniform float uDeltaTime;
uniform float uTime;

uniform float uSeparation;
uniform float uAlignment;
uniform float uCohesion;
uniform float uHomeSpring;
uniform float uMaxSpeed;
uniform float uDesiredSepDist;

uniform vec3 uDisturbancePos;
uniform float uDisturbanceRadius;
uniform float uHoverStrength;
uniform float uFlockGate;

uniform vec3 uOrbitAxis;

uniform float uOrbitSwirl;
uniform float uOrbitAttract;

uniform float uGpgpuSize;

uniform sampler2D uBasePosTex;
uniform sampler2D uNeighborTex0;
uniform sampler2D uNeighborTex1;

vec2 indexToUV(float idx) {
  float y = floor(idx / uGpgpuSize);
  float x = idx - y * uGpgpuSize;
  return (vec2(x, y) + 0.5) / uGpgpuSize;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;

  vec4 home = texture2D(uBasePosTex, uv);
  vec4 offset = texture2D(uOffsetTex, uv);
  vec4 vel = texture2D(uVelTex, uv);

  float dt = min(uDeltaTime, 1.0 / 60.0);

  if (uPass < 0.5) {
    vec3 pos = home.xyz + offset.xyz;

    vec4 nIdx0 = texture2D(uNeighborTex0, uv);
    vec4 nIdx1 = texture2D(uNeighborTex1, uv);
    float nIdx[8];
    nIdx[0] = nIdx0.r; nIdx[1] = nIdx0.g; nIdx[2] = nIdx0.b; nIdx[3] = nIdx0.a;
    nIdx[4] = nIdx1.r; nIdx[5] = nIdx1.g; nIdx[6] = nIdx1.b; nIdx[7] = nIdx1.a;

    
    vec3 sepAcc = vec3(0.0);
    vec3 avgVel = vec3(0.0);
    vec3 avgOffset = vec3(0.0);
    int count = 0;

    
    float sepThresh = uDesiredSepDist * 0.7;

    for (int i = 0; i < 8; i++) {
      vec2 nuv = indexToUV(nIdx[i]);
      vec4 nHome = texture2D(uBasePosTex, nuv);
      vec4 nOffset = texture2D(uOffsetTex, nuv);
      vec4 nVel = texture2D(uVelTex, nuv);
      vec3 nPos = nHome.xyz + nOffset.xyz;

      vec3 diff = pos - nPos;
      float d = length(diff);
      if (d > 1e-5 && d < sepThresh) {
        
        float w = 1.0 - d / sepThresh;
        sepAcc += (diff / max(d, 1e-5)) * w * w;
      }
      avgOffset += nOffset.xyz;
      avgVel += nVel.xyz;
      count++;
    }

    vec3 force = vec3(0.0);

    
    if (count > 0 && uFlockGate > 0.0) {
      avgOffset /= float(count);
      avgVel /= float(count);
      force += sepAcc * uSeparation * uFlockGate;
      force += (avgVel - vel.xyz) * uAlignment * uFlockGate;
      
      force += (avgOffset - offset.xyz) * uCohesion * uFlockGate;
    }

    
    force -= offset.xyz * uHomeSpring;

    
    vec3 toCursor = uDisturbancePos - pos;
    float cursorDist = length(toCursor);
    if (cursorDist < uDisturbanceRadius && cursorDist > 1e-5 && uHoverStrength > 0.0) {
      vec3 dirToCursor = toCursor / cursorDist;
      float outerFalloff = 1.0 - smoothstep(uDisturbanceRadius * 0.55, uDisturbanceRadius, cursorDist);

      
      float desiredRadius = uDisturbanceRadius * 0.35;
      float radialError = cursorDist - desiredRadius;
      vec3 radialForce = -dirToCursor * radialError * uOrbitAttract;

      
      vec3 axis = length(uOrbitAxis) > 1e-4 ? normalize(uOrbitAxis) : vec3(0.0, 1.0, 0.0);
      vec3 tangent = cross(dirToCursor, axis);
      float tangLen = length(tangent);
      if (tangLen < 1e-4) {
        tangent = normalize(cross(dirToCursor, vec3(0.3, 1.0, 0.7)));
      } else {
        tangent /= tangLen;
      }
      vec3 swirlForce = tangent * uOrbitSwirl;

      force += (radialForce + swirlForce) * outerFalloff * uHoverStrength;
    }

    vec3 newVel = vel.xyz + force * dt;
    float speed = length(newVel);
    if (speed > uMaxSpeed) {
      newVel *= uMaxSpeed / speed;
    }
    newVel *= exp(-0.5 * dt);

    gl_FragColor = vec4(newVel, length(newVel));
  } else {
    vec3 newOffset = offset.xyz + vel.xyz * dt;
    float offLen = length(newOffset);
    if (offLen > 3.0) {
      newOffset *= 3.0 / offLen;
    }
    gl_FragColor = vec4(newOffset, length(vel.xyz));
  }
}
