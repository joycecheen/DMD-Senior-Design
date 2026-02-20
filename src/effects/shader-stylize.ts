import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';

const SPLAT_URL = 'https://sparkjs.dev/assets/splats/cat.spz';

export class ShaderStylizeEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'shader-stylize',
    name: 'Shader Stylization',
    description: '',
    category: 'stylization',
  };

  private splatMesh: SplatMesh | null = null;
  private sceneManager: SceneManager | null = null;
  private animateT = dyno.dynoFloat(0);

  private params = {
    intensity: 0.8,
  };

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;

    this.splatMesh = new SplatMesh({ url: SPLAT_URL });
    this.splatMesh.quaternion.set(1, 0, 0, 0);
    this.splatMesh.position.set(0, -0.5, -2.5);
    this.splatMesh.scale.set(0.5, 0.5, 0.5);

    this.applyShader();

    sceneManager.scene.add(this.splatMesh);
    await this.splatMesh.initialized;
  }

  private applyShader(): void {
    if (!this.splatMesh) return;

    const animateT = this.animateT;
    const intensity = this.params.intensity;

    this.splatMesh.objectModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            t: 'float',
            intensity: 'float',
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 styleHash(vec3 p) {
                return fract(sin(p * 127.1 + vec3(311.7, 74.7, 269.5)) * 43758.5453);
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 pos = ${inputs.gsplat}.center;
              vec3 scales = ${inputs.gsplat}.scales;
              vec4 col = ${inputs.gsplat}.rgba;
              vec3 hv = styleHash(pos);

              // Sparkle: elongated highlights, desaturate base, bright white sparkle + twinkle
              float elongate = mix(1.0, 3.2, ${inputs.intensity});
              ${outputs.gsplat}.scales = vec3(
                scales.x * elongate,
                scales.y * 0.45,
                scales.z * 0.45
              );
              float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
              vec3 desaturated = vec3(gray) * 0.2;
              vec3 sparkleColor = vec3(1.0, 1.0, 1.0);
              float glow = smoothstep(0.08, 0.45, gray) * ${inputs.intensity};
              float twinkle = 0.7 + 0.6 * hv.x;
              vec3 spark = desaturated + sparkleColor * glow * twinkle * 3.5;
              vec3 finalColor = mix(col.rgb, spark, ${inputs.intensity});
              ${outputs.gsplat}.rgba.rgb = clamp(finalColor, 0.0, 1.0);
            `),
        });

        gsplat = d.apply({
          gsplat,
          t: animateT,
          intensity: dyno.dynoFloat(intensity),
        }).gsplat;

        return { gsplat };
      }
    );

    this.splatMesh.updateGenerator();
  }

  update(_deltaTime: number, elapsed: number): void {
    if (!this.splatMesh) return;
    this.animateT.value = elapsed;
    this.splatMesh.needsUpdate = true;
  }

  buildGui(gui: GUI): void {
    gui.add(this.params, 'intensity', 0, 1, 0.01)
      .name('Intensity')
      .onChange(() => this.applyShader());
  }

  dispose(): void {
    if (this.splatMesh) {
      this.sceneManager?.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }
  }
}
