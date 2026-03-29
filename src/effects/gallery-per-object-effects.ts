import * as three from 'three';
import { dyno } from '@sparkjsdev/spark';
import type { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';

const MAX_WAVE_SOURCES = 4;

export type GalleryEffectMode =
  | 'dissolve-reform'
  | 'wave-propagation'
  | 'splat-painting'
  | 'point-cloud-disperse'
  | 'shader-stylize';

// Dissolve / reform

export function createDissolveReformModifier(animateT: ReturnType<typeof dyno.dynoFloat>) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, t: 'float' },
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
            float startTime = hashVal.x * 0.8;
            float localT = clamp((${inputs.t} - startTime) / 0.5, 0.0, 1.0);
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
      gsplat = d.apply({ gsplat, t: animateT }).gsplat;
      return { gsplat };
    }
  );
}

// Shader stylize

export function createShaderStylizeModifier(
  animateT: ReturnType<typeof dyno.dynoFloat>,
  intensity: ReturnType<typeof dyno.dynoFloat>
) {
  return dyno.dynoBlock(
    { gsplat: dyno.Gsplat },
    { gsplat: dyno.Gsplat },
    ({ gsplat }) => {
      const d = new dyno.Dyno({
        inTypes: { gsplat: dyno.Gsplat, t: 'float', intensity: 'float' },
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
            float elongate = mix(1.0, 3.2, ${inputs.intensity});
            ${outputs.gsplat}.scales = vec3(
              scales.x * elongate,
              scales.y * 0.45,
              scales.z * 0.45
            );
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
      gsplat = d.apply({ gsplat, t: animateT, intensity }).gsplat;
      return { gsplat };
    }
  );
}

// Wave propagation (per object)

export class GalleryWaveItemState {
  timeUniform = dyno.dynoFloat(0);
  waveSpeedUniform = dyno.dynoFloat(1.2);
  dampingUniform = dyno.dynoFloat(0.6);
  dispScaleUniform = dyno.dynoFloat(0.1);
  waveFreqUniform = dyno.dynoFloat(12.0);
  dotScaleUniform = dyno.dynoFloat(0.5);
  floatAmpUniform = dyno.dynoFloat(0.009);
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
    dotScale: 0.5,
    floatAmplitude: 0.009,
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
      waveFreqUniform, dotScaleUniform, floatAmpUniform,
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
            uDotScale: 'float',
            uFloatAmp: 'float',
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
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 pos = ${inputs.gsplat}.center;
              vec3 origScales = ${inputs.gsplat}.scales;
              vec4 origColor = ${inputs.gsplat}.rgba;
              vec3 hv = waveHash(pos);
              float t = ${inputs.uTime};
              ${outputs.gsplat}.scales = origScales * ${inputs.uDotScale};
              float phase = hv.x * 6.28 + hv.y * 6.28;
              float amp = ${inputs.uFloatAmp} * (0.6 + 0.8 * hv.z);
              vec3 floatOffset = vec3(
                sin(t * 0.7 + phase) * amp,
                sin(t * 0.5 + phase * 1.3) * amp,
                sin(t * 0.6 + phase * 0.7) * amp
              );
              pos += floatOffset;
              float totalDisp = 0.0;
              if (${inputs.uSrc0Time} >= 0.0) {
                float age = t - ${inputs.uSrc0Time};
                float fadeIn = smoothstep(0.0, 0.5, age);
                float dist = length(pos - ${inputs.uSrc0Pos});
                float wavefront = dist - age * ${inputs.uWaveSpeed};
                float envelope = fadeIn * exp(-${inputs.uDamping} * age) * exp(-wavefront * wavefront * 2.0);
                float wave = envelope * sin(${inputs.uWaveFreq} * wavefront);
                totalDisp += wave;
              }
              if (${inputs.uSrc1Time} >= 0.0) {
                float age = t - ${inputs.uSrc1Time};
                float fadeIn = smoothstep(0.0, 0.5, age);
                float dist = length(pos - ${inputs.uSrc1Pos});
                float wavefront = dist - age * ${inputs.uWaveSpeed};
                float envelope = fadeIn * exp(-${inputs.uDamping} * age) * exp(-wavefront * wavefront * 2.0);
                float wave = envelope * sin(${inputs.uWaveFreq} * wavefront);
                totalDisp += wave;
              }
              if (${inputs.uSrc2Time} >= 0.0) {
                float age = t - ${inputs.uSrc2Time};
                float fadeIn = smoothstep(0.0, 0.5, age);
                float dist = length(pos - ${inputs.uSrc2Pos});
                float wavefront = dist - age * ${inputs.uWaveSpeed};
                float envelope = fadeIn * exp(-${inputs.uDamping} * age) * exp(-wavefront * wavefront * 2.0);
                float wave = envelope * sin(${inputs.uWaveFreq} * wavefront);
                totalDisp += wave;
              }
              if (${inputs.uSrc3Time} >= 0.0) {
                float age = t - ${inputs.uSrc3Time};
                float fadeIn = smoothstep(0.0, 0.5, age);
                float dist = length(pos - ${inputs.uSrc3Pos});
                float wavefront = dist - age * ${inputs.uWaveSpeed};
                float envelope = fadeIn * exp(-${inputs.uDamping} * age) * exp(-wavefront * wavefront * 2.0);
                float wave = envelope * sin(${inputs.uWaveFreq} * wavefront);
                totalDisp += wave;
              }
              vec3 normal = normalize(pos + (hv - 0.5) * 0.1);
              pos += normal * totalDisp * ${inputs.uDispScale};
              float absDisp = min(abs(totalDisp) * 4.0, 1.0);
              ${outputs.gsplat}.scales *= (1.0 + absDisp * 0.6);
              ${outputs.gsplat}.center = pos;
              vec3 jitter = (hv - 0.5) * 0.15;
              ${outputs.gsplat}.rgba.rgb = clamp(origColor.rgb + jitter, 0.0, 1.0);
            `),
        });
        gsplat = d.apply({
          gsplat,
          uTime: timeUniform,
          uWaveSpeed: waveSpeedUniform,
          uDamping: dampingUniform,
          uDispScale: dispScaleUniform,
          uWaveFreq: waveFreqUniform,
          uDotScale: dotScaleUniform,
          uFloatAmp: floatAmpUniform,
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
    this.dotScaleUniform.value = this.params.dotScale;
    this.floatAmpUniform.value = this.params.floatAmplitude;
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
    splat.needsUpdate = true;
  }

  injectFromWorldPoint(worldPoint: three.Vector3, splat: SplatMesh): void {
    const local = worldPoint.clone();
    splat.worldToLocal(local);
    this.addSource(local, this.timeUniform.value);
  }
}

// Splat painting

export class GalleryPaintItemState {
  brushEnabled = dyno.dynoBool(true);
  eraseEnabled = dyno.dynoBool(false);
  brushRadius = dyno.dynoFloat(0.05);
  brushDepth = dyno.dynoFloat(10.0);
  brushOrigin = dyno.dynoVec3(new three.Vector3(0, 0, 0));
  brushDirection = dyno.dynoVec3(new three.Vector3(0, 0, -1));
  brushColor = dyno.dynoVec3(new three.Vector3(1.0, 0.0, 1.0));
  isDragging = false;
  params = {
    color: '#ff00ff',
    brushSize: 0.05,
    mode: 'paint' as 'paint' | 'erase',
  };

  buildWorldModifier() {
    const {
      brushEnabled, eraseEnabled, brushRadius, brushDepth,
      brushOrigin, brushDirection, brushColor,
    } = this;
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            brushOn: 'bool',
            eraseOn: 'bool',
            bRadius: 'float',
            bDepth: 'float',
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
                && projAmp < ${inputs.bDepth};
              if (${inputs.brushOn} && isInside) {
                float lumOld = dot(rgb, vec3(0.333));
                float lumNew = dot(${inputs.bColor}, vec3(0.333));
                if (lumOld > 0.05 && lumNew > 0.01) {
                  ${outputs.gsplat}.rgba.rgb = ${inputs.bColor} * (lumOld / lumNew);
                }
              }
              if (${inputs.eraseOn} && isInside) {
                ${outputs.gsplat}.rgba.w = 0.0;
              }
            `),
        });
        gsplat = d.apply({
          gsplat,
          brushOn: brushEnabled,
          eraseOn: eraseEnabled,
          bRadius: brushRadius,
          bDepth: brushDepth,
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
  }

  updateBrushFromPointer(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: three.PerspectiveCamera,
    raycaster: three.Raycaster
  ): void {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new three.Vector2(x, y), camera);
    this.brushDirection.value.copy(raycaster.ray.direction).normalize();
    this.brushOrigin.value.copy(raycaster.ray.origin);
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
}

// Point cloud disperse

export class GalleryDisperseItemState {
  brushOrigin = dyno.dynoVec3(new three.Vector3(1000, 1000, 1000));
  brushRadius = dyno.dynoFloat(0.35);
  pushStrength = dyno.dynoFloat(0.12);
  disperseIntensity = dyno.dynoFloat(0);
  animateT = dyno.dynoFloat(0);

  private lastBrushOrigin = new three.Vector3(1000, 1000, 1000);
  private currentDisperseIntensity = 0;
  private readonly DISPERSE_RAMP = 0.35;
  private readonly DISPERSE_RETURN_SPEED = 0.005;

  params = {
    brushSize: 0.35,
    pushStrength: 0.12,
  };

  buildObjectModifier() {
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: { gsplat: dyno.Gsplat },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 pointCloudHash(vec3 p) {
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
              vec3 hv = pointCloudHash(pos);
              float dotScale = 0.35;
              ${outputs.gsplat}.scales = scales * dotScale;
              vec3 jitter = (hv - 0.5) * 0.25;
              ${outputs.gsplat}.rgba.rgb = clamp(col.rgb + jitter, 0.0, 1.0);
            `),
        });
        return { gsplat: d.apply({ gsplat }).gsplat };
      }
    );
  }

  buildWorldModifier() {
    const { brushOrigin, brushRadius, pushStrength, disperseIntensity, animateT } = this;
    return dyno.dynoBlock(
      { gsplat: dyno.Gsplat },
      { gsplat: dyno.Gsplat },
      ({ gsplat }) => {
        const d = new dyno.Dyno({
          inTypes: {
            gsplat: dyno.Gsplat,
            brushOrigin: 'vec3',
            brushRadius: 'float',
            pushStrength: 'float',
            disperseIntensity: 'float',
            t: 'float',
          },
          outTypes: { gsplat: dyno.Gsplat },
          globals: () => [
            dyno.unindent(`
              vec3 disperseHash(vec3 p) {
                return fract(sin(p * 127.1 + vec3(311.7, 74.7, 269.5)) * 43758.5453);
              }
            `),
          ],
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              vec3 center = ${inputs.gsplat}.center;
              vec3 hv = disperseHash(center);

              float phase = hv.x * 6.28 + hv.y * 6.28;
              float amp = 0.012 + 0.008 * hv.z;
              vec3 floatOffset = vec3(
                sin(${inputs.t} * 0.7 + phase) * amp,
                sin(${inputs.t} * 0.5 + phase * 1.3) * amp,
                sin(${inputs.t} * 0.6 + phase * 0.7) * amp
              );
              center += floatOffset * 3.0;

              vec3 toBrush = center - ${inputs.brushOrigin};
              float dist = length(toBrush);
              if (dist < ${inputs.brushRadius} && dist > 0.001 && ${inputs.disperseIntensity} > 0.01) {
                float falloff = 1.0 - smoothstep(0.0, ${inputs.brushRadius}, dist);
                vec3 pushDir = normalize(toBrush + (hv - 0.5) * 0.4);
                float vary = 0.5 + hv.x * 0.6 + hv.y * 0.4;
                float push = ${inputs.pushStrength} * falloff * ${inputs.disperseIntensity} * vary;
                center += pushDir * push;
              }

              ${outputs.gsplat}.center = center;
            `),
        });
        gsplat = d.apply({
          gsplat,
          brushOrigin,
          brushRadius,
          pushStrength,
          disperseIntensity,
          t: animateT,
        }).gsplat;
        return { gsplat };
      }
    );
  }

  updateBrushFromPointer(
    event: PointerEvent,
    canvas: HTMLCanvasElement,
    camera: three.PerspectiveCamera,
    raycaster: three.Raycaster,
    proxy: three.Mesh
  ): void {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new three.Vector2(x, y), camera);
    const hits = raycaster.intersectObject(proxy, false);
    if (hits.length > 0) {
      this.brushOrigin.value.copy(hits[0]!.point);
      const moveDist = this.brushOrigin.value.distanceTo(this.lastBrushOrigin);
      this.currentDisperseIntensity = Math.min(
        1,
        this.currentDisperseIntensity + moveDist * 3 + this.DISPERSE_RAMP
      );
      this.lastBrushOrigin.copy(this.brushOrigin.value);
    } else {
      this.brushOrigin.value.set(1000, 1000, 1000);
    }
  }

  update(splat: SplatMesh, elapsed: number): void {
    this.animateT.value = elapsed;
    this.currentDisperseIntensity +=
      (0 - this.currentDisperseIntensity) * this.DISPERSE_RETURN_SPEED;
    this.disperseIntensity.value = this.currentDisperseIntensity;
    splat.needsUpdate = true;
  }
}
