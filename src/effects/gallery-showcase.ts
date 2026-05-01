// gallery showcase overview
import * as THREE from 'three';
import { SplatMesh, dyno, PackedSplats, SplatFileType } from '@sparkjsdev/spark';
import { BaseEffect } from '../core/types';
import type { EffectConfig } from '../core/types';
import type { SceneManager } from '../core/scene-manager';
import type { GUI } from 'lil-gui';
import type { GalleryEffectMode } from './gallery-per-object-effects';
import {
  createDissolveReformModifier,
  createShaderStylizeModifier,
  GalleryBoidItemState,
  GalleryPaintItemState,
  GalleryWaveItemState,
  GalleryXRaySliceItemState,
} from './gallery-per-object-effects';
import type { ControlDescriptor, PanelContent } from '../ui/museum-panel';


interface CuratorMeta {
  number: string;
  technique: string;
  caption: string;
  tech: {
    summary: string;
    lines: Array<[string, string]>;
  };
}

interface ShowcaseItem extends CuratorMeta {
  id: string;
  name: string;
  url: string;
  displayScale: number;
  layoutIndex: number;
  effectMode: GalleryEffectMode;
  description: string;
  anchor: THREE.Group;
  splat: SplatMesh;
  proxy: THREE.Mesh;
  
  basePosition: THREE.Vector3;
  bobOffset: number;
  spinSpeed: number;
  spinAxisWorld: THREE.Vector3;
  spinSign: number;
  bobAmp: number;
  baseScale: number;
  
  params: {
    amount: number;
    aux: number;
    spinMultiplier: number;
    dissolve: number;
    autoPlay: boolean;
    dissolveSpeed: number;
    dissolveStagger: number;
    stylizeElongation: number;
    stylizeAxis: 'x' | 'y' | 'z';
  };
  dissolveAnimT?: ReturnType<typeof dyno.dynoFloat>;
  dissolveStaggerUniform?: ReturnType<typeof dyno.dynoFloat>;
  wave?: GalleryWaveItemState;
  paint?: GalleryPaintItemState;
  stylizeAnimT?: ReturnType<typeof dyno.dynoFloat>;
  stylizeIntensity?: ReturnType<typeof dyno.dynoFloat>;
  stylizeElongationUniform?: ReturnType<typeof dyno.dynoFloat>;
  stylizeAxisMaskUniform?: ReturnType<typeof dyno.dynoVec3>;
  xray?: GalleryXRaySliceItemState;
  boid?: GalleryBoidItemState;
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
  | 'dissolveStaggerUniform'
  | 'wave'
  | 'paint'
  | 'stylizeAnimT'
  | 'stylizeIntensity'
  | 'stylizeElongationUniform'
  | 'stylizeAxisMaskUniform'
  | 'xray'
  | 'boid'
  | 'layoutIndex'
> & { displayScale: number };

const PAINT_SWATCHES = ['#e86a4a', '#4a8ae8', '#4ae890', '#e8d04a', '#ffffff', '#000000'];

function axisMaskFor(axis: 'x' | 'y' | 'z'): THREE.Vector3 {
  return new THREE.Vector3(
    axis === 'x' ? 1 : 0,
    axis === 'y' ? 1 : 0,
    axis === 'z' ? 1 : 0
  );
}


const GALLERY_LAYOUT_START: THREE.Vector3[] = [
  new THREE.Vector3(-1.90, 1.13, 2.31), 
  new THREE.Vector3(0.32, -0.59, 2.11), 
  new THREE.Vector3(-2.10, -1.12, 1.00), 
  new THREE.Vector3(0.20, 1.68, 0.35), 
  new THREE.Vector3(2.56, 1.17, 2.13), 
  new THREE.Vector3(4.00, -2.05, -0.53), 
];

const OBJECTS: ObjectConfig[] = [
  {
    id: 'redcar',
    number: '01',
    name: 'Sparkle Shader',
    url: new URL('../../objects/redcar.spz', import.meta.url).href,
    effectMode: 'shader-stylize',
    technique: 'Stretched sparkle',
    description: 'Sparkle stylize',
    caption:
      'Each splat is stretched along one chosen axis and squished on the other two. Bright parts of the original color are mixed toward white, with a small per-splat random jitter, so the result sparkles instead of glowing evenly.',
    tech: {
      summary:
        "A per-splat GLSL pass rewrites the scale and color of each Gaussian. Scale is stretched along the selected axis and shrunk on the other two as `intensity` rises. Color is mixed toward a bright sparkle, weighted by the splat's own brightness and a per-splat random twinkle.",
      lines: [
        ['axis_amt', '= mix(1, elongation, intensity)'],
        ['other_amt', '= mix(1, 0.45, intensity)'],
        ['glow', '= smoothstep(0.08, 0.45, luma) * intensity'],
        ['rgb', '= mix(rgb, 0.2*luma + glow*twinkle*3.5, intensity)'],
      ],
    },
    displayScale: 2.0,
  },
  {
    id: 'chicken',
    number: '02',
    name: 'Surface Painting',
    url: new URL('../../objects/chicken.spz', import.meta.url).href,
    effectMode: 'splat-painting',
    technique: 'Surface painting',
    description: 'Paint when selected',
    caption:
      "The cursor casts a ray into the scene. Splats inside a cylinder around that ray, up to the front face of the object's bounding box, get recolored (keeping their original light and dark shading) or erased. Each stroke is saved per splat so the painted state stays between frames.",
    tech: {
      summary:
        "A world-space pass projects each splat onto the cursor ray and keeps splats inside a cylinder of `brushSize` radius and `brushReach` depth. Recolor multiplies the brush color by a shade derived from the splat's original brightness, so light and dark regions stay readable; erase zeros alpha. Strokes are committed by writing into `splat.splatRgba` through `SparkRenderer.getRgba`.",
      lines: [
        ['projAmp', '= dot(rayDir, center - rayOrigin)'],
        ['radial', '= length(center - rayOrigin - rayDir*projAmp)'],
        ['inside', '= radial < r && 0 < projAmp < sDist + reach'],
        ['paint', 'rgb = brushColor * (0.75 + 0.5*luma)'],
      ],
    },
    displayScale: 2.0,
  },
  {
    id: 'fish',
    number: '03',
    name: 'X-Ray Scan',
    url: new URL('../../objects/fish.spz', import.meta.url).href,
    effectMode: 'xray-slice',
    technique: 'Slice scan',
    description: 'X-ray scan sweeps through',
    caption:
      'A flat slice sweeps back and forth through the model along one axis. Splats inside the slice keep their original color and pick up a thin cyan glow on the front and back faces. Splats outside the slice fade to a faint blue-tinted version, like a blueprint behind the active region.',
    tech: {
      summary:
        "For each splat, the signed distance along the scan axis is run through a smoothstep against the slice half-thickness to give an `inside` value between 0 and 1. A second smoothstep close to the slice faces produces a thin rim mask. The output blends a tinted blueprint outside the slice with the original color plus a cyan rim glow inside.",
      lines: [
        ['d', '= abs(dot(pos, scanAxis) - slabCenter)'],
        ['inside', '= 1 - smoothstep(h - f, h + f, d)'],
        ['edge', '= smoothstep(h - eW - f, h - f/2, d) * inside'],
        ['rgb', '= mix(blueprint, color + rimGlow*edge*gStr, inside)'],
      ],
    },
    displayScale: 2.5,
  },
  {
    id: 'bomb',
    number: '04',
    name: 'Random Dissolve',
    url: new URL('../../objects/bomb.spz', import.meta.url).href,
    effectMode: 'dissolve-reform',
    technique: 'Staggered dissolve',
    description: 'Dissolve & reform',
    caption:
      'Each splat picks its own start time and outward direction from a hash of where it sits in the model. As time runs forward, every splat drifts outward, shrinks, and fades on its own schedule, so the model breaks apart in a wave instead of all at once.',
    tech: {
      summary:
        "A 3D hash of each splat's rest position seeds a per-splat `(startTime, direction, speed)`. Once `localT = (t − startTime) / window` becomes positive, the splat moves along its hashed direction, scales down toward 30%, and fades via `smoothstep(0.3, 1.0, localT)`. The auto-cycle drives `t` along a sine schedule so the cloud continually breaks apart and reforms.",
      lines: [
        ['localT', '= clamp((t - hash.x*stagger) / window, 0, 1)'],
        ['center', '+= moveDir * 2*localT * (0.5 + hash.y)'],
        ['scales', '*= mix(1, 0.3, localT)'],
        ['alpha', '*= 1 - smoothstep(0.3, 1, localT)'],
      ],
    },
    displayScale: 2.0,
  },
  {
    id: 'sheep',
    number: '05',
    name: 'Wave Physics',
    url: new URL('../../objects/sheep.spz', import.meta.url).href,
    effectMode: 'wave-propagation',
    technique: 'Ripple waves',
    description: 'Waves: click or drag',
    caption:
      'Each click drops a wave source on the surface, and up to four sources can be active at once. For every splat, the contribution from each active source is added together: a sine wave riding on a fading bump that travels outward from the source. The sum lifts the splat off the surface in the direction it was already facing.',
    tech: {
      summary:
        "A per-splat pass evaluates a wave from each of four source slots. For each slot: `age = t − srcTime`, `wavefront = ‖pos − origin‖ − age · c`, and the contribution is `fadeIn · e^(−damp · age) · e^(−2 · wavefront²) · sin(freq · wavefront)`. The four contributions are summed and applied as displacement along a slightly jittered normal; the original capture color and splat size are unchanged.",
      lines: [
        ['wavefront', '= length(pos - srcPos) - age*waveSpeed'],
        ['envelope', '= fadeIn * exp(-damp*age) * exp(-2*wavefront²)'],
        ['disp_i', '= envelope * sin(waveFreq * wavefront)'],
        ['center', '+= normal * (disp_0+disp_1+disp_2+disp_3) * scale'],
      ],
    },
    displayScale: 2.0,
  },
  {
    id: 'butterfly',
    number: '06',
    name: 'Boid Vortex',
    url: new URL('../../objects/butterfly.spz', import.meta.url).href,
    effectMode: 'boid-swarm',
    technique: 'Swarm vortex',
    description: 'Cursor-driven vortex over a Reynolds boid simulation',
    caption:
      'Each splat is treated as a boid that wants to stay near its starting position but follows simple flocking rules with its eight nearest neighbors. The offset and velocity for every splat live in two textures that update each frame on the GPU. When the cursor hovers over the butterfly, nearby splats spin around it in a ring that always faces the camera.',
    tech: {
      summary:
        "At init, a k-d tree builds an 8-nearest-neighbor graph that gets packed into RGBA index textures. Each frame, two GPGPU passes update each splat's `velocity` and integrate its `offset`. Velocity accumulates separation, alignment, and cohesion (gated by hover intensity), plus a constant pull back to the splat's home position. Hover adds a sideways swirl about an axis pointing from the cursor to the camera, plus a spring that pulls splats toward a target orbit radius. The render pass rotates each splat's local +X to point along its velocity and stretches along that axis to produce motion streaks.",
      lines: [
        ['flock', '= (sep + align + coh)*gate - offset*homeSpring'],
        ['vortex', '= (cross(dir,axis)*swirl - dir*(d-r)*attract)*falloff'],
        ['vel', '= (vel + (flock+vortex)*dt) * exp(-0.5*dt)'],
        ['streak', 'scales.x *= 1 + 3.5*speedNorm*streak'],
      ],
    },
    displayScale: 2.0,
  },
];

const OPACITY_THRESHOLD = 0.15;


const MAX_FILTERED_SPLATS = 350_000;


const MAX_SPZ_UPLOAD_BYTES = 120 * 1024 * 1024;

type PackLoadSource =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; fileBytes: ArrayBuffer; fileName: string };


async function loadFilteredPack(source: PackLoadSource): Promise<PackedSplats> {
  let raw: PackedSplats;
  if (source.kind === 'url') {
    raw = new PackedSplats({ url: source.url });
  } else {
    raw = new PackedSplats({
      fileBytes: new Uint8Array(source.fileBytes),
      fileType: SplatFileType.SPZ,
      fileName: source.fileName,
    });
  }
  await raw.initialized;

  const budget = Math.min(raw.numSplats, MAX_FILTERED_SPLATS);
  const filtered = new PackedSplats({ maxSplats: budget });
  let kept = 0;
  raw.forEachSplat((_i, center, scales, quaternion, opacity, color) => {
    if (kept >= MAX_FILTERED_SPLATS) return;
    if (opacity >= OPACITY_THRESHOLD) {
      filtered.pushSplat(center, scales, quaternion, opacity, color);
      kept++;
    }
  });
  raw.dispose();
  await filtered.initialized;

  if (filtered.numSplats === 0) {
    filtered.dispose();
    throw new Error('No splats above opacity threshold — file may be empty or invalid.');
  }

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
  new THREE.Vector3(0, 1, 0),
];
const SPIN_SIGNS = [1, -1, -1, 1, -1, 1, 1];

const GALLERY_BOB_SPEED = 0.85;

function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}


const SPLAT_TARGET_EXTENT = 0.95;

function applyGalleryTiltToSplat(splat: SplatMesh, layoutIndex: number): void {
  const tiltX = (seededRandom(layoutIndex * 17 + 1) - 0.5) * 0.35;
  const tiltY = (seededRandom(layoutIndex * 23 + 2) - 0.5) * 0.35;
  const tiltZ = (seededRandom(layoutIndex * 31 + 3) - 0.5) * 0.45;
  _eTilt.set(Math.PI + tiltX, Math.PI + tiltY, tiltZ, 'XYZ');
  splat.quaternion.setFromEuler(_eTilt);
}

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
  private items: ShowcaseItem[] = [];
  
  
  private proxyMeshes: THREE.Mesh[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(2, 2);
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private cameraLookTarget = new THREE.Vector3(0, 0, 0);
  private selectionListener: ((content: PanelContent | null) => void) | null = null;
  private layoutEditorVisible = false;
  private layoutEditor: {
    root: HTMLDivElement;
    select: HTMLSelectElement;
    x: HTMLInputElement;
    y: HTMLInputElement;
    z: HTMLInputElement;
    xVal: HTMLSpanElement;
    yVal: HTMLSpanElement;
    zVal: HTMLSpanElement;
    status: HTMLSpanElement;
  } | null = null;

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

  private uploadInProgress = false;

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
      if (import.meta.env.DEV && e.key.toLowerCase() === 'l') {
        this.layoutEditorVisible = !this.layoutEditorVisible;
        this.refreshLayoutEditor();
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

    const packs = await Promise.all(OBJECTS.map((c) => loadFilteredPack({ kind: 'url', url: c.url })));

    OBJECTS.forEach((cfg, index) => {
      const seed = GALLERY_LAYOUT_START[index] ?? new THREE.Vector3();
      const basePosition = seed.clone();
      const anchor = new THREE.Group();
      anchor.position.copy(basePosition);
      const pack = packs[index]!;

      const splatOpts: ConstructorParameters<typeof SplatMesh>[0] = { packedSplats: pack };

      const spinAxis = SPIN_AXES[index % SPIN_AXES.length]!.clone();
      const spinSign = SPIN_SIGNS[index % SPIN_SIGNS.length]!;
      const { displayScale, ...restCfg } = cfg;

      const item: ShowcaseItem = {
        ...restCfg,
        displayScale,
        layoutIndex: index,
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
          dissolve: cfg.id === 'bomb' ? 0.2 : 0,
          autoPlay: cfg.id === 'bomb' ? false : true,
          dissolveSpeed: cfg.id === 'bomb' ? 2.5 : 1.0,
          dissolveStagger: cfg.id === 'bomb' ? 0.57 : 0.8,
          stylizeElongation: 5.0,
          stylizeAxis: 'x',
        },
      };

      switch (cfg.effectMode) {
        case 'dissolve-reform': {
          const t = dyno.dynoFloat(0);
          const stagger = dyno.dynoFloat(item.params.dissolveStagger);
          item.dissolveAnimT = t;
          item.dissolveStaggerUniform = stagger;
          splatOpts.objectModifier = createDissolveReformModifier(t, stagger);
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
          
          p.params.color = PAINT_SWATCHES[0]!;
          const defaultColor = new THREE.Color(p.params.color);
          p.brushColor.value.set(defaultColor.r, defaultColor.g, defaultColor.b);
          splatOpts.worldModifier = p.buildWorldModifier();
          break;
        }
        case 'shader-stylize': {
          const anim = dyno.dynoFloat(0);
          const intens = dyno.dynoFloat(item.params.amount);
          const elong = dyno.dynoFloat(item.params.stylizeElongation);
          const axisMask = dyno.dynoVec3(axisMaskFor(item.params.stylizeAxis));
          item.stylizeAnimT = anim;
          item.stylizeIntensity = intens;
          item.stylizeElongationUniform = elong;
          item.stylizeAxisMaskUniform = axisMask;
          splatOpts.objectModifier = createShaderStylizeModifier(anim, intens, elong, axisMask);
          break;
        }
        case 'xray-slice': {
          const x = new GalleryXRaySliceItemState();
          item.xray = x;
          splatOpts.objectModifier = x.buildObjectModifier();
          break;
        }
        case 'boid-swarm': {
          const b = new GalleryBoidItemState();
          item.boid = b;
          b.init(pack, sceneManager.renderer);
          splatOpts.objectModifier = b.buildObjectModifier();
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

      applyGalleryTiltToSplat(splat, index);

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
        splat.scale.multiplyScalar(displayScale);
        splat.position.multiplyScalar(displayScale);
        item.baseScale = splat.scale.x;
        splat.updateGenerator();
        if (item.wave) {
          item.wave.initSplatBBox(splat);
        }
        if (item.xray) {
          item.xray.initBBox(splat);
        }
        if (item.paint) {
          item.paint.initSplatBox(splat, sceneManager.spark);
        }
      });
    });

    await Promise.all(this.items.map((item) => item.splat.initialized));
    this.proxyMeshes = this.items.map((item) => item.proxy);
    this.applySelectionVisuals();
    this.initLayoutEditor();
  }

  
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
        if (item.dissolveStaggerUniform) {
          item.dissolveStaggerUniform.value = item.params.dissolveStagger;
        }
      }
      if (item.wave) {
        item.wave.update(item.splat, elapsed);
      }
      if (item.xray) {
        const xrayFocused = this.selectedId === item.id
          && (!this.cameraTween.active || this.cameraTween.t > 0.92);
        item.xray.setFocused(xrayFocused);
        item.xray.update(item.splat, elapsed);
      }
      if (item.boid) {
        item.boid.update(item.splat, deltaTime, elapsed, this.sceneManager.camera);
      }
      if (item.stylizeAnimT) {
        item.stylizeAnimT.value = elapsed;
        if (item.stylizeIntensity) {
          item.stylizeIntensity.value = item.params.amount;
        }
        if (item.stylizeElongationUniform) {
          item.stylizeElongationUniform.value = item.params.stylizeElongation;
        }
      }

      const xrayMotionDamp = item.effectMode === 'xray-slice' && this.selectedId === item.id
        ? (this.cameraTween.active ? 0.08 : 0.28)
        : 1.0;
      const bob = Math.sin(elapsed * GALLERY_BOB_SPEED + item.bobOffset) * item.bobAmp * xrayMotionDamp;
      item.anchor.position.set(
        item.basePosition.x,
        item.basePosition.y + bob,
        item.basePosition.z
      );
      item.anchor.rotateOnWorldAxis(
        item.spinAxisWorld,
        deltaTime * item.spinSpeed * item.params.spinMultiplier * item.spinSign * xrayMotionDamp
      );

      const selectedScaleBoost = item.effectMode === 'xray-slice' ? 1.06 : 1.16;
      const targetScale = this.selectedId === item.id
        ? item.baseScale * selectedScaleBoost
        : item.baseScale;
      const currentScale = item.splat.scale.x;
      const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.08);
      if (Math.abs(nextScale - currentScale) > 1e-4) {
        item.splat.scale.setScalar(nextScale);
      }

      if (item.paint?.isDragging && item.paint.consumeDirty()) {
        item.paint.applyBrushStroke(item.splat, this.sceneManager.spark);
      }
    }

    this.refreshLayoutEditor();
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

    const paintSel = this.items.find((i) => i.id === this.selectedId && i.paint);
    if (paintSel?.paint?.isDragging) {
      const surfaceHit = paintSel.paint.raycastSurface(paintSel.splat, this.raycaster.ray);
      const overSelected = paintSel.paint.updateBrushFromPointer(
        event,
        this.sceneManager.canvas,
        this.sceneManager.camera,
        this.raycaster,
        surfaceHit
      );
      paintSel.paint.brushActive.value = overSelected;
      if (overSelected) paintSel.paint.markDirty();
    }

    const waveSel = this.items.find((i) => i.id === this.selectedId && i.wave);
    if (waveSel?.wave?.isDragging) {
      const wHits = this.raycaster.intersectObjects([waveSel.proxy], false);
      if (wHits.length > 0) {
        waveSel.wave.injectFromWorldPoint(wHits[0]!.point, waveSel.splat);
      }
    }

    const hits = this.raycaster.intersectObjects(this.proxyMeshes, false);
    const hoveredId = hits.length > 0 ? (hits[0]!.object.userData.itemId as string) : null;
    if (hoveredId !== this.hoveredId) {
      this.hoveredId = hoveredId;
      this.applySelectionVisuals();
    }

    
    for (const item of this.items) {
      if (!item.boid) continue;
      const itemHit = hits.find((h) => h.object.userData.itemId === item.id);
      if (!itemHit) continue;
      item.boid?.onHoverHit(itemHit.point, item.splat);
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.sceneManager) return;
    const rect = this.sceneManager.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.sceneManager.camera);
    const hits = this.raycaster.intersectObjects(this.proxyMeshes, false);
    const hitId = hits.length > 0 ? (hits[0]!.object.userData.itemId as string) : null;
    const hitPoint = hits.length > 0 ? hits[0]!.point : null;

    const paintSel = this.items.find((i) => i.id === this.selectedId && i.paint);
    if (paintSel?.paint) {
      if (hitId === paintSel.id && !this.cameraTween.active) {
        const surfaceHit = paintSel.paint.raycastSurface(paintSel.splat, this.raycaster.ray) ?? hitPoint;
        paintSel.paint.updateBrushFromPointer(
          event,
          this.sceneManager.canvas,
          this.sceneManager.camera,
          this.raycaster,
          surfaceHit
        );
        paintSel.paint.isDragging = true;
        paintSel.paint.brushActive.value = true;
        paintSel.paint.applyBrushStroke(paintSel.splat, this.sceneManager.spark);
      } else if (hitId && hitId !== paintSel.id) {
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

    if (!hitId) {
      this.selectItem(null);
      return;
    }
    this.selectItem(hitId);
  }

  onPointerUp(): void {
    for (const item of this.items) {
      if (item.paint) {
        if (item.paint.isDragging && item.paint.consumeDirty() && this.sceneManager) {
          item.paint.applyBrushStroke(item.splat, this.sceneManager.spark);
        }
        item.paint.isDragging = false;
        item.paint.brushActive.value = false;
      }
      if (item.wave) item.wave.isDragging = false;
    }
  }

  private selectItem(itemId: string | null): void {
    this.selectedId = itemId;
    this.applySelectionVisuals();
    this.refreshLayoutEditor();
    this.notifySelection();
    this.startCameraFocusTween(itemId);
  }

  
  private initLayoutEditor(): void {
    if (!import.meta.env.DEV) return;
    if (!this.sceneManager || this.layoutEditor) return;
    const restored = this.restoreLayoutFromStorage();

    const root = document.createElement('div');
    root.className = 'layout-editor';

    const title = document.createElement('div');
    title.className = 'layout-editor-title';
    title.textContent = 'Showcase Layout Editor';

    const row = document.createElement('div');
    row.className = 'layout-editor-row';
    const label = document.createElement('label');
    label.textContent = 'Object';
    label.className = 'layout-editor-label';
    const select = document.createElement('select');
    select.className = 'layout-editor-select';
    for (const item of this.items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.number} — ${item.name}`;
      select.appendChild(option);
    }
    row.append(label, select);

    const makeAxis = (
      axis: 'x' | 'y' | 'z',
    ): { wrap: HTMLDivElement; input: HTMLInputElement; value: HTMLSpanElement } => {
      const wrap = document.createElement('div');
      wrap.className = 'layout-editor-row';
      const axisLabel = document.createElement('label');
      axisLabel.className = 'layout-editor-label';
      axisLabel.textContent = axis.toUpperCase();
      const input = document.createElement('input');
      input.className = 'layout-editor-slider';
      input.type = 'range';
      input.min = '-4';
      input.max = '4';
      input.step = '0.01';
      const value = document.createElement('span');
      value.className = 'layout-editor-value';
      wrap.append(axisLabel, input, value);
      return { wrap, input, value };
    };

    const xCtl = makeAxis('x');
    const yCtl = makeAxis('y');
    const zCtl = makeAxis('z');

    const actions = document.createElement('div');
    actions.className = 'layout-editor-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'layout-editor-btn';
    copyBtn.textContent = 'Copy positions';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'layout-editor-btn';
    saveBtn.textContent = 'Save positions';
    actions.append(copyBtn, saveBtn);

    const status = document.createElement('span');
    status.className = 'layout-editor-status';
    status.textContent = restored
      ? 'Restored saved layout (press L to show/hide)'
      : 'Press L to show/hide layout editor';

    root.append(title, row, xCtl.wrap, yCtl.wrap, zCtl.wrap, actions, status);
    this.sceneManager.container.appendChild(root);

    this.layoutEditor = {
      root,
      select,
      x: xCtl.input,
      y: yCtl.input,
      z: zCtl.input,
      xVal: xCtl.value,
      yVal: yCtl.value,
      zVal: zCtl.value,
      status,
    };

    const syncFromSelected = (): void => {
      const editor = this.layoutEditor;
      if (!editor) return;
      const item = this.items.find((it) => it.id === editor.select.value);
      if (!item) return;
      editor.x.value = item.basePosition.x.toFixed(2);
      editor.y.value = item.basePosition.y.toFixed(2);
      editor.z.value = item.basePosition.z.toFixed(2);
      editor.xVal.textContent = item.basePosition.x.toFixed(2);
      editor.yVal.textContent = item.basePosition.y.toFixed(2);
      editor.zVal.textContent = item.basePosition.z.toFixed(2);
    };

    const writeAxis = (axis: 'x' | 'y' | 'z', raw: string): void => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      const editor = this.layoutEditor;
      if (!editor) return;
      const item = this.items.find((it) => it.id === editor.select.value);
      if (!item) return;
      item.basePosition[axis] = value;
      if (axis === 'x') editor.xVal.textContent = value.toFixed(2);
      if (axis === 'y') editor.yVal.textContent = value.toFixed(2);
      if (axis === 'z') editor.zVal.textContent = value.toFixed(2);
    };

    const setStatus = (text: string): void => {
      if (!this.layoutEditor) return;
      this.layoutEditor.status.textContent = text;
    };

    select.addEventListener('change', () => {
      syncFromSelected();
      setStatus(`Editing ${select.options[select.selectedIndex]?.textContent ?? 'object'}`);
    });
    xCtl.input.addEventListener('input', () => writeAxis('x', xCtl.input.value));
    yCtl.input.addEventListener('input', () => writeAxis('y', yCtl.input.value));
    zCtl.input.addEventListener('input', () => writeAxis('z', zCtl.input.value));

    const exportLayout = (): string => {
      const lines = this.items
        .map(
          (it) =>
            `  new THREE.Vector3(${it.basePosition.x.toFixed(2)}, ${it.basePosition.y.toFixed(2)}, ${it.basePosition.z.toFixed(2)}),`
        )
        .join('\n');
      return `const GALLERY_LAYOUT_START: THREE.Vector3[] = [\n${lines}\n];`;
    };

    copyBtn.addEventListener('click', async () => {
      const text = exportLayout();
      try {
        await navigator.clipboard.writeText(text);
        setStatus('Copied layout to clipboard');
      } catch {
        window.prompt('Copy layout positions:', text);
        setStatus('Clipboard blocked - used copy prompt');
      }
    });

    saveBtn.addEventListener('click', () => {
      const payload = JSON.stringify(
        this.items.map((it) => ({
          id: it.id,
          x: Number(it.basePosition.x.toFixed(3)),
          y: Number(it.basePosition.y.toFixed(3)),
          z: Number(it.basePosition.z.toFixed(3)),
        }))
      );
      localStorage.setItem('gallery-showcase-layout', payload);
      setStatus('Saved to localStorage key: gallery-showcase-layout');
    });

    syncFromSelected();
    this.refreshLayoutEditor();
  }

  private refreshLayoutEditor(): void {
    const editor = this.layoutEditor;
    if (!editor) return;
    const isOverview = this.selectedId === null;
    const shouldShow = isOverview && this.layoutEditorVisible;
    editor.root.classList.toggle('is-hidden', !shouldShow);
    if (!shouldShow) return;
    const item = this.items.find((it) => it.id === editor.select.value);
    if (!item) return;
    editor.xVal.textContent = item.basePosition.x.toFixed(2);
    editor.yVal.textContent = item.basePosition.y.toFixed(2);
    editor.zVal.textContent = item.basePosition.z.toFixed(2);
  }

  private restoreLayoutFromStorage(): boolean {
    try {
      const raw = localStorage.getItem('gallery-showcase-layout');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Array<{ id: string; x: number; y: number; z: number }>;
      if (!Array.isArray(parsed)) return false;
      let applied = 0;
      for (const entry of parsed) {
        const item = this.items.find((it) => it.id === entry.id);
        if (!item) continue;
        if (![entry.x, entry.y, entry.z].every((v) => Number.isFinite(v))) continue;
        item.basePosition.set(entry.x, entry.y, entry.z);
        applied += 1;
      }
      return applied > 0;
    } catch {
      return false;
    }
  }

  setSelectionListener(listener: ((content: PanelContent | null) => void) | null): void {
    this.selectionListener = listener;
    this.notifySelection();
  }

  requestSelect(itemId: string | null): void {
    this.selectItem(itemId);
  }

  private notifySelection(): void {
    if (!this.selectionListener) return;
    const item = this.items.find((it) => it.id === this.selectedId) ?? null;
    this.selectionListener(item ? this.buildPanelContent(item) : null);
  }

  private buildPanelContent(item: ShowcaseItem): PanelContent {
    return {
      id: item.id,
      number: item.number,
      technique: item.technique,
      name: item.name,
      caption: item.caption,
      controls: this.buildControlsFor(item),
      tech: {
        summary: item.tech.summary,
        lines: item.tech.lines.map(([k, v]) => ({ k, v })),
      },
      uploadSpz: (file) => {
        void this.handleUserSpzFile(item, file);
      },
    };
  }

  private async handleUserSpzFile(item: ShowcaseItem, file: File): Promise<void> {
    if (this.uploadInProgress) return;
    if (!file.name.toLowerCase().endsWith('.spz')) return;
    if (file.size > MAX_SPZ_UPLOAD_BYTES) return;

    this.uploadInProgress = true;
    try {
      const fileBytes = await file.arrayBuffer();
      const pack = await loadFilteredPack({ kind: 'bytes', fileBytes, fileName: file.name });
      await this.replaceShowcaseSplatFromPack(item, pack);
    } catch (err) {
      console.warn('[Gallery] Upload failed:', err);
    } finally {
      this.uploadInProgress = false;
    }
  }

  private buildSplatOptsForReload(item: ShowcaseItem, pack: PackedSplats): ConstructorParameters<typeof SplatMesh>[0] {
    const splatOpts: ConstructorParameters<typeof SplatMesh>[0] = { packedSplats: pack };

    switch (item.effectMode) {
      case 'dissolve-reform':
        splatOpts.objectModifier = createDissolveReformModifier(
          item.dissolveAnimT!,
          item.dissolveStaggerUniform!,
        );
        break;
      case 'wave-propagation':
        splatOpts.objectModifier = item.wave!.buildModifier();
        break;
      case 'splat-painting':
        splatOpts.worldModifier = item.paint!.buildWorldModifier();
        break;
      case 'shader-stylize':
        splatOpts.objectModifier = createShaderStylizeModifier(
          item.stylizeAnimT!,
          item.stylizeIntensity!,
          item.stylizeElongationUniform!,
          item.stylizeAxisMaskUniform!,
        );
        break;
      case 'xray-slice':
        splatOpts.objectModifier = item.xray!.buildObjectModifier();
        break;
      case 'boid-swarm':
        splatOpts.objectModifier = item.boid!.buildObjectModifier();
        break;
    }

    return splatOpts;
  }

  private async replaceShowcaseSplatFromPack(item: ShowcaseItem, pack: PackedSplats): Promise<void> {
    const sm = this.sceneManager;
    if (!sm) return;

    item.paint?.clearEdits(item.splat);
    item.wave?.reset();

    const oldSplat = item.splat;
    item.anchor.remove(oldSplat);
    oldSplat.dispose();

    if (item.effectMode === 'boid-swarm') {
      item.boid?.dispose();
      const b = new GalleryBoidItemState();
      item.boid = b;
      b.init(pack, sm.renderer);
    }

    const splatOpts = this.buildSplatOptsForReload(item, pack);
    const splat = new SplatMesh(splatOpts);
    item.splat = splat;

    if (item.dissolveAnimT) {
      item.dissolveAnimT.value = item.params.dissolve;
    }
    splat.maxSh = 0;
    splat.renderOrder = 1;
    splat.frustumCulled = false;

    applyGalleryTiltToSplat(splat, item.layoutIndex);
    item.anchor.add(splat);

    await splat.initialized;
    normalizeSplatToAnchor(splat);
    splat.scale.multiplyScalar(item.displayScale);
    splat.position.multiplyScalar(item.displayScale);
    item.baseScale = splat.scale.x;
    splat.updateGenerator();

    if (item.wave) {
      item.wave.initSplatBBox(splat);
    }
    if (item.xray) {
      item.xray.initBBox(splat);
    }
    if (item.paint) {
      item.paint.initSplatBox(splat, this.sceneManager?.spark);
    }
    item.boid?.reset();

    this.applySelectionVisuals();

    if (this.selectedId === item.id) {
      this.startCameraFocusTween(item.id);
    }
  }

  private buildControlsFor(item: ShowcaseItem): ControlDescriptor[] {
    switch (item.effectMode) {
      case 'shader-stylize':
        return [
          {
            kind: 'slider',
            key: 'intensity',
            label: 'Intensity',
            min: 0,
            max: 1,
            step: 0.01,
            format: (v) => `${Math.round(v * 100)}%`,
            hint: 'Blend between the original capture and the stretched sparkle look.',
            get: () => item.params.amount,
            set: (v) => {
              item.params.amount = v;
            },
          },
          {
            kind: 'slider',
            key: 'elongation',
            label: 'Stretch amount',
            min: 1.0,
            max: 10.0,
            step: 0.1,
            format: (v) => `${v.toFixed(1)}×`,
            hint: 'How much each splat stretches along the chosen axis.',
            get: () => item.params.stylizeElongation,
            set: (v) => {
              item.params.stylizeElongation = v;
            },
          },
          {
            kind: 'segmented',
            key: 'axis',
            label: 'Stretch axis',
            options: [
              { value: 'x', label: 'X' },
              { value: 'y', label: 'Y' },
              { value: 'z', label: 'Z' },
            ],
            hint: 'Which local axis the splats elongate along.',
            get: () => item.params.stylizeAxis,
            set: (v) => {
              const axis = v as 'x' | 'y' | 'z';
              item.params.stylizeAxis = axis;
              if (item.stylizeAxisMaskUniform) {
                (item.stylizeAxisMaskUniform.value as THREE.Vector3).copy(axisMaskFor(axis));
              }
            },
          },
        ];

      case 'splat-painting': {
        const p = item.paint!;
        return [
          {
            kind: 'segmented',
            key: 'mode',
            label: 'Brush mode',
            options: [
              { value: 'paint', label: 'Paint' },
              { value: 'erase', label: 'Erase' },
            ],
            hint: 'Press 1 to paint, 2 to erase.',
            get: () => p.params.mode,
            set: (v) => p.setMode(v as 'paint' | 'erase'),
          },
          {
            kind: 'slider',
            key: 'brushSize',
            label: 'Brush size',
            min: 0.01,
            max: 0.25,
            step: 0.005,
            format: (v) => v.toFixed(3),
            hint: 'How wide the brush is, in world units.',
            get: () => p.params.brushSize,
            set: (v) => {
              p.params.brushSize = v;
              p.brushRadius.value = v;
            },
          },
          {
            kind: 'slider',
            key: 'brushReach',
            label: 'Brush reach',
            min: 0.03,
            max: 1.0,
            step: 0.01,
            format: (v) => v.toFixed(2),
            hint: 'How deep into the surface the brush bites. Small = front splats only.',
            get: () => p.params.brushReach,
            set: (v) => {
              p.params.brushReach = v;
              p.brushReach.value = v;
            },
          },
          {
            kind: 'swatch',
            key: 'color',
            label: 'Color',
            options: PAINT_SWATCHES,
            allowCustom: true,
            hint: 'Pick a preset, or open the picker for any color.',
            get: () => p.params.color,
            set: (v) => {
              p.params.color = v;
              const c = new THREE.Color(v);
              p.brushColor.value.set(c.r, c.g, c.b);
              p.brushActive.value = false;
            },
          },
          {
            kind: 'button',
            key: 'reset',
            label: 'Clear all edits',
            hint: 'Restore the original capture.',
            onClick: () => {
              p.clearEdits(item.splat, this.sceneManager?.spark);
            },
          },
        ];
      }

      case 'xray-slice': {
        const x = item.xray!;
        return [
          {
            kind: 'slider',
            key: 'scanSpeed',
            label: 'Scan speed',
            min: 0,
            max: 3,
            step: 0.05,
            format: (v) => (v === 0 ? 'paused' : `${v.toFixed(2)}×`),
            hint: 'Zero freezes the slice in place.',
            get: () => x.params.scanSpeed,
            set: (v) => {
              x.params.scanSpeed = v;
            },
          },
          {
            kind: 'slider',
            key: 'slabThickness',
            label: 'Slice thickness',
            min: 0.05,
            max: 1,
            step: 0.01,
            format: (v) => v.toFixed(2),
            hint: 'How wide the visible slice is.',
            get: () => x.params.slabThickness,
            set: (v) => {
              x.params.slabThickness = v;
            },
          },
          {
            kind: 'slider',
            key: 'contrast',
            label: 'Scan contrast',
            min: 0.2,
            max: 1.2,
            step: 0.01,
            format: (v) => v.toFixed(2),
            hint: 'How bright the scan beam looks against the faded background.',
            get: () => x.params.contrast,
            set: (v) => {
              x.params.contrast = v;
            },
          },
          {
            kind: 'segmented',
            key: 'axis',
            label: 'Axis',
            options: [
              { value: 'x', label: 'X' },
              { value: 'y', label: 'Y' },
              { value: 'z', label: 'Z' },
            ],
            get: () => x.params.scanAxis,
            set: (v) => x.setAxis(v as 'x' | 'y' | 'z'),
          },
        ];
      }

      case 'dissolve-reform':
        return [
          {
            kind: 'slider',
            key: 'dissolve',
            label: 'Dissolve',
            min: 0,
            max: 1.3,
            step: 0.01,
            format: (v) => v.toFixed(2),
            hint: 'Overall progress. Dragging this pauses the auto cycle.',
            get: () => item.params.dissolve,
            set: (v) => {
              item.params.dissolve = v;
              item.params.autoPlay = false;
            },
          },
          {
            kind: 'slider',
            key: 'dissolveSpeed',
            label: 'Cycle speed',
            min: 0.1,
            max: 3.0,
            step: 0.1,
            format: (v) => `${v.toFixed(1)}×`,
            hint: 'How fast the auto cycle repeats.',
            get: () => item.params.dissolveSpeed,
            set: (v) => {
              item.params.dissolveSpeed = v;
            },
          },
          {
            kind: 'slider',
            key: 'stagger',
            label: 'Stagger',
            min: 0,
            max: 1.5,
            step: 0.01,
            format: (v) => (v === 0 ? 'in sync' : v.toFixed(2)),
            hint: 'Zero dissolves every splat in sync; higher values spread the cascade out over time.',
            get: () => item.params.dissolveStagger,
            set: (v) => {
              item.params.dissolveStagger = v;
            },
          },
          {
            kind: 'toggle',
            key: 'autoPlay',
            label: 'Auto cycle',
            hint: 'Loops the dissolve back and forth on its own.',
            get: () => item.params.autoPlay,
            set: (v) => {
              item.params.autoPlay = v;
            },
          },
        ];

      case 'wave-propagation': {
        const w = item.wave!;
        return [
          {
            kind: 'slider',
            key: 'waveSpeed',
            label: 'Wave speed',
            min: 0.2,
            max: 5,
            step: 0.1,
            format: (v) => `${v.toFixed(1)}×`,
            hint: 'How fast each wave spreads outward.',
            get: () => w.params.waveSpeed,
            set: (v) => {
              w.params.waveSpeed = v;
            },
          },
          {
            kind: 'slider',
            key: 'damping',
            label: 'Wave decay',
            min: 0.05,
            max: 2,
            step: 0.05,
            format: (v) => v.toFixed(2),
            hint: 'How quickly each wave fades with age.',
            get: () => w.params.damping,
            set: (v) => {
              w.params.damping = v;
            },
          },
          {
            kind: 'slider',
            key: 'frequency',
            label: 'Ripple density',
            min: 2.0,
            max: 30.0,
            step: 0.5,
            format: (v) => v.toFixed(1),
            hint: 'How tightly packed the ripples are. High values look like fine ribbing.',
            get: () => w.params.waveFrequency,
            set: (v) => {
              w.params.waveFrequency = v;
            },
          },
          {
            kind: 'slider',
            key: 'displaceScale',
            label: 'Wave height',
            min: 0.0,
            max: 1.0,
            step: 0.01,
            format: (v) => v.toFixed(2),
            hint: 'How far each splat lifts off the surface.',
            get: () => w.params.displaceScale,
            set: (v) => {
              w.params.displaceScale = v;
            },
          },
          {
            kind: 'toggle',
            key: 'autoEmit',
            label: 'Auto generate source points',
            hint: 'Adds a new wave source every few seconds.',
            get: () => w.params.autoEmit,
            set: (v) => {
              w.params.autoEmit = v;
            },
          },
        ];
      }

      case 'boid-swarm': {
        const b = item.boid!;
        return [
          {
            kind: 'slider',
            key: 'vortex',
            label: 'Vortex strength',
            min: 0,
            max: 2,
            step: 0.05,
            format: (v) => `${v.toFixed(2)}×`,
            hint: 'How hard the cursor pulls splats into the swirl.',
            get: () => b.params.vortexStrength,
            set: (v) => {
              b.params.vortexStrength = v;
            },
          },
          {
            kind: 'slider',
            key: 'vortexRadius',
            label: 'Vortex radius',
            min: 0.2,
            max: 1.5,
            step: 0.05,
            format: (v) => v.toFixed(2),
            hint: "How far the cursor's pull reaches.",
            get: () => b.params.vortexRadius,
            set: (v) => {
              b.params.vortexRadius = v;
            },
          },
          {
            kind: 'slider',
            key: 'streak',
            label: 'Streak length',
            min: 0,
            max: 3,
            step: 0.05,
            format: (v) => v.toFixed(2),
            hint: 'Stretches each splat along its motion. Higher values look like long-exposure trails.',
            get: () => b.params.streak,
            set: (v) => {
              b.params.streak = v;
            },
          },
          {
            kind: 'slider',
            key: 'glow',
            label: 'Warm glow',
            min: 0,
            max: 2,
            step: 0.05,
            format: (v) => v.toFixed(2),
            hint: 'How much warm color is added to each splat.',
            get: () => b.params.glow,
            set: (v) => {
              b.params.glow = v;
            },
          },
          {
            kind: 'slider',
            key: 'autoSpeed',
            label: 'Auto-orbit speed',
            min: 0.1,
            max: 2,
            step: 0.05,
            format: (v) => `${v.toFixed(2)} rad/s`,
            hint: 'How fast the idle swirl spins.',
            get: () => b.params.autoSpeed,
            set: (v) => {
              b.params.autoSpeed = v;
            },
          },
          {
            kind: 'toggle',
            key: 'autoDemo',
            label: 'Auto orbit',
            hint: 'Keeps swirling on its own when the cursor is idle.',
            get: () => b.params.autoDemo,
            set: (v) => {
              b.params.autoDemo = v;
            },
          },
          {
            kind: 'button',
            key: 'reset',
            label: 'Reset swarm',
            hint: 'Send every splat back to its starting position.',
            onClick: () => {
              b.reset();
            },
          },
        ];
      }
    }
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
    const focusDistance = selected.effectMode === 'xray-slice' ? 2.85 : 3.25;
    this.cameraTween.endPos.copy(itemPos).addScaledVector(viewDir, focusDistance);
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

  buildGui(_gui: GUI): void {
  }

  dispose(): void {
    this.selectionListener = null;
    if (this.keyDownHandler) {
      window.removeEventListener('keydown', this.keyDownHandler);
      this.keyDownHandler = null;
    }
    if (this.layoutEditor) {
      this.layoutEditor.root.remove();
      this.layoutEditor = null;
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
      item.boid?.dispose();
    }
    this.items = [];
    this.proxyMeshes = [];
    this.hoveredId = null;
    this.selectedId = null;
  }
}
