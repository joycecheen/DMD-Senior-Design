// gpgpu boid overview
import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import type { KnnGraph } from '../wave/graph';
import boidShaderSource from './boid-gpgpu.glsl?raw';

export class GpgpuBoidSolver {
  private gpgpu: GPUComputationRenderer;
  private offsetVar: ReturnType<GPUComputationRenderer['addVariable']>;
  private velVar: ReturnType<GPUComputationRenderer['addVariable']>;
  private gpgpuSize: number;
  private meshSpacing: number;
  private dataTextures: THREE.DataTexture[] = [];
  private zeroTex: THREE.DataTexture | null = null;
  private initError: string | null = null;

  separation = 1.2;
  alignment = 1.0;
  cohesion = 0.8;
  homeSpring = 2.0;
  maxSpeed = 1.5;

  disturbanceRadius = 0.6;
  hoverStrength = 0.0;
  
  flockGate = 0.0;
  orbitSwirl = 3.0;
  orbitAttract = 2.5;
  
  orbitAxis = new THREE.Vector3(0, 1, 0);
  private disturbancePos = new THREE.Vector3(1e6, 1e6, 1e6);

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

    const initOffsetTex = this.gpgpu.createTexture();
    const initVelTex = this.gpgpu.createTexture();

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
    }

    this.offsetVar = this.gpgpu.addVariable('uOffsetTex', boidShaderSource, initOffsetTex);
    this.velVar = this.gpgpu.addVariable('uVelTex', boidShaderSource, initVelTex);

    this.gpgpu.setVariableDependencies(this.offsetVar, [this.offsetVar, this.velVar]);
    this.gpgpu.setVariableDependencies(this.velVar, [this.offsetVar, this.velVar]);

    this.wireUniforms(this.velVar.material.uniforms, size, basePosTex, neighborTex0, neighborTex1, 0);
    this.wireUniforms(this.offsetVar.material.uniforms, size, basePosTex, neighborTex0, neighborTex1, 1);

    const error = this.gpgpu.init();
    if (error !== null) {
      this.initError = String(error);
      console.error('[GpgpuBoidSolver] GPGPU init failed:', error);
    }
  }

  hasInitError(): boolean {
    return this.initError !== null;
  }

  step(deltaTime: number, elapsed: number): void {
    if (this.initError) return;
    const dt = Math.min(deltaTime, 0.033);
    const desiredSepDist = this.meshSpacing * 0.8;

    for (const uniforms of [this.velVar.material.uniforms, this.offsetVar.material.uniforms]) {
      uniforms.uTime.value = elapsed;
      uniforms.uDeltaTime.value = dt;
      uniforms.uSeparation.value = this.separation;
      uniforms.uAlignment.value = this.alignment;
      uniforms.uCohesion.value = this.cohesion;
      uniforms.uHomeSpring.value = this.homeSpring;
      uniforms.uMaxSpeed.value = this.maxSpeed;
      uniforms.uDesiredSepDist.value = desiredSepDist;
      uniforms.uDisturbancePos.value.copy(this.disturbancePos);
      uniforms.uDisturbanceRadius.value = this.disturbanceRadius;
      uniforms.uHoverStrength.value = this.hoverStrength;
      uniforms.uFlockGate.value = this.flockGate;
      (uniforms.uOrbitAxis.value as THREE.Vector3).copy(this.orbitAxis);
      uniforms.uOrbitSwirl.value = this.orbitSwirl;
      uniforms.uOrbitAttract.value = this.orbitAttract;
    }

    this.gpgpu.compute();
  }

  setDisturbance(localPos: THREE.Vector3, radius: number, strength: number): void {
    this.disturbancePos.copy(localPos);
    this.disturbanceRadius = radius;
    this.hoverStrength = strength;
  }

  clearDisturbance(): void {
    this.disturbancePos.set(1e6, 1e6, 1e6);
    this.hoverStrength = 0;
  }

  reset(): void {
    if (this.initError) return;
    if (!this.zeroTex) {
      this.zeroTex = this.gpgpu.createTexture();
    }
    this.gpgpu.renderTexture(this.zeroTex, this.gpgpu.getCurrentRenderTarget(this.offsetVar));
    this.gpgpu.renderTexture(this.zeroTex, this.gpgpu.getCurrentRenderTarget(this.velVar));
    this.disturbancePos.set(1e6, 1e6, 1e6);
    this.hoverStrength = 0;
  }

  getOffsetTexture(): THREE.Texture {
    return this.gpgpu.getCurrentRenderTarget(this.offsetVar).texture;
  }

  getVelTexture(): THREE.Texture {
    return this.gpgpu.getCurrentRenderTarget(this.velVar).texture;
  }

  getDisturbancePos(): THREE.Vector3 {
    return this.disturbancePos;
  }

  getGpgpuSize(): number {
    return this.gpgpuSize;
  }

  getMeshSpacing(): number {
    return this.meshSpacing;
  }

  dispose(): void {
    this.gpgpu.dispose();
    for (const tex of this.dataTextures) {
      tex.dispose();
    }
    this.dataTextures = [];
    this.zeroTex?.dispose();
    this.zeroTex = null;
  }

  private wireUniforms(
    uniforms: Record<string, { value: unknown }>,
    size: number,
    basePosTex: THREE.DataTexture,
    neighborTex0: THREE.DataTexture,
    neighborTex1: THREE.DataTexture,
    pass: number,
  ): void {
    uniforms.uPass = { value: pass };
    uniforms.uTime = { value: 0 };
    uniforms.uDeltaTime = { value: 0.016 };
    uniforms.uSeparation = { value: this.separation };
    uniforms.uAlignment = { value: this.alignment };
    uniforms.uCohesion = { value: this.cohesion };
    uniforms.uHomeSpring = { value: this.homeSpring };
    uniforms.uMaxSpeed = { value: this.maxSpeed };
    uniforms.uDesiredSepDist = { value: this.meshSpacing * 0.8 };
    uniforms.uDisturbancePos = { value: this.disturbancePos.clone() };
    uniforms.uDisturbanceRadius = { value: this.disturbanceRadius };
    uniforms.uHoverStrength = { value: this.hoverStrength };
    uniforms.uFlockGate = { value: this.flockGate };
    uniforms.uOrbitAxis = { value: this.orbitAxis.clone() };
    uniforms.uOrbitSwirl = { value: this.orbitSwirl };
    uniforms.uOrbitAttract = { value: this.orbitAttract };
    uniforms.uGpgpuSize = { value: size };
    uniforms.uBasePosTex = { value: basePosTex };
    uniforms.uNeighborTex0 = { value: neighborTex0 };
    uniforms.uNeighborTex1 = { value: neighborTex1 };
  }

  private createDataTexture(size: number): THREE.DataTexture {
    const data = new Float32Array(size * size * 4);
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
    tex.needsUpdate = true;
    this.dataTextures.push(tex);
    return tex;
  }
}
