import { describe, it, expect } from 'vitest';
import { applyCommand, initialState, type StageState, type StageCommand } from '../src/state';

const ANCHORS = new Set(['left_ventricle', 'right_ventricle', 'aorta']);

function apply(state: StageState, cmd: StageCommand): StageState {
  const r = applyCommand(state, cmd, ANCHORS);
  if (!r.ok) throw new Error(`unexpected rejection: ${r.error}`);
  return r.state;
}

const loaded = () => apply(initialState, { type: 'load_asset', asset: 'heart.glb' });

describe('applyCommand', () => {
  it('loads an asset', () => {
    expect(loaded().asset).toBe('heart.glb');
  });

  it('rejects highlighting an unknown anchor', () => {
    const r = applyCommand(loaded(), { type: 'highlight', anchors: ['spleen'] }, ANCHORS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('spleen');
  });

  it('rejects any command before an asset is loaded', () => {
    const r = applyCommand(initialState, { type: 'highlight', anchors: ['aorta'] }, ANCHORS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no asset');
  });

  it('cuts open and records the plane', () => {
    expect(apply(loaded(), { type: 'cut_open', plane: 'coronal' }).cut).toEqual({
      plane: 'coronal',
      offset: 0,
    });
  });

  it('close_cut returns to plane none', () => {
    let s = apply(loaded(), { type: 'cut_open', plane: 'coronal' });
    s = apply(s, { type: 'close_cut' });
    expect(s.cut.plane).toBe('none');
  });

  it('clamps cut offset to [-1, 1]', () => {
    expect(apply(loaded(), { type: 'cut_open', plane: 'coronal', offset: 5 }).cut.offset).toBe(1);
    expect(apply(loaded(), { type: 'cut_open', plane: 'coronal', offset: -5 }).cut.offset).toBe(-1);
  });

  it('highlight replaces rather than accumulates', () => {
    let s = apply(loaded(), { type: 'highlight', anchors: ['aorta'] });
    s = apply(s, { type: 'highlight', anchors: ['left_ventricle'] });
    expect(s.highlighted).toEqual(['left_ventricle']);
  });

  it('clear_highlight empties the selection', () => {
    let s = apply(loaded(), { type: 'highlight', anchors: ['aorta'] });
    s = apply(s, { type: 'clear_highlight' });
    expect(s.highlighted).toEqual([]);
  });

  it('set_camera changes the preset', () => {
    expect(apply(loaded(), { type: 'set_camera', preset: 'posterior' }).camera).toBe('posterior');
  });

  it('never mutates the input state', () => {
    const s = loaded();
    const before = structuredClone(s);
    apply(s, { type: 'highlight', anchors: ['aorta'] });
    expect(s).toEqual(before);
  });

  it('rejects an unknown command type', () => {
    const r = applyCommand(loaded(), { type: 'explode' } as never, ANCHORS);
    expect(r.ok).toBe(false);
  });

  it('load_asset resets prior cut and highlight state', () => {
    let s = apply(loaded(), { type: 'cut_open', plane: 'coronal' });
    s = apply(s, { type: 'highlight', anchors: ['aorta'] });
    s = apply(s, { type: 'load_asset', asset: 'kidney.glb' });
    expect(s.cut.plane).toBe('none');
    expect(s.highlighted).toEqual([]);
  });
});
