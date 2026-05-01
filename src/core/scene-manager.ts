// scene manager overview
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
    this.renderer.setClearColor(new THREE.Color(0x000000), 1);
    this.canvas = this.renderer.domElement;
    container.appendChild(this.canvas);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.01,
      1000
    );
    
    
    this.scene.add(this.camera);

    this.spark = new SparkRenderer({
      renderer: this.renderer,
      preUpdate: true,
      minAlpha: 0.05,
      maxStdDev: Math.sqrt(5),
      maxPixelRadius: 128,
      clipXY: 1.0,
      focalAdjustment: 1.0,
      blurAmount: 0.0,
      preBlurAmount: 0.0,
      view: { sortRadial: true },
    });
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
    
    const removable = this.scene.children.filter(
      (child) => child !== this.camera && child !== this.spark,
    );
    for (const child of removable) {
      this.scene.remove(child);
    }
  }
}
