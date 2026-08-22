import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StageState, CutPlane, CameraPreset } from './state';

/**
 * The 3D viewport.
 *
 * Deliberately dumb: it holds no rules, only reflects StageState. Every decision
 * was already made in applyCommand. If you find yourself adding an `if` here
 * that decides something, it belongs in state.ts instead.
 */

const CAMERA_DIRECTIONS: Record<CameraPreset, THREE.Vector3> = {
  anterior: new THREE.Vector3(0, 0, 1),
  posterior: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  superior: new THREE.Vector3(0, 1, 0),
};

const PLANE_NORMALS: Record<Exclude<CutPlane, 'none'>, THREE.Vector3> = {
  coronal: new THREE.Vector3(0, 0, -1),
  sagittal: new THREE.Vector3(-1, 0, 0),
  transverse: new THREE.Vector3(0, -1, 0),
};

const HIGHLIGHT_COLOR = new THREE.Color(0xffb347);
const CUT_ANIM_MS = 1400;

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
  private readonly nodes = new Map<string, THREE.Mesh>();
  private readonly baseColors = new Map<string, THREE.Color>();

  private radius = 1;
  private frame = 0;
  /** Animated cut sweep: the plane slides in rather than snapping. */
  private cutFrom = 1e6;
  private cutTo = 1e6;
  private cutStartedAt = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Required before any material may carry a clipping plane.
    this.renderer.localClippingEnabled = true;

    this.scene.background = new THREE.Color(0x0f1116);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.8);
    fill.position.set(-3, -1, -2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd9a0, 0.6);
    rim.position.set(0, -2, -4);
    this.scene.add(rim);

    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderLoop();
  }

  async load(url: string): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;

    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      // Materials are cloned so per-mesh highlighting cannot bleed across nodes
      // that happen to share a material in the source file.
      const src = mesh.material as THREE.MeshStandardMaterial;
      const material = src.clone();
      // Without DoubleSide a clipped mesh renders as nothing — you would be
      // looking at culled back faces. This single line is the difference between
      // "the heart opens up" and "the heart vanishes".
      material.side = THREE.DoubleSide;
      material.clippingPlanes = [];
      material.clipShadows = true;
      mesh.material = material;

      this.nodes.set(mesh.name, mesh);
      this.baseColors.set(mesh.name, material.color.clone());
    });

    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    this.radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    root.position.sub(center);
    this.scene.add(root);

    this.controls.target.set(0, 0, 0);
    this.applyCamera('anterior');
  }

  /** Reflect state. Contains no rules. */
  sync(state: StageState): void {
    this.applyCamera(state.camera);
    this.applyCut(state.cut.plane, state.cut.offset);
    this.applyHighlight(state.highlighted);
  }

  nodeNames(): string[] {
    return [...this.nodes.keys()];
  }

  worldPositionOf(anchorId: string): THREE.Vector3 | null {
    const mesh = this.nodes.get(anchorId);
    if (!mesh) return null;
    return new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  }

  /** World point to screen pixels, plus whether it faces the camera. */
  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    const toPoint = v.clone().sub(this.camera.position).normalize();
    const facing = this.camera.getWorldDirection(new THREE.Vector3());
    return {
      x: (p.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-p.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible: p.z < 1 && toPoint.dot(facing) > 0,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private applyCamera(preset: CameraPreset): void {
    const dir = CAMERA_DIRECTIONS[preset];
    const distance = (this.radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.5;
    this.camera.position.copy(dir).multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  private applyCut(plane: CutPlane, offset: number): void {
    const active = plane !== 'none';
    // Parked far outside the model when inactive, so nothing is clipped.
    const target = active ? offset * this.radius : 1e6;

    if (active) this.clipPlane.normal.copy(PLANE_NORMALS[plane]);

    if (target !== this.cutTo) {
      this.cutFrom = this.clipPlane.constant;
      this.cutTo = target;
      this.cutStartedAt = performance.now();
    }

    for (const mesh of this.nodes.values()) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const wanted = active ? [this.clipPlane] : [];
      if (material.clippingPlanes?.length !== wanted.length) {
        material.clippingPlanes = wanted;
        material.needsUpdate = true;
      }
    }
  }

  private applyHighlight(ids: readonly string[]): void {
    const lit = new Set(ids);
    for (const [name, mesh] of this.nodes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const base = this.baseColors.get(name);
      if (!base) continue;
      const isLit = lit.has(name);
      const dimmed = lit.size > 0 && !isLit;
      material.color.copy(isLit ? HIGHLIGHT_COLOR : base);
      material.emissive.setHex(isLit ? 0x552b00 : 0x000000);
      material.transparent = dimmed;
      material.opacity = dimmed ? 0.18 : 1;
      material.depthWrite = !dimmed;
    }
  }

  private resize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private renderLoop = (): void => {
    this.frame = requestAnimationFrame(this.renderLoop);

    // Ease the clipping plane toward its target so the cut sweeps through.
    if (this.clipPlane.constant !== this.cutTo) {
      const t = Math.min(1, (performance.now() - this.cutStartedAt) / CUT_ANIM_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      this.clipPlane.constant = this.cutFrom + (this.cutTo - this.cutFrom) * eased;
      if (t >= 1) this.clipPlane.constant = this.cutTo;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
