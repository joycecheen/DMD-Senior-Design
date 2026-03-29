import * as THREE from 'three';
import { SplatMesh, dyno, PackedSplats } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';
import type { GalleryEffectMode } from './gallery-per-object-effects';
import {
  createDissolveReformModifier,
  createShaderStylizeModifier,
  GalleryDisperseItemState,
  GalleryPaintItemState,
  GalleryWaveItemState,
} from './gallery-per-object-effects';

interface ShowcaseItem {
  id: string;
  name: string;
  url: string;
  effectMode: GalleryEffectMode;
  description: string;
  anchor: THREE.Group;
  splat: SplatMesh;
  proxy: THREE.Mesh;
  // World position before bob animation
  basePosition: THREE.Vector3;
  bobOffset: number;
  spinSpeed: number;
  spinAxisWorld: THREE.Vector3;
  spinSign: number;
  bobAmp: number;
  baseScale: number;
  // Sliders; spin speed bump comes from selection, not the GUI
  params: {
    amount: number;
    aux: number;
    spinMultiplier: number;
    dissolve: number;
    autoPlay: boolean;
    dissolveSpeed: number;
  };
  dissolveAnimT?: ReturnType<typeof dyno.dynoFloat>;
  wave?: GalleryWaveItemState;
  paint?: GalleryPaintItemState;
  stylizeAnimT?: ReturnType<typeof dyno.dynoFloat>;
  stylizeIntensity?: ReturnType<typeof dyno.dynoFloat>;
  disperse?: GalleryDisperseItemState;
}

type ObjectConfig = Omit<
  ShowcaseItem,
  | 'anchor'
  | 'splat'
  | 'proxy'
  | 'basePosition'
  | 'bobOffset'
  | 'spinSpeed'
  | 'spinAxisWorld'
  | 'spinSign'
  | 'bobAmp'
  | 'baseScale'
  | 'params'
  | 'dissolveAnimT'
  | 'wave'
  | 'paint'
  | 'stylizeAnimT'
  | 'stylizeIntensity'
  | 'disperse'
> & { displayScale: number };

// lil-gui title + folder label per mode
const EFFECT_GUI_LABEL: Record<GalleryEffectMode, string> = {
  'dissolve-reform': 'Dissolve & reform',
  'wave-propagation': 'Wave propagation',
  'splat-painting': 'Splat painting',
  'shader-stylize': 'Shader stylize (sparkle)',
  'point-cloud-disperse': 'Point cloud disperse',
};

// Starting positions (same order as OBJECTS)
const GALLERY_LAYOUT_START: THREE.Vector3[] = [
  new THREE.Vector3(-1.86, 1.08, 2.26), // redcar
  new THREE.Vector3(0.8, -0.38, 1.98), // chicken
  new THREE.Vector3(-1.86, -0.98, 0.8), // fish
  new THREE.Vector3(0.2, 1.68, 0.35), // bomb
  new THREE.Vector3(2.56, 0.8, 1.68), // sheep
];

const OBJECTS: ObjectConfig[] = [
  {
    id: 'redcar',
    name: 'Red Car',
    url: new URL('../../objects/redcar.spz', import.meta.url).href,
    effectMode: 'shader-stylize',
    description: 'Sparkle stylize',
    displayScale: 2.5,
  },
  {
    id: 'chicken',
    name: 'Chicken',
    url: new URL('../../objects/chicken.spz', import.meta.url).href,
    effectMode: 'splat-painting',
    description: 'Paint when selected',
    displayScale: 2.0,
  },
  {
    id: 'fish',
    name: 'Goldfish',
    url: new URL('../../objects/fish.spz', import.meta.url).href,
    effectMode: 'point-cloud-disperse',
    description: 'Disperse on hover',
    displayScale: 2.5,
  },
  {
    id: 'bomb',
    name: 'Bomb',
    url: new URL('../../objects/bomb.spz', import.meta.url).href,
    effectMode: 'dissolve-reform',
    description: 'Dissolve & reform',
    displayScale: 2.0,
  },
  {
    id: 'sheep',
    name: 'Sheep',
    url: new URL('../../objects/sheep.spz', import.meta.url).href,
    effectMode: 'wave-propagation',
    description: 'Waves: click or drag',
    displayScale: 2.0,
  },
];

const OPACITY_THRESHOLD = 0.15;

// Skip nearly invisible splats (helps depth sort)
async function loadFilteredPack(url: string): Promise<PackedSplats> {
  const source = new PackedSplats({ url });
  await source.initialized;
  const filtered = new PackedSplats({ maxSplats: source.numSplats });
  source.forEachSplat((_i, center, scales, quaternion, opacity, color) => {
    if (opacity >= OPACITY_THRESHOLD) {
      filtered.pushSplat(center, scales, quaternion, opacity, color);
    }
  });
  source.dispose();
  await filtered.initialized;
  return filtered;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const _eTilt = new THREE.Euler();

const SPIN_AXES: THREE.Vector3[] = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 1, 0.35).normalize(),
  new THREE.Vector3(0.2, 1, 0.15).normalize(),
];
const SPIN_SIGNS = [1, -1, -1, 1, -1, 1];

const GALLERY_BOB_SPEED = 0.85;

function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Normalize bbox to ~this size so models sit on the anchor
const SPLAT_TARGET_EXTENT = 0.95;

function normalizeSplatToAnchor(splat: SplatMesh): number {
  splat.position.set(0, 0, 0);
  splat.scale.set(1, 1, 1);
  splat.updateMatrixWorld(true);

  if (!splat.numSplats) {
    const fallback = 0.35;
    splat.scale.setScalar(fallback);
    splat.updateGenerator();
    return fallback;
  }

  const box = splat.getBoundingBox(false);
  const size = box.getSize(new THREE.Vector3());
  let maxDim = Math.max(size.x, size.y, size.z, 1e-5);
  if (!Number.isFinite(maxDim) || maxDim <= 0) {
    maxDim = 1;
  }
  const uniformScale = SPLAT_TARGET_EXTENT / maxDim;
  const centerLocal = box.getCenter(new THREE.Vector3());

  splat.scale.setScalar(uniformScale);
  splat.position.copy(centerLocal).multiplyScalar(-uniformScale);
  splat.updateGenerator();

  return uniformScale;
}

export class GalleryShowcaseEffect extends BaseEffect {
  config: EffectConfig = {
    id: 'gallery-showcase',
    name: 'Gallery Showcase',
    description: 'Splat effects gallery',
    category: 'showcase',
  };

  private sceneManager: SceneManager | null = null;
  private gui: GUI | null = null;
  private items: ShowcaseItem[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(2, 2);
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private cameraLookTarget = new THREE.Vector3(0, 0, 0);

  private readonly overviewCameraPos = new THREE.Vector3(0, 0.75, 6.2);
  private readonly lookTarget = new THREE.Vector3(0, 0, 0);

  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null;

  private cameraTween: {
    active: boolean;
    t: number;
    duration: number;
    startPos: THREE.Vector3;
    endPos: THREE.Vector3;
    startTarget: THREE.Vector3;
    endTarget: THREE.Vector3;
  } = {
    active: false,
    t: 0,
    duration: 0.65,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
  };

  async init(sceneManager: SceneManager): Promise<void> {
    this.sceneManager = sceneManager;
    const camera = sceneManager.camera;
    camera.near = 0.1;
    camera.far = 100;
    camera.updateProjectionMatrix();
    camera.position.copy(this.overviewCameraPos);
    this.cameraLookTarget.copy(this.lookTarget);
    camera.lookAt(this.cameraLookTarget);

    this.setUserCameraLocked(true);

    this.keyDownHandler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'Escape') {
        this.selectItem(null);
        return;
      }

      const sel = this.items.find((i) => i.id === this.selectedId);

      if (sel?.paint) {
        if (e.key === '1') sel.paint.setMode('paint');
        if (e.key === '2') sel.paint.setMode('erase');
      }
    };
    window.addEventListener('keydown', this.keyDownHandler);

    if (GALLERY_LAYOUT_START.length !== OBJECTS.length) {
      console.warn('[Gallery] GALLERY_LAYOUT_START length should match OBJECTS');
    }

    const packs = await Promise.all(OBJECTS.map((c) => loadFilteredPack(c.url)));

    OBJECTS.forEach((cfg, index) => {
      const seed = GALLERY_LAYOUT_START[index] ?? new THREE.Vector3();
      const basePosition = seed.clone();
      const anchor = new THREE.Group();
      anchor.position.copy(basePosition);
      const pack = packs[index]!;

      const splatOpts: ConstructorParameters<typeof SplatMesh>[0] = { packedSplats: pack };
      if (cfg.effectMode === 'splat-painting' || cfg.effectMode === 'point-cloud-disperse') {
        splatOpts.onFrame = ({ mesh }) => {
          mesh.needsUpdate = true;
        };
      }

      const spinAxis = SPIN_AXES[index % SPIN_AXES.length]!.clone();
      const spinSign = SPIN_SIGNS[index % SPIN_SIGNS.length]!;
      const { displayScale, ...restCfg } = cfg;

      const item: ShowcaseItem = {
        ...restCfg,
        anchor,
        splat: null as unknown as SplatMesh,
        proxy: null as unknown as THREE.Mesh,
        basePosition,
        bobOffset: index * 1.37,
        spinSpeed: 0.22 + index * 0.035,
        spinAxisWorld: spinAxis,
        spinSign,
        bobAmp: 0.1 + index * 0.018,
        baseScale: 0.35,
        params: {
          amount: cfg.id === 'redcar' ? 1.0 : 0.72,
          aux: 0.45,
          spinMultiplier: 1.0,
          dissolve: cfg.id === 'bomb' ? 0.07 : 0,
          autoPlay: cfg.id === 'bomb' ? false : true,
          dissolveSpeed: 1.0,
        },
      };

      switch (cfg.effectMode) {
        case 'dissolve-reform': {
          const t = dyno.dynoFloat(0);
          item.dissolveAnimT = t;
          splatOpts.objectModifier = createDissolveReformModifier(t);
          break;
        }
        case 'wave-propagation': {
          const w = new GalleryWaveItemState();
          item.wave = w;
          splatOpts.objectModifier = w.buildModifier();
          break;
        }
        case 'splat-painting': {
          const p = new GalleryPaintItemState();
          item.paint = p;
          p.setMode('paint');
          splatOpts.worldModifier = p.buildWorldModifier();
          break;
        }
        case 'shader-stylize': {
          const anim = dyno.dynoFloat(0);
          const intens = dyno.dynoFloat(item.params.amount);
          item.stylizeAnimT = anim;
          item.stylizeIntensity = intens;
          splatOpts.objectModifier = createShaderStylizeModifier(anim, intens);
          break;
        }
        case 'point-cloud-disperse': {
          const d = new GalleryDisperseItemState();
          item.disperse = d;
          splatOpts.objectModifier = d.buildObjectModifier();
          splatOpts.worldModifier = d.buildWorldModifier();
          break;
        }
      }

      const splat = new SplatMesh(splatOpts);
      item.splat = splat;
      if (item.dissolveAnimT) {
        item.dissolveAnimT.value = item.params.dissolve;
      }
      splat.maxSh = 0;
      splat.renderOrder = 1;
      splat.frustumCulled = false;

      const tiltX = (seededRandom(index * 17 + 1) - 0.5) * 0.35;
      const tiltY = (seededRandom(index * 23 + 2) - 0.5) * 0.35;
      const tiltZ = (seededRandom(index * 31 + 3) - 0.5) * 0.45;
      _eTilt.set(Math.PI + tiltX, Math.PI + tiltY, tiltZ, 'XYZ');
      splat.quaternion.setFromEuler(_eTilt);

      const proxyMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        colorWrite: false,
      });
      const proxy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 24), proxyMat);
      proxy.frustumCulled = false;
      proxy.renderOrder = -10000;
      proxy.userData.itemId = cfg.id;
      item.proxy = proxy;
      anchor.add(proxy);
      anchor.add(splat);

      this.items.push(item);
      sceneManager.scene.add(anchor);

      void splat.initialized.then(() => {
        normalizeSplatToAnchor(splat);
        splat.scale.multiplyScalar(cfg.displayScale);
        splat.position.multiplyScalar(cfg.displayScale);
        item.baseScale = splat.scale.x;
        splat.updateGenerator();
        if (item.wave) {
          item.wave.initSplatBBox(splat);
        }
      });
    });

    await Promise.all(this.items.map((item) => item.splat.initialized));
    this.applySelectionVisuals();
  }

  // Turn off orbit; camera moves only when focusing an object
  private setUserCameraLocked(locked: boolean): void {
    if (!this.sceneManager) return;
    const enable = !locked;
    this.sceneManager.controls.pointerControls.enable = enable;
    this.sceneManager.controls.fpsMovement.enable = enable;
  }

  update(deltaTime: number, elapsed: number): void {
    if (!this.sceneManager) return;

    for (const item of this.items) {
      if (item.dissolveAnimT) {
        if (item.params.autoPlay) {
          const cycle = elapsed * item.params.dissolveSpeed * 0.3;
          item.params.dissolve = (Math.sin(cycle) * 0.5 + 0.5) * 1.3;
        }
        item.dissolveAnimT.value = item.params.dissolve;
      }
      if (item.wave) {
        item.wave.update(item.splat, elapsed);
      }
      if (item.disperse) {
        item.disperse.update(item.splat, elapsed);
      }
      if (item.stylizeAnimT) {
        item.stylizeAnimT.value = elapsed;
        if (item.stylizeIntensity) {
          item.stylizeIntensity.value = item.params.amount;
        }
      }

      const bob = Math.sin(elapsed * GALLERY_BOB_SPEED + item.bobOffset) * item.bobAmp;
      item.anchor.position.set(
        item.basePosition.x,
        item.basePosition.y + bob,
        item.basePosition.z
      );
      item.anchor.rotateOnWorldAxis(
        item.spinAxisWorld,
        deltaTime * item.spinSpeed * item.params.spinMultiplier * item.spinSign
      );

      const targetScale = this.selectedId === item.id ? item.baseScale * 1.16 : item.baseScale;
      const currentScale = item.splat.scale.x;
      const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.08);
      item.splat.scale.setScalar(nextScale);
      item.splat.needsUpdate = true;
    }

    this.updateCameraTween(deltaTime);
  }

  private updateCameraTween(deltaTime: number): void {
    if (!this.sceneManager || !this.cameraTween.active) return;
    const camera = this.sceneManager.camera;
    this.cameraTween.t = Math.min(1, this.cameraTween.t + deltaTime / this.cameraTween.duration);
    const eased = easeInOutCubic(this.cameraTween.t);

    camera.position.lerpVectors(this.cameraTween.startPos, this.cameraTween.endPos, eased);
    this.cameraLookTarget.lerpVectors(this.cameraTween.startTarget, this.cameraTween.endTarget, eased);
    camera.lookAt(this.cameraLookTarget);

    if (this.cameraTween.t >= 1) {
      this.cameraTween.active = false;
      this.setUserCameraLocked(true);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.sceneManager) return;
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);

    const disperseSel = this.items.find((i) => i.id === this.selectedId && i.disperse);
    if (disperseSel?.disperse) {
      disperseSel.disperse.updateBrushFromPointer(
        event,
        this.sceneManager.canvas,
        this.sceneManager.camera,
        this.raycaster,
        disperseSel.proxy
      );
    }

    const paintSel = this.items.find((i) => i.id === this.selectedId && i.paint);
    if (paintSel?.paint?.isDragging) {
      paintSel.paint.updateBrushFromPointer(
        event,
        this.sceneManager.canvas,
        this.sceneManager.camera,
        this.raycaster
      );
      paintSel.paint.applyBrushStroke(paintSel.splat, this.sceneManager.spark);
    }

    const waveSel = this.items.find((i) => i.id === this.selectedId && i.wave);
    if (waveSel?.wave?.isDragging) {
      const wHits = this.raycaster.intersectObjects([waveSel.proxy], false);
      if (wHits.length > 0) {
        waveSel.wave.injectFromWorldPoint(wHits[0]!.point, waveSel.splat);
      }
    }

    const hits = this.raycaster.intersectObjects(this.items.map((item) => item.proxy), false);
    const hoveredId = hits.length > 0 ? (hits[0]!.object.userData.itemId as string) : null;
    if (hoveredId !== this.hoveredId) {
      this.hoveredId = hoveredId;
      this.applySelectionVisuals();
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.sceneManager) return;
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);
    const hits = this.raycaster.intersectObjects(this.items.map((item) => item.proxy), false);
    const hitId = hits.length > 0 ? (hits[0]!.object.userData.itemId as string) : null;
    const hitPoint = hits.length > 0 ? hits[0]!.point : null;

    const paintSel = this.items.find((i) => i.id === this.selectedId && i.paint);
    if (paintSel?.paint) {
      paintSel.paint.updateBrushFromPointer(
        event,
        this.sceneManager.canvas,
        this.sceneManager.camera,
        this.raycaster
      );
      if (hitId === paintSel.id || hitId === null) {
        paintSel.paint.isDragging = true;
        paintSel.paint.applyBrushStroke(paintSel.splat, this.sceneManager.spark);
      } else if (hitId) {
        this.selectItem(hitId);
      }
      return;
    }

    const waveSel = this.items.find((i) => i.id === this.selectedId && i.wave);
    if (waveSel?.wave) {
      if (hitId === waveSel.id && hitPoint) {
        waveSel.wave.isDragging = true;
        waveSel.wave.injectFromWorldPoint(hitPoint, waveSel.splat);
      } else if (hitId && hitId !== waveSel.id) {
        this.selectItem(hitId);
      } else if (!hitId) {
        this.selectItem(null);
      }
      return;
    }

    const disperseSel = this.items.find((i) => i.id === this.selectedId && i.disperse);
    if (disperseSel?.disperse) {
      disperseSel.disperse.updateBrushFromPointer(
        event,
        this.sceneManager.canvas,
        this.sceneManager.camera,
        this.raycaster,
        disperseSel.proxy
      );
      if (hitId && hitId !== disperseSel.id) {
        this.selectItem(hitId);
      } else if (!hitId) {
        this.selectItem(null);
      }
      return;
    }

    if (!hitId) {
      this.selectItem(null);
      return;
    }
    this.selectItem(hitId);
  }

  onPointerUp(): void {
    for (const item of this.items) {
      if (item.paint) item.paint.isDragging = false;
      if (item.wave) item.wave.isDragging = false;
    }
  }

  private selectItem(itemId: string | null): void {
    this.selectedId = itemId;
    this.applySelectionVisuals();
    this.rebuildGui();
    this.startCameraFocusTween(itemId);
  }

  private startCameraFocusTween(itemId: string | null): void {
    if (!this.sceneManager) return;
    const camera = this.sceneManager.camera;
    this.setUserCameraLocked(true);

    this.cameraTween.startPos.copy(camera.position);
    this.cameraTween.startTarget.copy(this.cameraLookTarget);
    this.cameraTween.t = 0;
    this.cameraTween.active = true;

    if (!itemId) {
      this.cameraTween.endPos.copy(this.overviewCameraPos);
      this.cameraTween.endTarget.copy(this.lookTarget);
      return;
    }

    const selected = this.items.find((it) => it.id === itemId);
    if (!selected) return;

    const itemPos = new THREE.Vector3();
    selected.anchor.getWorldPosition(itemPos);
    const viewDir = new THREE.Vector3()
      .copy(camera.position)
      .sub(itemPos)
      .normalize();
    if (viewDir.lengthSq() < 1e-6) {
      viewDir.set(0, 0.15, 1);
    }
    this.cameraTween.endPos.copy(itemPos).addScaledVector(viewDir, 3.25);
    this.cameraTween.endTarget.copy(itemPos);
  }

  private applySelectionVisuals(): void {
    for (const item of this.items) {
      const isSelected = this.selectedId === item.id;
      const isHovered = this.hoveredId === item.id;
      const proxyScale = isSelected ? 1.32 : isHovered ? 1.2 : 1.0;
      item.proxy.scale.setScalar(proxyScale);

      if (isSelected) {
        item.params.spinMultiplier = 1.25;
      } else if (this.selectedId && !isSelected) {
        item.params.spinMultiplier = 0.45;
      } else {
        item.params.spinMultiplier = 1.0;
      }
    }
  }

  buildGui(gui: GUI): void {
    this.gui = gui;
    this.rebuildGui();
  }

  private rebuildGui(): void {
    if (!this.gui) return;
    const children = ((this.gui as unknown as { children?: Array<{ destroy: () => void }> }).children ??
      []).slice();
    children.forEach((child) => child.destroy());

    const selected = this.items.find((item) => item.id === this.selectedId);
    if (!selected) {
      this.gui.title('Gallery');
      return;
    }

    const effectLabel = EFFECT_GUI_LABEL[selected.effectMode];
    this.gui.title(`${selected.name} — ${effectLabel}`);
    const fxFolder = this.gui.addFolder(effectLabel);

    switch (selected.effectMode) {
      case 'dissolve-reform':
        fxFolder
          .add(selected.params, 'dissolve', 0, 1.3, 0.01)
          .name('Dissolve')
          .listen()
          .onChange(() => {
            selected.params.autoPlay = false;
          });
        fxFolder.add(selected.params, 'autoPlay').name('Auto Play');
        fxFolder.add(selected.params, 'dissolveSpeed', 0.1, 3.0, 0.1).name('Speed');
        break;
      case 'wave-propagation': {
        const w = selected.wave!;
        const wp = w.params;
        const wf = fxFolder.addFolder('Wave Physics');
        wf.add(wp, 'waveSpeed', 0.2, 5.0, 0.1).name('Wave Speed');
        wf.add(wp, 'damping', 0.05, 2.0, 0.05).name('Damping');
        wf.add(wp, 'waveFrequency', 2.0, 30.0, 0.5).name('Frequency');
        const viz = fxFolder.addFolder('Visualization');
        viz.add(wp, 'displaceScale', 0.0, 1.0, 0.01).name('Displace Scale');
        const cloud = fxFolder.addFolder('Point Cloud');
        cloud.add(wp, 'dotScale', 0.02, 0.5, 0.01).name('Particle Size');
        cloud.add(wp, 'floatAmplitude', 0.0, 0.05, 0.001).name('Float Amplitude');
        const auto = fxFolder.addFolder('Auto Emit');
        auto.add(wp, 'autoEmit').name('Enabled');
        auto.add(wp, 'autoEmitInterval', 0.5, 5.0, 0.1).name('Interval (s)');
        this.gui.add({ resetWaves: () => { w.sources = []; w.nextAutoEmit = 0; } }, 'resetWaves').name('Reset Waves');
        wf.open();
        break;
      }
      case 'splat-painting': {
        const p = selected.paint!;
        fxFolder.addColor(p.params, 'color').name('Brush Color').onChange((val: string) => {
          const c = new THREE.Color(val);
          p.brushColor.value.set(c.r, c.g, c.b);
        });
        p.brushColor.value.set(
          ...new THREE.Color(p.params.color).toArray() as [number, number, number]
        );
        fxFolder.add(p.params, 'brushSize', 0.01, 0.25, 0.005).name('Brush Size').onChange((v: number) => {
          p.brushRadius.value = v;
        });
        fxFolder.add(p.params, 'mode', ['paint', 'erase']).name('Mode').onChange((v: 'paint' | 'erase') => {
          p.setMode(v);
        });
        break;
      }
      case 'shader-stylize':
        fxFolder.add(selected.params, 'amount', 0, 1, 0.01).name('Intensity');
        break;
      case 'point-cloud-disperse': {
        const d = selected.disperse!;
        fxFolder
          .add(d.params, 'brushSize', 0.1, 0.8, 0.02)
          .name('Brush size')
          .onChange((v: number) => {
            d.brushRadius.value = v;
            selected.splat.updateGenerator();
          });
        fxFolder
          .add(d.params, 'pushStrength', 0.02, 0.3, 0.01)
          .name('Push strength')
          .onChange((v: number) => {
            d.pushStrength.value = v;
            selected.splat.updateGenerator();
          });
        break;
      }
    }

    fxFolder.open();

    this.gui.add(
      {
        resetView: () => this.selectItem(null),
      },
      'resetView'
    ).name('Reset Camera');
  }

  dispose(): void {
    if (this.keyDownHandler) {
      window.removeEventListener('keydown', this.keyDownHandler);
      this.keyDownHandler = null;
    }
    if (!this.sceneManager) return;
    this.setUserCameraLocked(false);
    for (const item of this.items) {
      item.anchor.remove(item.splat);
      item.anchor.remove(item.proxy);
      this.sceneManager.scene.remove(item.anchor);
      item.splat.dispose();
      item.proxy.geometry.dispose();
      (item.proxy.material as THREE.Material).dispose();
    }
    this.items = [];
    this.hoveredId = null;
    this.selectedId = null;
  }
}
