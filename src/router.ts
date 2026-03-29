import type { SceneManager } from './core/scene-manager';
import type { BaseEffect } from './core/types';
import { createEffect } from './effects/index';
import { showLoading, hideLoading } from './ui/loading-screen';
import { updateHud } from './ui/overlay-hud';
import GUI from 'lil-gui';

const DEFAULT_EFFECT_ID = 'gallery-showcase';

export class Router {
  private sceneManager: SceneManager;
  private currentEffect: BaseEffect | null = null;
  private gui: GUI | null = null;
  private container: HTMLElement;

  constructor(sceneManager: SceneManager, container: HTMLElement) {
    this.sceneManager = sceneManager;
    this.container = container;

    const canvas = sceneManager.canvas;
    canvas.addEventListener('pointerdown', (e) => this.currentEffect?.onPointerDown?.(e));
    canvas.addEventListener('pointermove', (e) => this.currentEffect?.onPointerMove?.(e));
    canvas.addEventListener('pointerup', (e) => this.currentEffect?.onPointerUp?.(e));
  }

  async navigate(id: string): Promise<void> {
    await this.loadEffect(id);
  }

  async onRouteChange(): Promise<void> {
    await this.loadEffect(DEFAULT_EFFECT_ID);
  }

  async loadEffect(id: string): Promise<void> {
    if (this.currentEffect) {
      this.currentEffect.dispose();
      this.currentEffect = null;
      this.sceneManager.setActiveEffect(null);
    }
    this.sceneManager.clearScene();

    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }

    const effect = createEffect(id);
    if (!effect) return;

    showLoading(this.container);

    try {
      await effect.init(this.sceneManager);

      this.gui = new GUI({ container: this.container });
      effect.buildGui(this.gui);

      updateHud(effect.config.name, effect.config.description);

      this.currentEffect = effect;
      this.sceneManager.setActiveEffect(effect);
    } catch (err) {
      console.error('Failed to load effect:', err);
    } finally {
      hideLoading(this.container);
    }
  }

  loadDefault(): void {
    this.loadEffect(DEFAULT_EFFECT_ID);
  }
}
