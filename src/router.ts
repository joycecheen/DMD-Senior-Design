import type { SceneManager } from './core/scene-manager';
import type { BaseEffect } from './core/types';
import { createEffect, getEffectConfigs } from './effects/index';
import { setActiveItem } from './ui/sidebar';
import { showLoading, hideLoading } from './ui/loading-screen';
import { updateHud } from './ui/overlay-hud';
import GUI from 'lil-gui';

export class Router {
  private sceneManager: SceneManager;
  private currentEffect: BaseEffect | null = null;
  private gui: GUI | null = null;
  private container: HTMLElement;

  constructor(sceneManager: SceneManager, container: HTMLElement) {
    this.sceneManager = sceneManager;
    this.container = container;

    window.addEventListener('hashchange', () => this.onRouteChange());

    // Wire up pointer events on the canvas to the active effect
    const canvas = sceneManager.canvas;
    canvas.addEventListener('pointerdown', (e) => this.currentEffect?.onPointerDown?.(e));
    canvas.addEventListener('pointermove', (e) => this.currentEffect?.onPointerMove?.(e));
    canvas.addEventListener('pointerup', (e) => this.currentEffect?.onPointerUp?.(e));
  }

  async navigate(id: string): Promise<void> {
    window.location.hash = `#/${id}`;
  }

  async onRouteChange(): Promise<void> {
    const hash = window.location.hash.slice(2); // remove #/
    if (hash) {
      await this.loadEffect(hash);
    }
  }

  async loadEffect(id: string): Promise<void> {
    // Dispose current
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

    // Create new effect
    const effect = createEffect(id);
    if (!effect) return;

    setActiveItem(id);
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
    const configs = getEffectConfigs();
    if (configs.length > 0) {
      const hash = window.location.hash.slice(2);
      if (hash) {
        this.loadEffect(hash);
      } else {
        this.navigate(configs[0].id);
      }
    }
  }
}
