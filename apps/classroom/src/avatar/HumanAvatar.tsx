import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { level, progress } from './avatarBus';
import { sampleViseme, visemeTimeline, type Viseme, type VisemeStep } from './visemes';
import { createBlinker, swayAt } from './microMotion';
import type { AvatarPose } from './CartoonAvatar';

/**
 * MEERA IN 3D — a realistic tutor drawn by Three.js on the student's own
 * device, no server GPU.
 *
 * The model is Microsoft Rocketbox Female_Adult_02 (MIT, see
 * content/avatars/f02/LICENSE.md): its _facial FBX carries the 15 Oculus
 * visemes and the ARKit shapes, so the mouth and the blinks are morph
 * weights, not a rig we built.
 *
 * It runs on the same engine as the penguin: the bus says what line is
 * spoken and how loud, visemes.ts turns the text into mouth shapes, and
 * microMotion supplies the blinks and the sway.
 *
 * Her body is Rocketbox's own female mocap (Assets/Animations, same Biped
 * skeleton): a gesture per `pose`, talking gestures while a line is being
 * spoken, and a neutral idle otherwise, cross-faded.
 *
 * Everything arrives as one meshopt-compressed f02.glb (mesh, the face
 * shapes this file drives, and every clip below) plus five WebP textures,
 * all baked by tools/avatar/bake-f02.mjs. Change a clip name here and
 * re-bake there.
 */

/**
 * Under the app's own base, as lib/content.ts reads every other static file:
 * the site serves the tutor at /app/, where a root `/avatars/…` is the
 * marketing site's 404 and she would never load.
 */
const BASE = `${import.meta.env.BASE_URL}avatars/f02/`;

/** Oculus viseme weights per mouth shape, at full loudness. Names are the FBX's own. */
const MOUTH: Record<Viseme, Record<string, number>> = {
  rest: {},
  open: { AA_VI_10_aa: 0.65 },
  wide: { AA_VI_11_E: 0.55, AA_VI_12_I: 0.3 },
  round: { AA_VI_13_O: 0.5, AA_VI_14_U: 0.4 },
  press: { AA_VI_01_PP: 0.9 },
  teeth: { AA_VI_02_FF: 0.85 },
};

/**
 * Rocketbox clip per pose.
 *
 * `point` is the one that must aim at the board. The board is to the
 * tutor's screen-left in both layouts — the rail sits right of the board on
 * a wide screen, and the phone PiP floats at the board's bottom-right — so
 * the clip is the one whose arm reaches screen-left.
 */
const POSE_CLIP: Record<AvatarPose, string> = {
  idle: 'f_idle_neutral_01',
  point: 'f_gestic_presentation_right_01',
  explain: 'f_gestic_talk_neutral_01',
  greet: 'f_wave_01',
  think: 'f_gestic_thoughtful_01',
  listen: 'f_gestic_listen_neutral_01',
  cheer: 'f_claphands_01',
};

/** Talking gestures, a different one per spoken line. */
const TALK_CLIPS = [
  'f_gestic_talk_neutral_01',
  'f_gestic_talk_neutral_02',
  'f_gestic_talk_neutral_03',
  'f_gestic_talk_relaxed_01',
  'f_moderate_01',
];

const FADE_S = 0.45;

/** A resting face that is not a stare: the faintest smile, always on. */
const AT_REST: Record<string, number> = { AK_44_MouthSmileLeft: 0.12, AK_45_MouthSmileRight: 0.12 };

/** Every morph the face loop writes, so each one eases back to zero when unused. */
const DRIVEN = [
  ...new Set([
    ...Object.values(MOUTH).flatMap((m) => Object.keys(m)),
    ...Object.keys(AT_REST),
    'AK_09_EyeBlinkLeft',
    'AK_10_EyeBlinkRight',
    'AK_03_BrowInnerUp',
  ]),
];

/**
 * Her three materials, by the names the GLB keeps, and the WebP each wears.
 * The `cutout` one is hair, lashes and brows: its alpha channel is the shape.
 */
const SKIN: Record<string, { map: string; normalMap?: string; cutout?: boolean }> = {
  f002_body: { map: 'f002_body_color.webp', normalMap: 'f002_body_normal.webp' },
  f002_head: { map: 'f002_head_color.webp', normalMap: 'f002_head_normal.webp' },
  f002_opacity: { map: 'f002_opacity_color.webp', cutout: true },
};

export interface HumanAvatarStats {
  loadMs: number | null;
  fps: number;
  /** The body clip playing now, or null before the first one has started. */
  clip: string | null;
  morphs: string[];
}

declare global {
  interface Window {
    /** Lab-only handle for measuring the avatar from devtools. */
    __humanAvatar?: {
      stats: HumanAvatarStats;
      model: THREE.Object3D | null;
      camera: THREE.PerspectiveCamera;
      /** Renders `n` frames back to back and waits for the GPU: ms per frame. */
      bench: (n: number) => number;
      /** Plays the clips; null until the model has loaded. */
      mixer: THREE.AnimationMixer | null;
    };
  }
}

/*
 * One download and one parse per page, however many tiles mount: the phone
 * PiP unmounted whenever answer chips were up (there are none since 2026-10-01) and mounted again after, and
 * reloading her on every return would stall the class each time. Each tile
 * wears its own skinned clone of the shared template.
 */
let template: Promise<THREE.Object3D> | null = null;
const clipsReady = new Map<string, THREE.AnimationClip>();

function loadTemplate(): Promise<THREE.Object3D> {
  if (template) return template;
  const textures = new THREE.TextureLoader();
  const texture = (file: string, colour: boolean): THREE.Texture => {
    const t = textures.load(BASE + file);
    if (colour) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  template = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(BASE + 'f02.glb')
    .then((gltf) => {
      for (const clip of gltf.animations) clipsReady.set(clip.name, clip);
      gltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const name = (mesh.material as THREE.Material).name;
        const skin = SKIN[name];
        if (!skin) return;
        mesh.material = new THREE.MeshPhongMaterial({
          name,
          map: texture(skin.map, true),
          normalMap: skin.normalMap ? texture(skin.normalMap, false) : null,
          shininess: 12,
          specular: 0x222222,
          ...(skin.cutout ? { transparent: true, alphaTest: 0.35, depthWrite: false, side: THREE.DoubleSide } : {}),
        });
      });
      return gltf.scene;
    });
  // A failed load must not poison every later tile for the rest of the page.
  template.catch(() => {
    template = null;
  });
  return template;
}

/** True when this browser can draw her; otherwise the tile keeps the penguin. */
let webgl: boolean | null = null;
export function canDrawHuman(): boolean {
  if (webgl !== null) return webgl;
  // No WebGL in this runtime at all (jsdom in tests): don't even ask a canvas.
  if (typeof WebGLRenderingContext === 'undefined') return (webgl = false);
  try {
    const canvas = document.createElement('canvas');
    webgl = !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webgl = false;
  }
  return webgl;
}

export function HumanAvatar({
  pose,
  className,
  debug = false,
  onReady,
}: {
  pose: AvatarPose;
  className?: string;
  /** Publish window.__humanAvatar for the lab's numbers. */
  debug?: boolean;
  /** Called once she is in the scene, so the tile can drop its placeholder. */
  onReady?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff4ea, 0x3a3550, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 1, 1.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb6ff, 1.2);
    rim.position.set(-1, 0.8, -0.8);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(24, 1, 1, 1000);
    const stats: HumanAvatarStats = { loadMs: null, fps: 0, clip: null, morphs: [] };
    const bench = (n: number): number => {
      const gl = renderer.getContext();
      const t0 = performance.now();
      for (let i = 0; i < n; i += 1) renderer.render(scene, camera);
      gl.finish();
      return (performance.now() - t0) / n;
    };

    let model: THREE.Object3D | null = null;
    /** Each face mesh with the morph slot of every DRIVEN name it has. */
    let faces: { mesh: THREE.Mesh; slot: Record<string, number> }[] = [];
    let head: THREE.Bone | null = null;
    let headRest = new THREE.Quaternion();
    let mixer: THREE.AnimationMixer | null = null;
    let playing: { name: string; action: THREE.AnimationAction } | null = null;
    let disposed = false;
    let started: number | null = null;

    const publish = (): void => {
      if (debug) window.__humanAvatar = { stats, model, camera, bench, mixer };
    };
    publish();

    /**
     * What the shot holds. A big frame (the lab) is waist-up, so her hands
     * are in it. A classroom tile is small (the phone PiP is 104 px wide,
     * the rail 180 px tall), and waist-up there leaves her face a few pixels
     * high with the lips unreadable — so tiles are chest-up, like a call.
     */
    let body: { top: number; head: number; waist: number; chest: number; x: number; z: number; height: number } | null =
      null;
    let small = true;
    const aim = (): void => {
      if (!body) return;
      const bottom = small ? body.chest : body.waist - body.height * 0.06;
      const top = small ? body.head : body.top;
      const center = new THREE.Vector3(body.x, (top + bottom) / 2, body.z);
      const halfH = (top - bottom) / 2;
      const halfW = body.height * (small ? 0.17 : 0.22);
      const v = THREE.MathUtils.degToRad(camera.fov) / 2;
      const h = Math.atan(Math.tan(v) * camera.aspect);
      const dist = Math.max(halfH / Math.tan(v), halfW / Math.tan(h));
      camera.position.set(center.x, center.y, center.z + dist);
      camera.lookAt(center);
    };

    /** Clone the shared template into this tile and set her up. */
    const begin = (): void => {
      started = performance.now();
      loadTemplate()
        .then((tpl) => {
          if (disposed) return;
          const her = cloneSkinned(tpl);
          model = her;
          stats.loadMs = Math.round(performance.now() - started!);

          her.traverse((o) => {
            const mesh = o as THREE.Mesh;
            const dict = mesh.isMesh ? mesh.morphTargetDictionary : undefined;
            if (dict && Object.keys(dict).length > 0) {
              // FBX prefixes every shape with its deformer ("blendShape1.AK_25_JawOpen").
              const slot: Record<string, number> = {};
              for (const [k, i] of Object.entries(dict)) {
                stats.morphs.push(k);
                const bare = k.slice(k.lastIndexOf('.') + 1);
                if (DRIVEN.includes(bare)) slot[bare] = i;
              }
              faces.push({ mesh, slot });
            }
            if ((o as THREE.Bone).isBone && o.name.endsWith('Head')) head = o as THREE.Bone;
          });
          if (head) headRest = (head as THREE.Bone).quaternion.clone();

          scene.add(her);
          her.updateMatrixWorld(true);
          mixer = new THREE.AnimationMixer(her);

          const box = new THREE.Box3().setFromObject(her);
          const height = box.max.y - box.min.y;
          const y = (name: string, fallback: number): number => {
            const bone = her.getObjectByName(name);
            return bone ? bone.getWorldPosition(new THREE.Vector3()).y : fallback;
          };
          const waist = y('Bip01_Pelvis', box.min.y + height * 0.55);
          body = {
            // Headroom for a raised hand: the wave goes well above her head.
            top: box.max.y + height * 0.1,
            // Just above her hair, for the close shot.
            head: box.max.y + height * 0.02,
            waist,
            chest: (waist + y('Bip01_Neck', box.max.y - height * 0.12)) / 2,
            x: (box.min.x + box.max.x) / 2,
            z: (box.min.z + box.max.z) / 2,
            height,
          };
          camera.near = height * 0.05;
          camera.far = height * 10;
          camera.updateProjectionMatrix();
          aim();
          publish();
          onReadyRef.current?.();
        })
        .catch((err) => console.error('HumanAvatar: the model did not load', err));
    };

    /** Zero while the tile is display:none (the rail on a phone, the PiP on a laptop). */
    let visible = false;
    const fit = (): void => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      visible = w > 0 && h > 0;
      if (!visible) return;
      small = h < 240;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      aim();
      // Nothing is fetched for a tile nobody can see.
      if (started === null) begin();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);

    /**
     * Cross-fade to `name`. The very first clip starts at full weight: a fade
     * in from nothing would blend from the bind pose, and she would open the
     * class swinging her arms down out of a T.
     */
    const playClip = (name: string): void => {
      if (!mixer || playing?.name === name) return;
      const clip = clipsReady.get(name);
      if (!clip) return;
      const next = mixer.clipAction(clip).reset().setEffectiveWeight(1);
      if (playing) {
        next.fadeIn(FADE_S).play();
        playing.action.fadeOut(FADE_S);
      } else {
        next.play();
      }
      playing = { name, action: next };
      stats.clip = name;
    };

    const blinker = createBlinker();
    const born = performance.now();
    let lineCache: { text: string; steps: VisemeStep[] } = { text: '', steps: [] };
    let lines = 0;
    const weights: Record<string, number> = {};
    let raf = 0;
    let frames = 0;
    let fpsSince = performance.now();
    let last = performance.now();

    const draw = (): void => {
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!visible || !model) return;
      const t = now - born;

      frames += 1;
      if (now - fpsSince >= 1000) {
        stats.fps = Math.round((frames * 1000) / (now - fpsSince));
        frames = 0;
        fpsSince = now;
      }

      const p = progress();
      if (p.text !== lineCache.text) {
        lineCache = { text: p.text, steps: visemeTimeline(p.text) };
        if (p.text !== '') lines += 1;
      }
      const v: Viseme =
        p.text === '' ? 'rest' : sampleViseme(lineCache.steps, p.elapsedMs, p.durationMs ?? undefined);
      const heard = level();
      const drive = heard ?? (p.text === '' ? 0 : v === 'rest' ? 0.15 : 0.6);
      const amp = v === 'rest' ? 0 : 0.45 + 0.55 * drive;

      const want: Record<string, number> = { ...AT_REST };
      for (const [k, w] of Object.entries(MOUTH[v])) want[k] = w * amp;
      const shut = 1 - blinker.opennessAt(t);
      want.AK_09_EyeBlinkLeft = shut;
      want.AK_10_EyeBlinkRight = shut;
      want.AK_03_BrowInnerUp = p.text.includes('?') ? 0.35 : 0;

      // Mouth eases (about 60 ms to settle); blinks are fast enough to snap.
      const ease = 1 - Math.exp(-dt / 0.06);
      for (const k of DRIVEN) {
        const target = want[k] ?? 0;
        const cur = weights[k] ?? 0;
        weights[k] = k.includes('EyeBlink') ? target : cur + (target - cur) * ease;
        for (const { mesh, slot } of faces) {
          const i = slot[k];
          if (i !== undefined) mesh.morphTargetInfluences![i] = weights[k];
        }
      }

      // The body: the pose's gesture; talking gestures while she speaks; idle otherwise.
      const posed = poseRef.current;
      playClip(
        posed !== 'idle'
          ? POSE_CLIP[posed]
          : p.text !== ''
            ? TALK_CLIPS[(lines - 1) % TALK_CLIPS.length]
            : POSE_CLIP.idle,
      );
      mixer?.update(dt);

      // The voice nods her head on top of whatever the clip is doing. Before
      // any clip drives the head, start from its rest so the nod cannot pile up.
      const sway = swayAt(t, drive);
      const rad = THREE.MathUtils.degToRad;
      if (head) {
        const q = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(rad(sway.dy * 0.4), rad(sway.dx * 0.3), rad(sway.rotDeg * 0.6)),
        );
        if (!playing) (head as THREE.Bone).quaternion.copy(headRest);
        (head as THREE.Bone).quaternion.multiply(q);
      }

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      mixer?.stopAllAction();
      ro.disconnect();
      renderer.dispose();
      renderer.domElement.remove();
      faces = [];
      if (debug) delete window.__humanAvatar;
    };
  }, [debug]);

  return <div ref={hostRef} className={className} aria-hidden />;
}
