import type { BaseEffect, EffectConfig } from '../core/types';
import { GalleryShowcaseEffect } from './gallery-showcase';

export type EffectFactory = () => BaseEffect;

const registry: Record<string, EffectFactory> = {
  'gallery-showcase': () => new GalleryShowcaseEffect(),
};

export function getEffectConfigs(): EffectConfig[] {
  return Object.values(registry).map((factory) => factory().config);
}

export function createEffect(id: string): BaseEffect | null {
  const factory = registry[id];
  return factory ? factory() : null;
}
