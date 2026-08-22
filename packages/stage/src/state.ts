/**
 * The Stage state machine.
 *
 * Pure: no Three.js, no DOM, no network. Every rule about what the Stage may do
 * lives here, so the whole thing is testable in milliseconds. The renderer only
 * reflects what this file decides.
 */

export type StageMode = 'EXPLORE' | 'NOTES' | 'SPLIT' | 'FOCUS';
export type CutPlane = 'none' | 'coronal' | 'sagittal' | 'transverse';
export type CameraPreset = 'anterior' | 'posterior' | 'left' | 'right' | 'superior';

export interface StageState {
  asset: string | null;
  mode: StageMode;
  camera: CameraPreset;
  cut: { plane: CutPlane; offset: number };
  highlighted: string[];
  labelsVisible: boolean;
}

export type StageCommand =
  | { type: 'load_asset'; asset: string }
  | { type: 'set_camera'; preset: CameraPreset }
  | { type: 'cut_open'; plane: Exclude<CutPlane, 'none'>; offset?: number }
  | { type: 'close_cut' }
  | { type: 'highlight'; anchors: string[] }
  | { type: 'clear_highlight' }
  | { type: 'set_labels'; visible: boolean };

export type ApplyResult = { ok: true; state: StageState } | { ok: false; error: string };

export const initialState: StageState = {
  asset: null,
  mode: 'EXPLORE',
  camera: 'anterior',
  cut: { plane: 'none', offset: 0 },
  highlighted: [],
  labelsVisible: true,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function applyCommand(
  state: StageState,
  cmd: StageCommand,
  knownAnchors: ReadonlySet<string>,
): ApplyResult {
  // Everything except load_asset needs something on stage to act on.
  if (cmd.type !== 'load_asset' && state.asset === null) {
    return { ok: false, error: `cannot apply "${cmd.type}": no asset loaded` };
  }

  switch (cmd.type) {
    case 'load_asset':
      return { ok: true, state: { ...initialState, asset: cmd.asset } };

    case 'set_camera':
      return { ok: true, state: { ...state, camera: cmd.preset } };

    case 'cut_open':
      return {
        ok: true,
        state: { ...state, cut: { plane: cmd.plane, offset: clamp(cmd.offset ?? 0, -1, 1) } },
      };

    case 'close_cut':
      return { ok: true, state: { ...state, cut: { plane: 'none', offset: 0 } } };

    case 'highlight': {
      const unknown = cmd.anchors.filter((a) => !knownAnchors.has(a));
      if (unknown.length > 0) {
        return { ok: false, error: `unknown anchor(s): ${unknown.join(', ')}` };
      }
      return { ok: true, state: { ...state, highlighted: [...cmd.anchors] } };
    }

    case 'clear_highlight':
      return { ok: true, state: { ...state, highlighted: [] } };

    case 'set_labels':
      return { ok: true, state: { ...state, labelsVisible: cmd.visible } };

    default:
      return { ok: false, error: `unknown command type: ${(cmd as { type: string }).type}` };
  }
}
