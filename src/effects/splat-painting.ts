import * as THREE from 'three';
import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';

const SPLAT_URL = 'https://sparkjs.dev/assets/splats/cat.spz';

export class SplatPaintingEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'splat-painting',
    name: 'Splat Painting',
    description: '',
    category: 'interactive',
  };

  private splatMesh: SplatMesh | null = null;
  private sceneManager: SceneManager | null = null;
  private raycaster = new THREE.Raycaster();
  private isDragging = false;

  // Dyno uniforms for the brush
  private brushEnabled = dyno.dynoBool(false);
  private eraseEnabled = dyno.dynoBool(false);
  private brushRadius = dyno.dynoFloat(0.05);
  private brushDepth = dyno.dynoFloat(10.0);
  private brushOrigin = dyno.dynoVec3(new THREE.Vector3(0, 0, 0));
  private brushDirection = dyno.dynoVec3(new THREE.Vector3(0, 0, -1));
  private brushColor = dyno.dynoVec3(new THREE.Vector3(1.0, 0.0, 1.0));

  private params = {
    color: '#ff00ff',
    brushSize: 0.05,
    mode: 'paint' as 'paint' | 'erase' | 'orbit',
  };

  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;

    this.splatMesh = new SplatMesh({
      url: SPLAT_URL,
      onFrame: ({ mesh }) => {
        mesh.needsUpdate = true;
      },
    });

    this.splatMesh.quaternion.set(1, 0, 0, 0);
    this.splatMesh.position.set(0, -0.5, -2.5);
    this.splatMesh.scale.set(0.5, 0.5, 0.5);

    // Build the paint modifier using raw GLSL Dyno
    this.splatMesh.worldModifier = this.buildBrushDyno();
    this.splatMesh.updateGenerator();

    sceneManager.scene.add(this.splatMesh);
    await this.splatMesh.initialized;

    // Sync brush state with initial mode (otherwise brushOn stays false and paint never applies)
    this.setMode(this.params.mode);

    // Set up keyboard shortcuts
    this.keyHandler = (e: KeyboardEvent) => this.handleKey(e);
    window.addEventListener('keydown', this.keyHandler);
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.key === '1') {
      this.setMode('paint');
    } else if (e.key === '2') {
      this.setMode('erase');
    } else if (e.key === 'Escape') {
      this.setMode('orbit');
    } else if (e.key === '=' || e.key === '+') {
      this.params.brushSize = Math.min(this.params.brushSize + 0.01, 0.25);
      this.brushRadius.value = this.params.brushSize;
    } else if (e.key === '-') {
      this.params.brushSize = Math.max(this.params.brushSize - 0.01, 0.01);
      this.brushRadius.value = this.params.brushSize;
    }
  }

  private setMode(mode: 'paint' | 'erase' | 'orbit'): void {
    this.params.mode = mode;
    this.brushEnabled.value = mode === 'paint';
    this.eraseEnabled.value = mode === 'erase';
    if (this.sceneManager) {
      this.sceneManager.controls.pointerControls.enable = mode === 'orbit';
    }
  }

  private buildBrushDyno() {
    const {
      brushEnabled, eraseEnabled, brushRadius, brushDepth,
      brushOrigin, brushDirection, brushColor,
    } = this;

    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            brushOn: 'bool',
            eraseOn: 'bool',
            bRadius: 'float',
            bDepth: 'float',
            bOrigin: 'vec3',
            bDir: 'vec3',
            bColor: 'vec3',
          },
          outTypes: { gsplat: dyno.Gsplat },
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 center = ${inputs.gsplat}.center;
              vec3 rgb = ${inputs.gsplat}.rgba.rgb;
              float opacity = ${inputs.gsplat}.rgba.w;

              // Project center onto brush ray
              float projAmp = dot(${inputs.bDir}, center - ${inputs.bOrigin});
              vec3 projCenter = ${inputs.bOrigin} + ${inputs.bDir} * projAmp;
              float dist = length(projCenter - center);

              bool isInside = dist < ${inputs.bRadius}
                && projAmp > 0.0
                && projAmp < ${inputs.bDepth};

              if (${inputs.brushOn} && isInside) {
                // Luminance-preserving paint
                float lumOld = dot(rgb, vec3(0.333));
                float lumNew = dot(${inputs.bColor}, vec3(0.333));
                if (lumOld > 0.05 && lumNew > 0.01) {
                  ${outputs.gsplat}.rgba.rgb = ${inputs.bColor} * (lumOld / lumNew);
                }
              }

              if (${inputs.eraseOn} && isInside) {
                ${outputs.gsplat}.rgba.w = 0.0;
              }
            `),
        });

        gsplat = d.apply({
          gsplat,
          brushOn: brushEnabled,
          eraseOn: eraseEnabled,
          bRadius: brushRadius,
          bDepth: brushDepth,
          bOrigin: brushOrigin,
          bDir: brushDirection,
          bColor: brushColor,
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
    const dir = this.raycaster.ray.direction.normalize();
    this.brushDirection.value.copy(dir);
    this.brushOrigin.value.copy(this.raycaster.ray.origin);
  }

  private applyBrushStroke(): void {
    if (!this.splatMesh || !this.sceneManager) return;
    const noSplatRgba = !this.splatMesh.splatRgba;
    this.splatMesh.splatRgba = this.sceneManager.spark.getRgba({
      generator: this.splatMesh,
      rgba: this.splatMesh.splatRgba ?? undefined,
    });
    if (noSplatRgba) {
      this.splatMesh.updateGenerator();
    } else {
      this.splatMesh.updateVersion();
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (this.params.mode === 'orbit') return;
    this.isDragging = true;
    this.updateBrushFromPointer(event);
    this.applyBrushStroke();
  }

  onPointerMove(event: PointerEvent): void {
    this.updateBrushFromPointer(event);
    if (this.isDragging && this.params.mode !== 'orbit') {
      this.applyBrushStroke();
    }
  }

  onPointerUp(): void {
    this.isDragging = false;
  }

  update(): void {
    // Rendering handled by onFrame callback
  }

  buildGui(gui: GUI): void {
    gui.addColor(this.params, 'color').name('Brush Color').onChange((val: string) => {
      const c = new THREE.Color(val);
      this.brushColor.value.set(c.r, c.g, c.b);
    });
    // Apply initial color to brush
    this.brushColor.value.set(
      ...new THREE.Color(this.params.color).toArray() as [number, number, number]
    );
    gui.add(this.params, 'brushSize', 0.01, 0.25, 0.005).name('Brush Size')
      .onChange((val: number) => { this.brushRadius.value = val; });
    gui.add(this.params, 'mode', ['paint', 'erase', 'orbit']).name('Mode')
      .onChange((val: 'paint' | 'erase' | 'orbit') => this.setMode(val));
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
    }
    if (this.splatMesh) {
      this.sceneManager?.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }
    if (this.sceneManager) {
      this.sceneManager.controls.pointerControls.enable = true;
    }
  }
}
