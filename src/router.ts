// router overview
import type { SceneManager } from './core/scene-manager';
import type { BaseEffect } from './core/types';
import { createEffect } from './effects/index';
import { GalleryShowcaseEffect } from './effects/gallery-showcase';
import type { Hud } from './ui/overlay-hud';
import type { MuseumPanel } from './ui/museum-panel';
import GUI from 'lil-gui';

const DEFAULT_EFFECT_ID = 'gallery-showcase';

export interface RouterOptions {
  hud: Hud;
  panel: MuseumPanel;
}

export class Router {
  private sceneManager: SceneManager;
  private currentEffect: BaseEffect | null = null;
  private gui: GUI | null = null;
  private container: HTMLElement;
  private hud: Hud;
  private panel: MuseumPanel;

  constructor(sceneManager: SceneManager, container: HTMLElement, options: RouterOptions) {
    this.sceneManager = sceneManager;
    this.container = container;
    this.hud = options.hud;
    this.panel = options.panel;

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
      if (this.currentEffect instanceof GalleryShowcaseEffect) {
        this.currentEffect.setSelectionListener(null);
      }
      this.currentEffect.dispose();
      this.currentEffect = null;
      this.sceneManager.setActiveEffect(null);
    }
    this.sceneManager.clearScene();

    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
    }

    this.panel.close();
    this.hud.setSelectedId(null);

    const effect = createEffect(id);
    if (!effect) return;

    try {
      await effect.init(this.sceneManager);

      if (effect instanceof GalleryShowcaseEffect) {
        
        
        effect.setSelectionListener((content) => {
          if (content) {
            this.panel.open(content);
          } else {
            this.panel.close();
          }
          this.hud.setSelectedId(content?.id ?? null);
        });
      } else {
        this.gui = new GUI({ container: this.container });
        effect.buildGui(this.gui);
      }

      this.currentEffect = effect;
      this.sceneManager.setActiveEffect(effect);
    } catch (err) {
      console.error('Failed to load effect:', err);
    }
  }

  loadDefault(): void {
    this.loadEffect(DEFAULT_EFFECT_ID);
  }

  
  onFrame(): void {
    this.panel.refresh();
  }

  
  handlePanelClose(): void {
    if (this.currentEffect instanceof GalleryShowcaseEffect) {
      this.currentEffect.requestSelect(null);
    } else {
      this.panel.close();
    }
  }
}
