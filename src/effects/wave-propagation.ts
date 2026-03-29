import * as THREE from 'three';
import { SplatMesh, dyno } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';

const SPLAT_URL = 'https://sparkjs.dev/assets/splats/cat.spz';
const MODEL_PLANE_Z = -2.5;
const MAX_SOURCES = 4;

interface WaveSource {
  origin: THREE.Vector3;
  startTime: number;
}

export class WavePropagationEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'wave-propagation',
    name: 'Wave Equation',
    description: 'Waves on a Gaussian splat point cloud',
    category: 'simulation',
  };

  private splatMesh: SplatMesh | null = null;
  private sceneManager: SceneManager | null = null;
  private raycaster = new THREE.Raycaster();

  private timeUniform = dyno.dynoFloat(0);
  private waveSpeedUniform = dyno.dynoFloat(1.2);
  private dampingUniform = dyno.dynoFloat(0.6);
  private dispScaleUniform = dyno.dynoFloat(0.25);
  private waveFreqUniform = dyno.dynoFloat(12.0);
  private dotScaleUniform = dyno.dynoFloat(0.12);
  private floatAmpUniform = dyno.dynoFloat(0.015);

  // Up to 4 sources: vec3 origin, float start time (-1 = off)
  private srcPos: THREE.Vector3[] = [];
  private srcTime: number[] = [];
  private srcPosUniforms: ReturnType<typeof dyno.dynoVec3>[] = [];
  private srcTimeUniforms: ReturnType<typeof dyno.dynoFloat>[] = [];

  private sources: WaveSource[] = [];
  private nextAutoEmit = 0;
  private splatBBox: THREE.Box3 | null = null;
  private isDragging = false;

  private params = {
    waveSpeed: 1.2,
    damping: 0.6,
    displaceScale: 0.25,
    waveFrequency: 12.0,
    dotScale: 0.12,
    floatAmplitude: 0.015,
    autoEmit: true,
    autoEmitInterval: 2.0,
  };

  constructor() {
    super();
    for (let i = 0; i < MAX_SOURCES; i++) {
      this.srcPos.push(new THREE.Vector3(999, 999, 999));
      this.srcTime.push(-1);
      this.srcPosUniforms.push(dyno.dynoVec3(new THREE.Vector3(999, 999, 999)));
      this.srcTimeUniforms.push(dyno.dynoFloat(-1));
    }
  }

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;

    this.splatMesh = new SplatMesh({ url: SPLAT_URL });

    this.splatMesh.quaternion.set(1, 0, 0, 0);
    this.splatMesh.position.set(0, -0.5, MODEL_PLANE_Z);
    this.splatMesh.scale.set(0.5, 0.5, 0.5);

    this.splatMesh.objectModifier = this.buildModifier();

    sceneManager.scene.add(this.splatMesh);
    await this.splatMesh.initialized;
    this.splatMesh.updateGenerator();

    this.splatBBox = this.splatMesh.getBoundingBox(true);

    this.emitRandomWave(0);
    this.emitRandomWave(0);
  }

  private buildModifier() {
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
              vec3 baseCol = clamp(origColor.rgb + jitter, 0.0, 1.0);

              ${outputs.gsplat}.rgba.rgb = baseCol;
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
      },
    );
  }

  update(_deltaTime: number, elapsed: number): void {
    if (!this.splatMesh) return;

    this.timeUniform.value = elapsed;

    this.sources = this.sources.filter(s => (elapsed - s.startTime) < 8);

    if (this.params.autoEmit && elapsed >= this.nextAutoEmit) {
      this.emitRandomWave(elapsed);
      this.nextAutoEmit = elapsed + this.params.autoEmitInterval;
    }

    for (let i = 0; i < MAX_SOURCES; i++) {
      const posVal = this.srcPosUniforms[i].value as THREE.Vector3;
      if (i < this.sources.length) {
        posVal.copy(this.sources[i].origin);
        this.srcTimeUniforms[i].value = this.sources[i].startTime;
      } else {
        posVal.set(999, 999, 999);
        this.srcTimeUniforms[i].value = -1;
      }
    }

    this.splatMesh.needsUpdate = true;
  }

  private emitRandomWave(elapsed: number): void {
    if (!this.splatBBox) return;

    const min = this.splatBBox.min;
    const max = this.splatBBox.max;
    const origin = new THREE.Vector3(
      min.x + Math.random() * (max.x - min.x),
      min.y + Math.random() * (max.y - min.y),
      min.z + Math.random() * (max.z - min.z),
    );

    this.addSource(origin, elapsed);
  }

  private addSource(localOrigin: THREE.Vector3, elapsed: number): void {
    if (this.sources.length >= MAX_SOURCES) {
      this.sources.shift();
    }
    this.sources.push({ origin: localOrigin, startTime: elapsed });
  }

  onPointerDown(event: PointerEvent): void {
    this.isDragging = true;
    this.injectSourceFromPointer(event);
  }

  onPointerMove(event: PointerEvent): void {
    if (this.isDragging) {
      this.injectSourceFromPointer(event);
    }
  }

  onPointerUp(): void {
    this.isDragging = false;
  }

  private injectSourceFromPointer(event: PointerEvent): void {
    if (!this.sceneManager || !this.splatMesh) return;

    const { canvas, camera } = this.sceneManager;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const ray = this.raycaster.ray;
    const t = (MODEL_PLANE_Z - ray.origin.z) / ray.direction.z;
    if (t <= 0 || t > 100) return;

    const hitWorld = ray.origin.clone().addScaledVector(ray.direction, t);
    const hitLocal = hitWorld.clone();
    this.splatMesh.worldToLocal(hitLocal);

    this.addSource(hitLocal, this.timeUniform.value);
  }

  buildGui(gui: GUI): void {
    const waveFolder = gui.addFolder('Wave Physics');
    waveFolder.add(this.params, 'waveSpeed', 0.2, 5.0, 0.1).name('Wave Speed')
      .onChange((v: number) => { this.waveSpeedUniform.value = v; });
    waveFolder.add(this.params, 'damping', 0.05, 2.0, 0.05).name('Damping')
      .onChange((v: number) => { this.dampingUniform.value = v; });
    waveFolder.add(this.params, 'waveFrequency', 2.0, 30.0, 0.5).name('Frequency')
      .onChange((v: number) => { this.waveFreqUniform.value = v; });

    const vizFolder = gui.addFolder('Visualization');
    vizFolder.add(this.params, 'displaceScale', 0.0, 1.0, 0.01).name('Displace Scale')
      .onChange((v: number) => { this.dispScaleUniform.value = v; });

    const cloudFolder = gui.addFolder('Point Cloud');
    cloudFolder.add(this.params, 'dotScale', 0.02, 0.5, 0.01).name('Particle Size')
      .onChange((v: number) => { this.dotScaleUniform.value = v; });
    cloudFolder.add(this.params, 'floatAmplitude', 0.0, 0.05, 0.001).name('Float Amplitude')
      .onChange((v: number) => { this.floatAmpUniform.value = v; });

    const autoFolder = gui.addFolder('Auto Emit');
    autoFolder.add(this.params, 'autoEmit').name('Enabled');
    autoFolder.add(this.params, 'autoEmitInterval', 0.5, 5.0, 0.1).name('Interval (s)');

    gui.add({
      reset: () => {
        this.sources = [];
        this.nextAutoEmit = 0;
      },
    }, 'reset').name('Reset Waves');
  }

  dispose(): void {
    if (this.splatMesh) {
      this.sceneManager?.scene.remove(this.splatMesh);
      this.splatMesh.dispose();
      this.splatMesh = null;
    }
  }
}
