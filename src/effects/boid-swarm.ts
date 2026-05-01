// boid swarm overview
import * as THREE from 'three';
import { SplatMesh, PackedSplats } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';
import { KdTree } from '../wave/kd-tree';
import { buildKnnGraph } from '../wave/graph';
import { GpgpuBoidSolver } from '../boid/gpgpu-boid';
import { createBoidObjectModifier, createBoidUniforms } from '../boid/boid-modifier';

const SPLAT_URL = new URL('../../objects/butterfly.spz', import.meta.url).href;
const BOID_K = 8;

const BASE_SEPARATION = 1.2;
const BASE_ALIGNMENT = 1.4;
const BASE_COHESION = 0.9;
const BASE_HOME_SPRING = 2.0;
const BASE_MAX_SPEED = 1.6;
const BASE_DISTURBANCE_IMPULSE = 8.0;
const BASE_ORBIT_SWIRL = 3.2;
const BASE_ORBIT_ATTRACT = 2.4;
const USER_HOVER_LINGER_MS = 250;

export class BoidSwarmEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'boid-swarm',
    name: 'Boid Swarm',
    description: 'Ghost vortex sweeps the butterfly; hover to take over',
    category: 'simulation',
  };

  private splatMesh: SplatMesh | null = null;
  private sceneManager: SceneManager | null = null;
  private solver: GpgpuBoidSolver | null = null;
  private proxy: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private uniforms: ReturnType<typeof createBoidUniforms> | null = null;
  private currentHoverIntensity = 0;
  private readonly HOVER_RAMP = 0.35;
  private readonly HOVER_DECAY = 0.018;

  private autoCenter = new THREE.Vector3();
  private autoExtent = 1;
  private autoPos = new THREE.Vector3();
  private lastUserHoverWallMs = -1e9;

  private _tmpLocalCam = new THREE.Vector3();
  private _tmpAxis = new THREE.Vector3();

  private params = {
    vortexStrength: 1.0,
    vortexRadius: 0.6,
    streak: 1.5,
    glow: 1.0,
    autoDemo: true,
    autoSpeed: 0.65,
  };

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;

    const source = new PackedSplats({ url: SPLAT_URL });
    await source.initialized;

    const filtered = new PackedSplats({ maxSplats: source.numSplats });
    const centers: number[] = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    source.forEachSplat((_i, center, scales, quaternion, opacity, color) => {
      if (opacity >= 0.15) {
        filtered.pushSplat(center, scales, quaternion, opacity, color);
        centers.push(center.x, center.y, center.z);
        if (center.x < minX) minX = center.x;
        if (center.x > maxX) maxX = center.x;
        if (center.y < minY) minY = center.y;
        if (center.y > maxY) maxY = center.y;
        if (center.z < minZ) minZ = center.z;
        if (center.z > maxZ) maxZ = center.z;
      }
    });
    source.dispose();
    await filtered.initialized;

    const count = centers.length / 3;
    const positions = new Float32Array(centers);

    this.autoCenter.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    this.autoExtent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.45;

    const tree = new KdTree(positions, count);
    const graph = buildKnnGraph(positions, count, tree, BOID_K);

    this.solver = new GpgpuBoidSolver(sceneManager.renderer, positions, graph, count);

    this.uniforms = createBoidUniforms(
      this.solver.getOffsetTexture(),
      this.solver.getVelTexture(),
      this.solver.getGpgpuSize(),
    );

    this.splatMesh = new SplatMesh({
      packedSplats: filtered,
      objectModifier: createBoidObjectModifier({
        offsetTexUniform: this.uniforms.offsetTex,
        velTexUniform: this.uniforms.velTex,
        gpgpuSizeUniform: this.uniforms.gpgpuSize,
        streakUniform: this.uniforms.streak,
        glowUniform: this.uniforms.glow,
      }),
    });
    this.splatMesh.quaternion.set(1, 0, 0, 0);
    this.splatMesh.position.set(0, 0, -2.5);
    this.splatMesh.scale.setScalar(1.5);
    sceneManager.scene.add(this.splatMesh);
    await this.splatMesh.initialized;
    this.splatMesh.updateGenerator();

    const bbox = this.splatMesh.getBoundingBox(false);
    const center = bbox.getCenter(new THREE.Vector3());
    const size = bbox.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.6;

    this.proxy = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 24),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })
    );
    this.proxy.position.copy(center);
    this.splatMesh.add(this.proxy);
  }

  update(deltaTime: number, elapsed: number): void {
    if (!this.solver || !this.splatMesh || !this.uniforms || !this.sceneManager) return;
    if (this.solver.hasInitError()) return;

    const userActive = performance.now() - this.lastUserHoverWallMs < USER_HOVER_LINGER_MS;

    if (this.params.autoDemo && !userActive) {
      const a = elapsed * this.params.autoSpeed;
      const e = this.autoExtent;
      this.autoPos.set(
        this.autoCenter.x + Math.cos(a) * e * 1.05,
        this.autoCenter.y + Math.sin(a * 1.35) * e * 0.4,
        this.autoCenter.z + Math.sin(a * 0.9) * e * 0.95,
      );
      this.solver.setDisturbance(this.autoPos, this.params.vortexRadius, 0);
      this.currentHoverIntensity = Math.min(0.8, this.currentHoverIntensity + 0.03);
    } else {
      this.currentHoverIntensity = Math.max(0, this.currentHoverIntensity - this.HOVER_DECAY);
    }

    const vs = this.params.vortexStrength;
    this.solver.hoverStrength = this.currentHoverIntensity * BASE_DISTURBANCE_IMPULSE * vs;
    this.solver.flockGate = this.currentHoverIntensity;
    this.solver.separation = BASE_SEPARATION;
    this.solver.alignment = BASE_ALIGNMENT;
    this.solver.cohesion = BASE_COHESION;
    this.solver.homeSpring = BASE_HOME_SPRING;
    this.solver.maxSpeed = BASE_MAX_SPEED;
    this.solver.disturbanceRadius = this.params.vortexRadius;
    this.solver.orbitSwirl = BASE_ORBIT_SWIRL * vs;
    this.solver.orbitAttract = BASE_ORBIT_ATTRACT * vs;

    this._tmpLocalCam.copy(this.sceneManager.camera.position);
    this.splatMesh.worldToLocal(this._tmpLocalCam);
    this._tmpAxis.subVectors(this._tmpLocalCam, this.solver.getDisturbancePos());
    if (this._tmpAxis.lengthSq() > 1e-8) {
      this._tmpAxis.normalize();
      this.solver.orbitAxis.copy(this._tmpAxis);
    }

    this.uniforms.streak.value = this.params.streak;
    this.uniforms.glow.value = this.params.glow;

    this.solver.step(deltaTime, elapsed);

    
    
    this.uniforms.offsetTex.value = this.solver.getOffsetTexture();
    this.uniforms.velTex.value = this.solver.getVelTexture();
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.sceneManager || !this.splatMesh || !this.proxy || !this.solver) return;
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);

    const hits = this.raycaster.intersectObject(this.proxy, false);
    if (hits.length > 0) {
      const local = hits[0]!.point.clone();
      this.splatMesh.worldToLocal(local);
      this.solver.setDisturbance(local, this.params.vortexRadius, 0);
      this.currentHoverIntensity = Math.min(1, this.currentHoverIntensity + this.HOVER_RAMP);
      this.lastUserHoverWallMs = performance.now();
    }
  }

  buildGui(gui: GUI): void {
    const vortex = gui.addFolder('Vortex');
    vortex.add(this.params, 'vortexStrength', 0, 2, 0.05).name('Strength');
    vortex.add(this.params, 'vortexRadius', 0.2, 1.5, 0.05).name('Radius');
    vortex.open();

    const look = gui.addFolder('Look');
    look.add(this.params, 'streak', 0, 3, 0.05).name('Motion streak');
    look.add(this.params, 'glow', 0, 2, 0.05).name('Ember glow');
    look.open();

    const demo = gui.addFolder('Auto demo');
    demo.add(this.params, 'autoDemo').name('Enabled');
    demo.add(this.params, 'autoSpeed', 0.1, 2, 0.05).name('Speed');
    demo.open();

    gui.add({ reset: () => this.solver?.reset() }, 'reset').name('Reset');
  }

  dispose(): void {
    if (this.splatMesh) {
      this.sceneManager?.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }
    if (this.solver) {
      this.solver.dispose();
      this.solver = null;
    }
    this.proxy?.geometry.dispose();
    if (this.proxy) (this.proxy.material as THREE.Material).dispose();
    this.proxy = null;
    this.uniforms = null;
  }
}
