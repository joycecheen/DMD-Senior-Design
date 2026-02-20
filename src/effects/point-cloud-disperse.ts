import * as THREE from 'three';
import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';

const SPLAT_URL = 'https://sparkjs.dev/assets/splats/cat.spz';

// World-space Z of the model center (splat mesh position z)
const MODEL_PLANE_Z = -2.5;

export class PointCloudDisperseEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'point-cloud-disperse',
    name: 'Point Cloud Hover',
    description: '',
    category: 'interactive',
  };

  private splatMesh: SplatMesh | null = null;
  private sceneManager: SceneManager | null = null;
  private raycaster = new THREE.Raycaster();
  private brushOrigin = dyno.dynoVec3(new THREE.Vector3(1000, 1000, 1000));
  private brushRadius = dyno.dynoFloat(0.35);
  private pushStrength = dyno.dynoFloat(0.12);
  private disperseIntensity = dyno.dynoFloat(0); // 0 when cursor still, ramps on movement, decays when still
  private animateT = dyno.dynoFloat(0);

  private lastBrushOrigin = new THREE.Vector3(1000, 1000, 1000);
  private currentDisperseIntensity = 0;
  private readonly DISPERSE_RAMP = 0.35;
  /** Lerp factor toward 0 when cursor still: smaller = slower, smoother return */
  private readonly DISPERSE_RETURN_SPEED = 0.005;

  private params = {
    brushSize: 0.35,
    pushStrength: 0.12,
  };

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;

    this.splatMesh = new SplatMesh({
      url: SPLAT_URL,
      onFrame: () => {
        if (this.splatMesh) this.splatMesh.needsUpdate = true;
      },
    });

    this.splatMesh.quaternion.set(1, 0, 0, 0);
    this.splatMesh.position.set(0, -0.5, -2.5);
    this.splatMesh.scale.set(0.5, 0.5, 0.5);

    // Point cloud look at intensity 1: shrink to dots + color jitter
    this.splatMesh.objectModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: { gsplat: dyno.Gsplat },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 pointCloudHash(vec3 p) {
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
              vec3 hv = pointCloudHash(pos);
              float dotScale = 0.15;
              ${outputs.gsplat}.scales = scales * dotScale;
              vec3 jitter = (hv - 0.5) * 0.25;
              ${outputs.gsplat}.rgba.rgb = clamp(col.rgb + jitter, 0.0, 1.0);
            `),
        });
        return { gsplat: d.apply({ gsplat }).gsplat };
      }
    );

    this.splatMesh.worldModifier = this.buildDisperseModifier();

    sceneManager.scene.add(this.splatMesh);
    await this.splatMesh.initialized;

    this.splatMesh.updateGenerator();
  }

  private buildDisperseModifier() {
    const { brushOrigin, brushRadius, pushStrength, disperseIntensity, animateT } = this;
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            brushOrigin: 'vec3',
            brushRadius: 'float',
            pushStrength: 'float',
            disperseIntensity: 'float',
            t: 'float',
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 disperseHash(vec3 p) {
                return fract(sin(p * 127.1 + vec3(311.7, 74.7, 269.5)) * 43758.5453);
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 center = ${inputs.gsplat}.center;
              vec3 hv = disperseHash(center);

              // Constant random floating: per-point phase and amplitude
              float phase = hv.x * 6.28 + hv.y * 6.28;
              float amp = 0.012 + 0.008 * hv.z;
              vec3 floatOffset = vec3(
                sin(${inputs.t} * 0.7 + phase) * amp,
                sin(${inputs.t} * 0.5 + phase * 1.3) * amp,
                sin(${inputs.t} * 0.6 + phase * 0.7) * amp
              );
              center += floatOffset * 3.0;

              // Movement-driven disperse: only when disperseIntensity > 0 (cursor recently moved)
              vec3 toBrush = center - ${inputs.brushOrigin};
              float dist = length(toBrush);
              if (dist < ${inputs.brushRadius} && dist > 0.001 && ${inputs.disperseIntensity} > 0.01) {
                float falloff = 1.0 - smoothstep(0.0, ${inputs.brushRadius}, dist);
                // Per-splat variation: nudge direction and scale so not a uniform sphere
                vec3 pushDir = normalize(toBrush + (hv - 0.5) * 0.4);
                float vary = 0.5 + hv.x * 0.6 + hv.y * 0.4;
                float push = ${inputs.pushStrength} * falloff * ${inputs.disperseIntensity} * vary;
                center += pushDir * push;
              }

              ${outputs.gsplat}.center = center;
            `),
        });
        gsplat = d.apply({
          gsplat,
          brushOrigin,
          brushRadius,
          pushStrength,
          disperseIntensity,
          t: animateT,
        }).gsplat;
        return { gsplat };
      }
    );
  }

  private updateBrushFromPointer(event: PointerEvent): void {
    if (!this.sceneManager) return;
    const { canvas, camera } = this.sceneManager;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const ray = this.raycaster.ray;
    const t = (MODEL_PLANE_Z - ray.origin.z) / ray.direction.z;
    if (t > 0 && t < 100) {
      this.brushOrigin.value.copy(ray.origin).addScaledVector(ray.direction, t);
      // Ramp disperse when cursor moves (compare to last position)
      const moveDist = this.brushOrigin.value.distanceTo(this.lastBrushOrigin);
      this.currentDisperseIntensity = Math.min(1, this.currentDisperseIntensity + moveDist * 3 + this.DISPERSE_RAMP);
      this.lastBrushOrigin.copy(this.brushOrigin.value);
    } else {
      this.brushOrigin.value.set(1000, 1000, 1000);
    }
  }

  onPointerDown(event: PointerEvent): void {
    this.updateBrushFromPointer(event);
  }

  onPointerMove(event: PointerEvent): void {
    this.updateBrushFromPointer(event);
  }

  update(_deltaTime: number, elapsed: number): void {
    this.animateT.value = elapsed;
    // Smooth, slow return when cursor is still (lerp toward 0)
    this.currentDisperseIntensity += (0 - this.currentDisperseIntensity) * this.DISPERSE_RETURN_SPEED;
    this.disperseIntensity.value = this.currentDisperseIntensity;
  }

  buildGui(gui: GUI): void {
    gui.add(this.params, 'brushSize', 0.1, 0.8, 0.02)
      .name('Brush size')
      .onChange((v: number) => {
        this.brushRadius.value = v;
        this.splatMesh?.updateGenerator();
      });
    gui.add(this.params, 'pushStrength', 0.02, 0.3, 0.01)
      .name('Push strength')
      .onChange((v: number) => {
        this.pushStrength.value = v;
        this.splatMesh?.updateGenerator();
      });
  }

  dispose(): void {
    if (this.splatMesh) {
      this.sceneManager?.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }
  }
}
