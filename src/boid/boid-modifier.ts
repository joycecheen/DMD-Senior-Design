// boid modifier overview
import * as three from 'three';
import { dyno } from '@sparkjsdev/spark';

export interface BoidModifierOptions {
  offsetTexUniform: ReturnType<typeof dyno.dynoSampler2D>;
  velTexUniform: ReturnType<typeof dyno.dynoSampler2D>;
  gpgpuSizeUniform: ReturnType<typeof dyno.dynoFloat>;
  streakUniform: ReturnType<typeof dyno.dynoFloat>;
  glowUniform: ReturnType<typeof dyno.dynoFloat>;
}

export function createBoidObjectModifier(opts: BoidModifierOptions) {
  const { offsetTexUniform, velTexUniform, gpgpuSizeUniform, streakUniform, glowUniform } = opts;
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          uOffsetTex: 'sampler2D',
          uVelTex: 'sampler2D',
          uGpgpuSize: 'float',
          uStreak: 'float',
          uGlow: 'float',
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            vec4 qFromX(vec3 d) {
              float dx = clamp(d.x, -1.0, 1.0);
              if (dx > 0.99999) return vec4(0.0, 0.0, 0.0, 1.0);
              if (dx < -0.99999) return vec4(0.0, 1.0, 0.0, 0.0);
              vec3 axis = normalize(vec3(0.0, -d.z, d.y));
              float cosHalf = sqrt((1.0 + dx) * 0.5);
              float sinHalf = sqrt(max(0.0, 1.0 - dx) * 0.5);
              return vec4(axis * sinHalf, cosHalf);
            }
            vec4 qNlerp(vec4 a, vec4 b, float t) {
              vec4 bb = dot(a, b) < 0.0 ? -b : b;
              return normalize(mix(a, bb, t));
            }
          `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            int idx = ${inputs.gsplat}.index;
            float fi = float(idx);
            float sz = ${inputs.uGpgpuSize};
            float y = floor(fi / sz);
            float x = fi - y * sz;
            vec2 uv = (vec2(x, y) + 0.5) / sz;

            vec4 off = texture(${inputs.uOffsetTex}, uv);
            vec4 vel = texture(${inputs.uVelTex}, uv);
            ${outputs.gsplat}.center = ${inputs.gsplat}.center + off.xyz;

            float speed = max(off.w, length(vel.xyz));
            float speedNorm = clamp(speed * 0.9, 0.0, 1.0);

            if (speed > 0.04) {
              vec3 dir = vel.xyz / max(speed, 1e-4);

              
              vec4 qAlign = qFromX(dir);
              ${outputs.gsplat}.quaternion = qNlerp(${inputs.gsplat}.quaternion, qAlign, speedNorm);

              float streakAmt = speedNorm * ${inputs.uStreak};
              vec3 s = ${inputs.gsplat}.scales;
              ${outputs.gsplat}.scales = vec3(
                s.x * (1.0 + streakAmt * 3.5),
                s.y * max(0.45, 1.0 - streakAmt * 0.5),
                s.z * max(0.45, 1.0 - streakAmt * 0.5)
              );

              
              vec3 ember = vec3(1.9, 1.05, 0.3);
              ${outputs.gsplat}.rgba.rgb = ${inputs.gsplat}.rgba.rgb
                + ember * pow(speedNorm, 1.4) * ${inputs.uGlow};

              ${outputs.gsplat}.rgba.w = clamp(
                ${inputs.gsplat}.rgba.w * (1.0 + speedNorm * 0.45),
                0.0, 1.0
              );
            }
          `),
      });
      gsplat = d.apply({
        gsplat,
        uOffsetTex: offsetTexUniform,
        uVelTex: velTexUniform,
        uGpgpuSize: gpgpuSizeUniform,
        uStreak: streakUniform,
        uGlow: glowUniform,
      }).gsplat;
      return { gsplat };
    }
  );
}

export function createBoidUniforms(
  offsetTex: three.Texture,
  velTex: three.Texture,
  gpgpuSize: number,
) {
  return {
    offsetTex: dyno.dynoSampler2D(offsetTex, 'boidOffset'),
    velTex: dyno.dynoSampler2D(velTex, 'boidVel'),
    gpgpuSize: dyno.dynoFloat(gpgpuSize),
    streak: dyno.dynoFloat(1.5),
    glow: dyno.dynoFloat(1.0),
  };
}
