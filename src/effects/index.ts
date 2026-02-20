import type { BaseEffect, EffectConfig } from '../core/types';
import { DissolveReformEffect } from './dissolve-reform';
import { SplatPaintingEffect } from './splat-painting';
import { ShaderStylizeEffect } from './shader-stylize';
import { PointCloudDisperseEffect } from './point-cloud-disperse';

export type EffectFactory = () => BaseEffect;

const registry: Record<string, EffectFactory> = {
  'dissolve-reform': () => new DissolveReformEffect(),
  'splat-painting': () => new SplatPaintingEffect(),
  'shader-stylize': () => new ShaderStylizeEffect(),
  'point-cloud-disperse': () => new PointCloudDisperseEffect(),
};

export function getEffectConfigs(): EffectConfig[] {
  return Object.values(registry).map((factory) => factory().config);
}

export function createEffect(id: string): BaseEffect | null {
  const factory = registry[id];
  return factory ? factory() : null;
}
