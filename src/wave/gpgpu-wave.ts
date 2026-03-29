// Wave equation on GPU (GPUComputationRenderer).

import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import type { KnnGraph } from './graph';
import waveShaderSource from './wave-gpgpu.glsl?raw';

export type SourceType = 'impulse' | 'sine' | 'gaussian-packet';

export interface WaveSource {
  uv: [number, number];
  amplitude: number;
  frequency: number;
  startTime: number;
  radius: number;
  type: SourceType;
}

const MAX_SOURCES = 8;
const SOURCE_TYPE_MAP: Record<SourceType, number> = {
  'impulse': 0,
  'sine': 1,
  'gaussian-packet': 2,
};

export class GpgpuWaveSolver {
  private gpgpu: GPUComputationRenderer;
  private waveVariable: ReturnType<GPUComputationRenderer['addVariable']>;
  private gpgpuSize: number;
  private meshSpacing: number;
  private sources: (WaveSource & { active: boolean })[] = [];

  waveSpeed = 3.0;
  damping = 0.05;
  flowFieldStrength = 0.3;
  flowFieldFrequency = 0.8;
  boundaryAbsorb = 1.0;

  constructor(
    renderer: THREE.WebGLRenderer,
    positions: Float32Array,
    graph: KnnGraph,
    count: number,
  ) {
    this.gpgpuSize = Math.ceil(Math.sqrt(count));
    this.meshSpacing = graph.meanEdgeLength;
    const size = this.gpgpuSize;

    this.gpgpu = new GPUComputationRenderer(size, size, renderer);

    const initWaveTex = this.gpgpu.createTexture();

    // Base positions
    const basePosTex = this.createDataTexture(size);
    const basePosData = basePosTex.image.data as Float32Array;
    for (let i = 0; i < count; i++) {
      basePosData[i * 4 + 0] = positions[i * 3 + 0];
      basePosData[i * 4 + 1] = positions[i * 3 + 1];
      basePosData[i * 4 + 2] = positions[i * 3 + 2];
      basePosData[i * 4 + 3] = 0;
    }

    const neighborTex0 = this.createDataTexture(size);
    const neighborTex1 = this.createDataTexture(size);
    const n0Data = neighborTex0.image.data as Float32Array;
    const n1Data = neighborTex1.image.data as Float32Array;

    const weightTex0 = this.createDataTexture(size);
    const weightTex1 = this.createDataTexture(size);
    const w0Data = weightTex0.image.data as Float32Array;
    const w1Data = weightTex1.image.data as Float32Array;

    const k = graph.k;
    for (let i = 0; i < count; i++) {
      const base = i * k;
      n0Data[i * 4 + 0] = graph.neighborIndices[base + 0];
      n0Data[i * 4 + 1] = graph.neighborIndices[base + 1];
      n0Data[i * 4 + 2] = graph.neighborIndices[base + 2];
      n0Data[i * 4 + 3] = graph.neighborIndices[base + 3];
      n1Data[i * 4 + 0] = graph.neighborIndices[base + 4];
      n1Data[i * 4 + 1] = graph.neighborIndices[base + 5];
      n1Data[i * 4 + 2] = graph.neighborIndices[base + 6];
      n1Data[i * 4 + 3] = graph.neighborIndices[base + 7];

      w0Data[i * 4 + 0] = graph.neighborWeights[base + 0];
      w0Data[i * 4 + 1] = graph.neighborWeights[base + 1];
      w0Data[i * 4 + 2] = graph.neighborWeights[base + 2];
      w0Data[i * 4 + 3] = graph.neighborWeights[base + 3];
      w1Data[i * 4 + 0] = graph.neighborWeights[base + 4];
      w1Data[i * 4 + 1] = graph.neighborWeights[base + 5];
      w1Data[i * 4 + 2] = graph.neighborWeights[base + 6];
      w1Data[i * 4 + 3] = graph.neighborWeights[base + 7];
    }

    const boundaryTex = this.createDataTexture(size);
    const bData = boundaryTex.image.data as Float32Array;
    for (let i = 0; i < count; i++) {
      bData[i * 4 + 0] = graph.isBoundary[i];
      bData[i * 4 + 1] = 0;
      bData[i * 4 + 2] = 0;
      bData[i * 4 + 3] = 0;
    }

    this.waveVariable = this.gpgpu.addVariable('uWaveState', waveShaderSource, initWaveTex);
    this.gpgpu.setVariableDependencies(this.waveVariable, [this.waveVariable]);

    const uniforms = this.waveVariable.material.uniforms;
    uniforms.uTime = { value: 0 };
    uniforms.uDeltaTime = { value: 0.016 };
    uniforms.uWaveSpeed = { value: this.waveSpeed };
    uniforms.uDamping = { value: this.damping };
    uniforms.uFlowFieldStrength = { value: this.flowFieldStrength };
    uniforms.uFlowFieldFrequency = { value: this.flowFieldFrequency };
    uniforms.uGpgpuSize = { value: size };
    uniforms.uMeshSpacing = { value: this.meshSpacing };
    uniforms.uKNeighbors = { value: graph.k };
    uniforms.uBoundaryAbsorb = { value: this.boundaryAbsorb };

    uniforms.uNeighborTex0 = { value: neighborTex0 };
    uniforms.uNeighborTex1 = { value: neighborTex1 };
    uniforms.uWeightTex0 = { value: weightTex0 };
    uniforms.uWeightTex1 = { value: weightTex1 };
    uniforms.uBasePosTex = { value: basePosTex };
    uniforms.uBoundaryTex = { value: boundaryTex };

    uniforms.uNumSources = { value: 0 };

    const emptyVec4 = new THREE.Vector4(0, 0, 0, 0);
    uniforms.uSources = { value: Array.from({ length: MAX_SOURCES }, () => emptyVec4.clone()) };
    uniforms.uSourceParams = { value: Array.from({ length: MAX_SOURCES }, () => emptyVec4.clone()) };

    const error = this.gpgpu.init();
    if (error !== null) {
      console.error('GPGPU init error:', error);
    }
  }

  step(deltaTime: number, elapsed: number): void {
    const dt = Math.min(deltaTime, 0.033);

    const uniforms = this.waveVariable.material.uniforms;
    uniforms.uTime.value = elapsed;
    uniforms.uDeltaTime.value = dt;
    uniforms.uWaveSpeed.value = this.waveSpeed;
    uniforms.uDamping.value = this.damping;
    uniforms.uFlowFieldStrength.value = this.flowFieldStrength;
    uniforms.uFlowFieldFrequency.value = this.flowFieldFrequency;
    uniforms.uBoundaryAbsorb.value = this.boundaryAbsorb;

    this.expireSources(elapsed);
    this.syncSourceUniforms(uniforms);

    this.gpgpu.compute();
  }

  addSource(source: WaveSource): void {
    if (this.sources.length >= MAX_SOURCES) {
      this.sources.shift();
    }
    this.sources.push({ ...source, active: true });
  }

  reset(): void {
    this.sources = [];
    const initTex = this.gpgpu.createTexture();
    this.gpgpu.renderTexture(initTex, this.gpgpu.getCurrentRenderTarget(this.waveVariable));
  }

  getWaveTexture(): THREE.Texture {
    return this.gpgpu.getCurrentRenderTarget(this.waveVariable).texture;
  }

  getGpgpuSize(): number {
    return this.gpgpuSize;
  }

  getMeshSpacing(): number {
    return this.meshSpacing;
  }

  indexToUV(splatIndex: number): [number, number] {
    const size = this.gpgpuSize;
    const y = Math.floor(splatIndex / size);
    const x = splatIndex - y * size;
    return [(x + 0.5) / size, (y + 0.5) / size];
  }

  dispose(): void {
    this.gpgpu.dispose();
  }

  private expireSources(elapsed: number): void {
    this.sources = this.sources.filter(s => {
      const age = elapsed - s.startTime;
      if (s.type === 'impulse' && age > 0.5) return false;
      if (s.type === 'sine' && age > 15) return false;
      if (s.type === 'gaussian-packet' && age > 5) return false;
      return true;
    });
  }

  private syncSourceUniforms(uniforms: Record<string, { value: unknown }>): void {
    const sourcesArr = uniforms.uSources.value as THREE.Vector4[];
    const paramsArr = uniforms.uSourceParams.value as THREE.Vector4[];

    for (let i = 0; i < MAX_SOURCES; i++) {
      if (i < this.sources.length) {
        const s = this.sources[i];
        sourcesArr[i].set(s.uv[0], s.uv[1], s.radius, s.amplitude);
        paramsArr[i].set(s.frequency, s.startTime, SOURCE_TYPE_MAP[s.type], 1.0);
      } else {
        sourcesArr[i].set(0, 0, 0, 0);
        paramsArr[i].set(0, 0, 0, 0);
      }
    }
    uniforms.uNumSources.value = this.sources.length;
  }

  private createDataTexture(size: number): THREE.DataTexture {
    const data = new Float32Array(size * size * 4);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    return tex;
  }
}
