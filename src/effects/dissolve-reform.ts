import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';

const SPLAT_URL = 'https://sparkjs.dev/assets/splats/cat.spz';

export class DissolveReformEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'dissolve-reform',
    name: 'Dissolve & Reform',
    description: '',
    category: 'animation',
  };

  private splatMesh: SplatMesh | null = null;
  private animateT = dyno.dynoFloat(0);
  private params = {
    dissolve: 0,
    autoPlay: true,
    speed: 1.0,
  };
  private sceneManager: SceneManager | null = null;

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;

    this.splatMesh = new SplatMesh({ url: SPLAT_URL });
    this.splatMesh.quaternion.set(1, 0, 0, 0);
    this.splatMesh.position.set(0, -0.5, -2.5);
    this.splatMesh.scale.set(0.5, 0.5, 0.5);

    // Set up the dissolve objectModifier using Dyno
    this.splatMesh.objectModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const animateT = this.animateT;
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            t: 'float',
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 dissolveHash(vec3 p) {
                return fract(sin(p * 123.456) * 123.456);
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 localPos = ${inputs.gsplat}.center;
              vec3 hashVal = dissolveHash(localPos);

              // Stagger: each splat starts dissolving at a different t
              float startTime = hashVal.x * 0.8;
              float localT = clamp((${inputs.t} - startTime) / 0.5, 0.0, 1.0);

              // Direction: outward from origin + randomness
              vec3 moveDir = normalize(localPos + (hashVal - 0.5) * 0.6);
              float randomSpeed = 0.5 + hashVal.y;
              float moveAmount = localT * 2.0 * randomSpeed;

              ${outputs.gsplat}.center = localPos + moveDir * moveAmount;

              // Fade opacity
              ${outputs.gsplat}.rgba.w *= 1.0 - smoothstep(0.3, 1.0, localT);

              // Shift color toward white
              ${outputs.gsplat}.rgba.rgb = mix(
                ${inputs.gsplat}.rgba.rgb,
                vec3(1.0),
                localT * 0.6
              );

              // Shrink slightly at peak
              ${outputs.gsplat}.scales *= mix(1.0, 0.3, localT);
            `),
        });

        gsplat = d.apply({
          gsplat,
          t: animateT,
        }).gsplat;

        return { gsplat };
      }
    );

    sceneManager.scene.add(this.splatMesh);
    await this.splatMesh.initialized;
  }

  update(_deltaTime: number, elapsed: number): void {
    if (!this.splatMesh) return;

    if (this.params.autoPlay) {
      // Ping-pong between 0 and 1.3 (covers full stagger range)
      const cycle = elapsed * this.params.speed * 0.3;
      this.params.dissolve = (Math.sin(cycle) * 0.5 + 0.5) * 1.3;
    }

    this.animateT.value = this.params.dissolve;
    this.splatMesh.needsUpdate = true;
  }

  buildGui(gui: GUI): void {
    gui.add(this.params, 'dissolve', 0, 1.3, 0.01).name('Dissolve').listen()
      .onChange(() => { this.params.autoPlay = false; });
    gui.add(this.params, 'autoPlay').name('Auto Play');
    gui.add(this.params, 'speed', 0.1, 3.0, 0.1).name('Speed');
  }

  dispose(): void {
    if (this.splatMesh) {
      this.sceneManager?.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }
  }
}
