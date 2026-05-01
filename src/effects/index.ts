// index overview
import type { BaseEffect, EffectConfig } from '../core/types';
import { GalleryShowcaseEffect } from './gallery-showcase';
import { BoidSwarmEffect } from './boid-swarm';

export type EffectFactory = () => BaseEffect;

const registry: Record<string, EffectFactory> = {
  'gallery-showcase': () => new GalleryShowcaseEffect(),
  'boid-swarm': () => new BoidSwarmEffect(),
};

export function getEffectConfigs(): EffectConfig[] {
  return Object.values(registry).map((factory) => factory().config);
}

export function createEffect(id: string): BaseEffect | null {
  const factory = registry[id];
  return factory ? factory() : null;
}
