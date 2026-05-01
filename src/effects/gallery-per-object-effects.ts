// gallery per object effects overview
import * as three from 'three';
import { dyno, PackedSplats } from '@sparkjsdev/spark';
import type { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';
import { KdTree } from '../wave/kd-tree';
import { buildKnnGraph } from '../wave/graph';
import { GpgpuBoidSolver } from '../boid/gpgpu-boid';
import { createBoidObjectModifier, createBoidUniforms } from '../boid/boid-modifier';

const MAX_WAVE_SOURCES = 4;

export type GalleryEffectMode =
  | 'dissolve-reform'
  | 'wave-propagation'
  | 'splat-painting'
  | 'xray-slice'
  | 'shader-stylize'
  | 'boid-swarm';



export function createDissolveReformModifier(
  animateT: ReturnType<typeof dyno.dynoFloat>,
  stagger: ReturnType<typeof dyno.dynoFloat>
) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, t: 'float', stagger: 'float' },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            vec3 dissolveHash(vec3 p) {
              return fract(sin(p * 123.456) * 123.456);
            }
          `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            vec3 localPos = ${inputs.gsplat}.center;
            vec3 hashVal = dissolveHash(localPos);
            float startTime = hashVal.x * ${inputs.stagger};
            float windowSize = max(0.5, 1.0 - ${inputs.stagger} * 0.5);
            float localT = clamp((${inputs.t} - startTime) / windowSize, 0.0, 1.0);
            vec3 moveDir = normalize(localPos + (hashVal - 0.5) * 0.6);
            float randomSpeed = 0.5 + hashVal.y;
            float moveAmount = localT * 2.0 * randomSpeed;
            ${outputs.gsplat}.center = localPos + moveDir * moveAmount;
            ${outputs.gsplat}.rgba.w *= 1.0 - smoothstep(0.3, 1.0, localT);
            ${outputs.gsplat}.rgba.rgb = mix(
              ${inputs.gsplat}.rgba.rgb,
              vec3(1.0),
              localT * 0.6
            );
            ${outputs.gsplat}.scales *= mix(1.0, 0.3, localT);
          `),
      });
      gsplat = d.apply({ gsplat, t: animateT, stagger }).gsplat;
      return { gsplat };
    }
  );
}


export function createShaderStylizeModifier(
  animateT: ReturnType<typeof dyno.dynoFloat>,
  intensity: ReturnType<typeof dyno.dynoFloat>,
  elongation: ReturnType<typeof dyno.dynoFloat>,
  axisMask: ReturnType<typeof dyno.dynoVec3>
) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: {
          gsplat: dyno.Gsplat,
          t: 'float',
          intensity: 'float',
          elongation: 'float',
          axisMask: 'vec3',
        },
        outTypes: { gsplat: dyno.Gsplat },
        globals: () => [
          dyno.unindent(`
            vec3 styleHash(vec3 p) {
              return fract(sin(p * 127.1 + vec3(311.7, 74.7, 269.5)) * 43758.5453);
            }
          `),
        ],
        statements: ({ inputs, outputs }) =>
          dyno.unindentLines(`
            ${outputs.gsplat} = ${inputs.gsplat};
            vec3 pos = ${inputs.gsplat}.center;
            vec3 scales = ${inputs.gsplat}.scales;
            vec4 col = ${inputs.gsplat}.rgba;
            vec3 hv = styleHash(pos);
            float elongateAmt = mix(1.0, ${inputs.elongation}, ${inputs.intensity});
            
            
            vec3 baseScale = mix(vec3(1.0), vec3(0.45), vec3(${inputs.intensity}));
            vec3 axisScale = mix(baseScale, vec3(elongateAmt), ${inputs.axisMask});
            ${outputs.gsplat}.scales = scales * axisScale;
            float gray = dot(col.rgb, vec3(0.299, 0.587, 0.114));
            vec3 desaturated = vec3(gray) * 0.2;
            vec3 sparkleColor = vec3(1.0, 1.0, 1.0);
            float glow = smoothstep(0.08, 0.45, gray) * ${inputs.intensity};
            float twinkle = 0.7 + 0.6 * hv.x;
            vec3 spark = desaturated + sparkleColor * glow * twinkle * 3.5;
            vec3 finalColor = mix(col.rgb, spark, ${inputs.intensity});
            ${outputs.gsplat}.rgba.rgb = clamp(finalColor, 0.0, 1.0);
          `),
      });
      gsplat = d.apply({
        gsplat,
        t: animateT,
        intensity,
        elongation,
        axisMask,
      }).gsplat;
      return { gsplat };
    }
  );
}


export class GalleryWaveItemState {
  timeUniform = dyno.dynoFloat(0);
  waveSpeedUniform = dyno.dynoFloat(1.2);
  dampingUniform = dyno.dynoFloat(0.6);
  dispScaleUniform = dyno.dynoFloat(0.1);
  waveFreqUniform = dyno.dynoFloat(12.0);
  srcPosUniforms: ReturnType<typeof dyno.dynoVec3>[] = [];
  srcTimeUniforms: ReturnType<typeof dyno.dynoFloat>[] = [];
  sources: { origin: three.Vector3; startTime: number }[] = [];
  nextAutoEmit = 0;
  splatBBox: three.Box3 | null = null;
  isDragging = false;
  params = {
    waveSpeed: 1.2,
    damping: 0.6,
    displaceScale: 0.1,
    waveFrequency: 12.0,
    autoEmit: true,
    autoEmitInterval: 2.7,
  };

  constructor() {
    for (let i = 0; i < MAX_WAVE_SOURCES; i++) {
      this.srcPosUniforms.push(dyno.dynoVec3(new three.Vector3(999, 999, 999)));
      this.srcTimeUniforms.push(dyno.dynoFloat(-1));
    }
  }

  buildModifier() {
    const {
      timeUniform, waveSpeedUniform, dampingUniform, dispScaleUniform,
      waveFreqUniform,
      srcPosUniforms, srcTimeUniforms,
    } = this;
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            uTime: 'float',
            uWaveSpeed: 'float',
            uDamping: 'float',
            uDispScale: 'float',
            uWaveFreq: 'float',
            uSrc0Pos: 'vec3', uSrc0Time: 'float',
            uSrc1Pos: 'vec3', uSrc1Time: 'float',
            uSrc2Pos: 'vec3', uSrc2Time: 'float',
            uSrc3Pos: 'vec3', uSrc3Time: 'float',
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 waveHash(vec3 p) {
                return fract(sin(p * 127.1 + vec3(311.7, 74.7, 269.5)) * 43758.5453);
              }
              
              float waveContribution(
                vec3 pos, vec3 srcPos, float srcTime,
                float t, float waveSpeed, float damping, float waveFreq
              ) {
                if (srcTime < 0.0) return 0.0;
                float age = t - srcTime;
                float fadeIn = smoothstep(0.0, 0.5, age);
                float dist = length(pos - srcPos);
                float wavefront = dist - age * waveSpeed;
                float envelope = fadeIn * exp(-damping * age) * exp(-wavefront * wavefront * 2.0);
                return envelope * sin(waveFreq * wavefront);
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 pos = ${inputs.gsplat}.center;
              vec3 hv = waveHash(pos);
              float t = ${inputs.uTime};
              
              float totalDisp = 0.0;
              totalDisp += waveContribution(pos, ${inputs.uSrc0Pos}, ${inputs.uSrc0Time}, t, ${inputs.uWaveSpeed}, ${inputs.uDamping}, ${inputs.uWaveFreq});
              totalDisp += waveContribution(pos, ${inputs.uSrc1Pos}, ${inputs.uSrc1Time}, t, ${inputs.uWaveSpeed}, ${inputs.uDamping}, ${inputs.uWaveFreq});
              totalDisp += waveContribution(pos, ${inputs.uSrc2Pos}, ${inputs.uSrc2Time}, t, ${inputs.uWaveSpeed}, ${inputs.uDamping}, ${inputs.uWaveFreq});
              totalDisp += waveContribution(pos, ${inputs.uSrc3Pos}, ${inputs.uSrc3Time}, t, ${inputs.uWaveSpeed}, ${inputs.uDamping}, ${inputs.uWaveFreq});
              vec3 normal = normalize(pos + (hv - 0.5) * 0.1);
              pos += normal * totalDisp * ${inputs.uDispScale};
              ${outputs.gsplat}.center = pos;
            `),
        });
        gsplat = d.apply({
          gsplat,
          uTime: timeUniform,
          uWaveSpeed: waveSpeedUniform,
          uDamping: dampingUniform,
          uDispScale: dispScaleUniform,
          uWaveFreq: waveFreqUniform,
          uSrc0Pos: srcPosUniforms[0], uSrc0Time: srcTimeUniforms[0],
          uSrc1Pos: srcPosUniforms[1], uSrc1Time: srcTimeUniforms[1],
          uSrc2Pos: srcPosUniforms[2], uSrc2Time: srcTimeUniforms[2],
          uSrc3Pos: srcPosUniforms[3], uSrc3Time: srcTimeUniforms[3],
        }).gsplat;
        return { gsplat };
      }
    );
  }

  initSplatBBox(splat: SplatMesh): void {
    this.splatBBox = splat.getBoundingBox(true);
    this.emitRandomWave(0, splat);
    this.emitRandomWave(0, splat);
  }

  private emitRandomWave(elapsed: number, _splat: SplatMesh): void {
    if (!this.splatBBox) return;
    const min = this.splatBBox.min;
    const max = this.splatBBox.max;
    const origin = new three.Vector3(
      min.x + Math.random() * (max.x - min.x),
      min.y + Math.random() * (max.y - min.y),
      min.z + Math.random() * (max.z - min.z)
    );
    this.addSource(origin, elapsed);
  }

  addSource(localOrigin: three.Vector3, elapsed: number): void {
    if (this.sources.length >= MAX_WAVE_SOURCES) {
      this.sources.shift();
    }
    this.sources.push({ origin: localOrigin.clone(), startTime: elapsed });
  }

  update(splat: SplatMesh, elapsed: number): void {
    this.timeUniform.value = elapsed;
    this.waveSpeedUniform.value = this.params.waveSpeed;
    this.dampingUniform.value = this.params.damping;
    this.dispScaleUniform.value = this.params.displaceScale;
    this.waveFreqUniform.value = this.params.waveFrequency;
    this.sources = this.sources.filter((s) => elapsed - s.startTime < 8);
    if (this.params.autoEmit && elapsed >= this.nextAutoEmit && this.splatBBox) {
      this.emitRandomWave(elapsed, splat);
      this.nextAutoEmit = elapsed + this.params.autoEmitInterval;
    }
    for (let i = 0; i < MAX_WAVE_SOURCES; i++) {
      const posVal = this.srcPosUniforms[i]!.value as three.Vector3;
      if (i < this.sources.length) {
        posVal.copy(this.sources[i]!.origin);
        this.srcTimeUniforms[i]!.value = this.sources[i]!.startTime;
      } else {
        posVal.set(999, 999, 999);
        this.srcTimeUniforms[i]!.value = -1;
      }
    }
  }

  injectFromWorldPoint(worldPoint: three.Vector3, splat: SplatMesh): void {
    const local = worldPoint.clone();
    splat.worldToLocal(local);
    this.addSource(local, this.timeUniform.value);
  }

  reset(): void {
    this.sources.length = 0;
    this.nextAutoEmit = this.timeUniform.value + this.params.autoEmitInterval;
    for (let i = 0; i < MAX_WAVE_SOURCES; i++) {
      (this.srcPosUniforms[i]!.value as three.Vector3).set(999, 999, 999);
      this.srcTimeUniforms[i]!.value = -1;
    }
  }
}


const PAINT_DEFAULT_SIZE = 0.05;
const PAINT_DEFAULT_REACH = 0.7;
const PAINT_DEFAULT_COLOR_HEX = '#ff00ff';
const PAINT_DEFAULT_COLOR_RGB = new three.Vector3(1.0, 0.0, 1.0);

export class GalleryPaintItemState {
  brushActive = dyno.dynoBool(false);
  brushEnabled = dyno.dynoBool(false);
  eraseEnabled = dyno.dynoBool(false);
  brushRadius = dyno.dynoFloat(PAINT_DEFAULT_SIZE);
  brushReach = dyno.dynoFloat(PAINT_DEFAULT_REACH);
  brushOrigin = dyno.dynoVec3(new three.Vector3(0, 0, 0));
  brushDirection = dyno.dynoVec3(new three.Vector3(0, 0, -1));
  brushColor = dyno.dynoVec3(PAINT_DEFAULT_COLOR_RGB.clone());
  surfaceDist = dyno.dynoFloat(0);
  isDragging = false;
  private dirty = false;
  private localBox: three.Box3 | null = null;
  private worldBox = new three.Box3();
  private hitScratch = new three.Vector3();
  private ndcScratch = new three.Vector2();
  params = {
    color: PAINT_DEFAULT_COLOR_HEX,
    brushSize: PAINT_DEFAULT_SIZE,
    brushReach: PAINT_DEFAULT_REACH,
    mode: 'paint' as 'paint' | 'erase',
  };

  initSplatBox(splat: SplatMesh, spark?: SparkRenderer): void {
    this.localBox = splat.getBoundingBox(false);
    if (spark) this.primeSplatRgba(splat, spark);
  }

  private primeSplatRgba(splat: SplatMesh, spark: SparkRenderer): void {
    if (splat.splatRgba) return;
    const baked = spark.getRgba({ generator: splat });
    splat.splatRgba = baked as unknown as NonNullable<typeof splat.splatRgba>;
    splat.updateGenerator();
  }

  raycastSurface(splat: SplatMesh, ray: three.Ray): three.Vector3 | null {
    if (!this.localBox || this.localBox.isEmpty()) return null;
    splat.updateMatrixWorld(true);
    this.worldBox.copy(this.localBox).applyMatrix4(splat.matrixWorld);
    return ray.intersectBox(this.worldBox, this.hitScratch);
  }

  markDirty(): void {
    this.dirty = true;
  }

  consumeDirty(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    return true;
  }

  buildWorldModifier() {
    const {
      brushActive, brushEnabled, eraseEnabled, brushRadius, brushReach,
      brushOrigin, brushDirection, brushColor, surfaceDist,
    } = this;
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            active: 'bool',
            brushOn: 'bool',
            eraseOn: 'bool',
            bRadius: 'float',
            sDist: 'float',
            sReach: 'float',
            bOrigin: 'vec3',
            bDir: 'vec3',
            bColor: 'vec3',
          },
          outTypes: { gsplat: dyno.Gsplat },
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 center = ${inputs.gsplat}.center;
              vec3 rgb = ${inputs.gsplat}.rgba.rgb;
              float projAmp = dot(${inputs.bDir}, center - ${inputs.bOrigin});
              vec3 projCenter = ${inputs.bOrigin} + ${inputs.bDir} * projAmp;
              float dist = length(projCenter - center);
              bool isInside = dist < ${inputs.bRadius}
                && projAmp > 0.0
                && projAmp < ${inputs.sDist} + ${inputs.sReach};
              if (${inputs.active} && ${inputs.brushOn} && isInside) {
                
                float lumOld = dot(rgb, vec3(0.299, 0.587, 0.114));
                float shade = 0.75 + lumOld * 0.5;
                ${outputs.gsplat}.rgba.rgb = clamp(${inputs.bColor} * shade, 0.0, 1.0);
              }
              if (${inputs.active} && ${inputs.eraseOn} && isInside) {
                ${outputs.gsplat}.rgba.w = 0.0;
              }
            `),
        });
        gsplat = d.apply({
          gsplat,
          active: brushActive,
          brushOn: brushEnabled,
          eraseOn: eraseEnabled,
          bRadius: brushRadius,
          sDist: surfaceDist,
          sReach: brushReach,
          bOrigin: brushOrigin,
          bDir: brushDirection,
          bColor: brushColor,
        }).gsplat;
        return { gsplat };
      }
    );
  }

  setMode(mode: 'paint' | 'erase'): void {
    this.params.mode = mode;
    this.brushEnabled.value = mode === 'paint';
    this.eraseEnabled.value = mode === 'erase';
    this.isDragging = false;
    this.brushActive.value = false;
  }

  updateBrushFromPointer(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: three.PerspectiveCamera,
    raycaster: three.Raycaster,
    surfaceHit: three.Vector3 | null
  ): boolean {
    const rect = canvas.getBoundingClientRect();
    this.ndcScratch.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(this.ndcScratch, camera);
    this.brushDirection.value.copy(raycaster.ray.direction).normalize();
    this.brushOrigin.value.copy(raycaster.ray.origin);
    if (!surfaceHit) return false;
    const dx = surfaceHit.x - raycaster.ray.origin.x;
    const dy = surfaceHit.y - raycaster.ray.origin.y;
    const dz = surfaceHit.z - raycaster.ray.origin.z;
    const dir = this.brushDirection.value;
    this.surfaceDist.value = dx * dir.x + dy * dir.y + dz * dir.z;
    return true;
  }

  applyBrushStroke(splat: SplatMesh, spark: SparkRenderer): void {
    const noSplatRgba = !splat.splatRgba;
    splat.splatRgba = spark.getRgba({
      generator: splat,
      rgba: splat.splatRgba ?? undefined,
    }) as typeof splat.splatRgba;
    if (noSplatRgba) {
      splat.updateGenerator();
    } else {
      splat.updateVersion();
    }
  }

  clearEdits(splat: SplatMesh, spark?: SparkRenderer): void {
    const existing = splat.splatRgba as unknown as { dispose?: () => void } | null;
    existing?.dispose?.();
    splat.splatRgba = null as unknown as typeof splat.splatRgba;
    splat.updateGenerator();
    this.isDragging = false;
    this.brushActive.value = false;
    if (spark) {
      requestAnimationFrame(() => {
        if (!splat.splatRgba) this.primeSplatRgba(splat, spark);
      });
    }
  }
}


export class GalleryXRaySliceItemState {
  time = dyno.dynoFloat(0);
  scanAxis = dyno.dynoVec3(new three.Vector3(1, 0, 0));
  slabCenter = dyno.dynoFloat(0);
  slabHalfT = dyno.dynoFloat(0.1);
  contrast = dyno.dynoFloat(0.72);
  focus = dyno.dynoFloat(0);

  private bbox: three.Box3 | null = null;
  private amp = 0.5;
  private focusMix = 0;
  private focusTarget = 0;
  private _tmp = new three.Vector3();
  private scanPhase = 0;
  private lastElapsed = -1;
  private renderedCenter = 0;

  params = {
    scanSpeed: 0.82,
    slabThickness: 0.2,
    contrast: 0.72,
    scanAxis: 'x' as 'x' | 'y' | 'z',
  };

  buildObjectModifier() {
    const { scanAxis, slabCenter, slabHalfT, contrast } = this;
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            scanAxis: 'vec3',
            slabCenter: 'float',
            slabHalfT: 'float',
            contrast: 'float',
          },
          outTypes: { gsplat: dyno.Gsplat },
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 pos = ${inputs.gsplat}.center;
              vec4 col = ${inputs.gsplat}.rgba;
              float coord = dot(pos, ${inputs.scanAxis});
              float d = abs(coord - ${inputs.slabCenter});
              float feather = max(${inputs.slabHalfT} * 0.18, 0.008);
              
              float inside = 1.0 - smoothstep(${inputs.slabHalfT} - feather, ${inputs.slabHalfT} + feather, d);
              
              
              
              float edgeWidth = max(${inputs.slabHalfT} * 0.18, 0.008);
              float edgeInner = ${inputs.slabHalfT} - edgeWidth - feather;
              float edgeOuter = ${inputs.slabHalfT} - feather * 0.5;
              float edge = smoothstep(edgeInner, edgeOuter, d) * inside;
              
              
              float luma = dot(col.rgb, vec3(0.299, 0.587, 0.114));
              vec3 blueprint = mix(
                col.rgb * vec3(0.42, 0.70, 1.0),
                vec3(luma * 0.28),
                0.35
              );
              blueprint = mix(blueprint, vec3(0.04, 0.09, 0.18), 0.18);
              
              
              vec3 rimGlow = vec3(0.22, 0.78, 1.0);
              float glowStrength = 0.35 + ${inputs.contrast} * 0.35;
              vec3 sliceColor = col.rgb + rimGlow * edge * glowStrength;
              vec3 finalColor = mix(blueprint, sliceColor, inside);
              
              
              float ghostAlpha = mix(0.13, 0.05, ${inputs.contrast});
              float alpha = col.a * mix(ghostAlpha, 1.0, inside);
              ${outputs.gsplat}.rgba = vec4(
                clamp(finalColor, 0.0, 1.0),
                min(alpha, 1.0)
              );
            `),
        });
        gsplat = d.apply({
          gsplat,
          scanAxis,
          slabCenter,
          slabHalfT,
          contrast,
        }).gsplat;
        return { gsplat };
      }
    );
  }

  initBBox(splat: SplatMesh): void {
    this.bbox = splat.getBoundingBox(true);
    this.recomputeAmp();
  }

  setAxis(axis: 'x' | 'y' | 'z'): void {
    if (this.params.scanAxis === axis) return;
    this.params.scanAxis = axis;
    const v = this.scanAxis.value as three.Vector3;
    v.set(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    this.recomputeAmp();
    this.scanPhase = 0;
    this.renderedCenter = 0;
  }

  private recomputeAmp(): void {
    if (!this.bbox) return;
    const size = this.bbox.getSize(this._tmp);
    const axis = this.params.scanAxis;
    this.amp = 0.5 * (axis === 'x' ? size.x : axis === 'y' ? size.y : size.z);
  }

  setFocused(focused: boolean): void {
    this.focusTarget = focused ? 1 : 0;
  }

  update(_splat: SplatMesh, elapsed: number): void {
    this.focusMix = three.MathUtils.lerp(this.focusMix, this.focusTarget, 0.05);
    const speed = this.params.scanSpeed * three.MathUtils.lerp(1.0, 0.9, this.focusMix);
    const halfThickness = Math.max(
      0.03,
      this.params.slabThickness * 0.5 * three.MathUtils.lerp(1.0, 0.9, this.focusMix)
    );
    const travel = Math.max(0, this.amp - halfThickness * 1.05);

    const dt = this.lastElapsed < 0 ? 0 : Math.min(0.1, Math.max(0, elapsed - this.lastElapsed));
    this.lastElapsed = elapsed;
    this.scanPhase += dt * speed;

    const primary = Math.sin(this.scanPhase);
    const secondary = Math.sin(this.scanPhase * 0.47 + 1.2) * 0.08;
    const targetCenter = travel * three.MathUtils.clamp(primary + secondary, -1, 1);
    this.renderedCenter = three.MathUtils.lerp(this.renderedCenter, targetCenter, 0.35);
    this.renderedCenter = three.MathUtils.clamp(this.renderedCenter, -travel, travel);

    this.time.value = elapsed;
    this.slabCenter.value = this.renderedCenter;
    this.slabHalfT.value = halfThickness;
    this.contrast.value = this.params.contrast * three.MathUtils.lerp(1.0, 1.08, this.focusMix);
    this.focus.value = this.focusMix;
  }
}


const BOID_SEPARATION = 1.2;
const BOID_ALIGNMENT = 1.4;
const BOID_COHESION = 0.9;
const BOID_HOME_SPRING = 2.0;
const BOID_MAX_SPEED = 1.6;
const BOID_DISTURBANCE_IMPULSE = 8.0;
const BOID_ORBIT_SWIRL = 3.2;
const BOID_ORBIT_ATTRACT = 2.4;
const USER_HOVER_LINGER_MS = 250;

export class GalleryBoidItemState {
  solver: GpgpuBoidSolver | null = null;
  private uniforms: ReturnType<typeof createBoidUniforms> | null = null;
  private currentHoverIntensity = 0;
  private glowEnvelope = 0;
  private readonly HOVER_RAMP = 0.35;
  private readonly HOVER_DECAY = 0.018;
  private readonly GLOW_HIT_GAIN = 0.35;
  private readonly GLOW_FADE_PER_SEC = 0.45;

  private autoCenter = new three.Vector3();
  private autoExtent = 1;
  private autoPos = new three.Vector3();
  private lastUserHoverWallMs = -1e9;

  private _tmpLocalCam = new three.Vector3();
  private _tmpAxis = new three.Vector3();

  params = {
    vortexStrength: 1.0,
    vortexRadius: 0.6,
    streak: 1.5,
    glow: 1.0,
    autoDemo: true,
    autoSpeed: 0.65,
  };

  init(pack: PackedSplats, renderer: three.WebGLRenderer): void {
    const positions: number[] = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    pack.forEachSplat((_i, center) => {
      positions.push(center.x, center.y, center.z);
      if (center.x < minX) minX = center.x;
      if (center.x > maxX) maxX = center.x;
      if (center.y < minY) minY = center.y;
      if (center.y > maxY) maxY = center.y;
      if (center.z < minZ) minZ = center.z;
      if (center.z > maxZ) maxZ = center.z;
    });
    const posArr = new Float32Array(positions);
    const count = posArr.length / 3;

    this.autoCenter.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
    this.autoExtent = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.45;

    const tree = new KdTree(posArr, count);
    const graph = buildKnnGraph(posArr, count, tree, 8);

    this.solver = new GpgpuBoidSolver(renderer, posArr, graph, count);
    this.uniforms = createBoidUniforms(
      this.solver.getOffsetTexture(),
      this.solver.getVelTexture(),
      this.solver.getGpgpuSize(),
    );
  }

  buildObjectModifier() {
    if (!this.uniforms) throw new Error('GalleryBoidItemState: init() must run before buildObjectModifier()');
    return createBoidObjectModifier({
      offsetTexUniform: this.uniforms.offsetTex,
      velTexUniform: this.uniforms.velTex,
      gpgpuSizeUniform: this.uniforms.gpgpuSize,
      streakUniform: this.uniforms.streak,
      glowUniform: this.uniforms.glow,
    });
  }

  update(splat: SplatMesh, deltaTime: number, elapsed: number, camera?: three.Camera): void {
    if (!this.solver || !this.uniforms) return;
    if (this.solver.hasInitError()) return;

    const userActive = performance.now() - this.lastUserHoverWallMs < USER_HOVER_LINGER_MS;
    const autoOrbitActive = this.params.autoDemo && !userActive;

    if (autoOrbitActive) {
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
    this.solver.hoverStrength = this.currentHoverIntensity * BOID_DISTURBANCE_IMPULSE * vs;
    this.solver.flockGate = this.currentHoverIntensity;
    this.solver.separation = BOID_SEPARATION;
    this.solver.alignment = BOID_ALIGNMENT;
    this.solver.cohesion = BOID_COHESION;
    this.solver.homeSpring = BOID_HOME_SPRING;
    this.solver.maxSpeed = BOID_MAX_SPEED;
    this.solver.disturbanceRadius = this.params.vortexRadius;
    this.solver.orbitSwirl = BOID_ORBIT_SWIRL * vs;
    this.solver.orbitAttract = BOID_ORBIT_ATTRACT * vs;

    if (camera) {
      this._tmpLocalCam.copy(camera.position);
      splat.worldToLocal(this._tmpLocalCam);
      this._tmpAxis.subVectors(this._tmpLocalCam, this.solver.getDisturbancePos());
      if (this._tmpAxis.lengthSq() > 1e-8) {
        this._tmpAxis.normalize();
        this.solver.orbitAxis.copy(this._tmpAxis);
      }
    }

    const dt = Math.max(0, deltaTime);
    this.glowEnvelope = Math.max(0, this.glowEnvelope - dt * this.GLOW_FADE_PER_SEC);

    this.uniforms.streak.value = this.params.streak;
    this.uniforms.glow.value = this.params.glow * this.glowEnvelope;

    this.solver.step(deltaTime, elapsed);

    this.uniforms.offsetTex.value = this.solver.getOffsetTexture();
    this.uniforms.velTex.value = this.solver.getVelTexture();
  }

  onHoverHit(worldPoint: three.Vector3, splat: SplatMesh): void {
    if (!this.solver) return;
    const now = performance.now();
    const local = worldPoint.clone();
    splat.worldToLocal(local);
    this.solver.setDisturbance(local, this.params.vortexRadius, 0);
    this.currentHoverIntensity = Math.min(1, this.currentHoverIntensity + this.HOVER_RAMP);
    this.glowEnvelope += (1 - this.glowEnvelope) * this.GLOW_HIT_GAIN;
    this.lastUserHoverWallMs = now;
  }

  reset(): void {
    this.solver?.reset();
    this.currentHoverIntensity = 0;
    this.glowEnvelope = 0;
  }

  dispose(): void {
    this.solver?.dispose();
    this.solver = null;
    this.uniforms = null;
  }
}
