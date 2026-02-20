import type { GUI } from 'lil-gui';
import type { SceneManager } from './scene-manager';

export interface EffectConfig {
  id: string;
  name: string;
  description: string;
  category: string;
}

export abstract class BaseEffect {
  abstract config: EffectConfig;

  abstract init(sceneManager: SceneManager): Promise<void>;
  abstract update(deltaTime: number, elapsed: number): void;
  abstract dispose(): void;
  abstract buildGui(gui: GUI): void;

  onPointerDown?(event: PointerEvent): void;
  onPointerMove?(event: PointerEvent): void;
  onPointerUp?(event: PointerEvent): void;
}
