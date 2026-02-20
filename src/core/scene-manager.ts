import * as THREE from 'three';
import { SparkRenderer, SparkControls } from '@sparkjsdev/spark';
import type { BaseEffect } from './types';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly spark: SparkRenderer;
  readonly controls: SparkControls;
  readonly canvas: HTMLCanvasElement;
  readonly container: HTMLElement;

  private activeEffect: BaseEffect | null = null;
  private clock = new THREE.Clock();
  private onFrame?: (delta: number) => void;

  constructor(
    container: HTMLElement,
    options?: { onFrame?: (delta: number) => void }
  ) {
    this.container = container;
    this.onFrame = options?.onFrame;

    this.renderer = new THREE.WebGLRenderer({ antialias: false });
    this.renderer.setClearColor(new THREE.Color(0x0a0a0f), 1);
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.01,
      1000
    );
    this.camera.position.set(0, 0, 0);
    this.camera.lookAt(0, 0, -1);
    this.scene.add(this.camera);

    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);

    this.controls = new SparkControls({ canvas: this.canvas });

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    const resizeObserver = new ResizeObserver(() => this.handleResize());
    resizeObserver.observe(this.container);

    this.renderer.setAnimationLoop((time: number) => this.animate(time));
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate(_rawTime: number): void {
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.onFrame?.(delta);

    this.controls.update(this.camera);

    if (this.activeEffect) {
      this.activeEffect.update(delta, elapsed);
    }

    this.renderer.render(this.scene, this.camera);
  }

  setActiveEffect(effect: BaseEffect | null): void {
    this.activeEffect = effect;
  }

  clearScene(): void {
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj !== this.scene && obj !== this.camera && obj !== this.spark) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      if (obj.parent === this.scene) {
        this.scene.remove(obj);
      }
    }
  }
}
