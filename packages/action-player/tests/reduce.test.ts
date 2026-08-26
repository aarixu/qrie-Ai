import { describe, expect, it } from 'vitest';
import type { Action } from '@openmaic/dsl';
import { initialBoard, WB_SCALE_Y } from '../src/state';
import { reduce } from '../src/reduce';

const play = (...actions: Action[]) => actions.reduce(reduce, initialBoard);

describe('drawing verbs become elements the Scene already knows', () => {
  it('turns wb_draw_text into a text element, scaled onto our canvas', () => {
    const state = play({
      id: 'a1',
      type: 'wb_draw_text',
      elementId: 't1',
      content: 'Mitochondria make ATP',
      x: 100,
      y: 200,
    });
    expect(state.elements).toEqual([
      { kind: 'text', id: 't1', x: 100, y: 200 * WB_SCALE_Y, text: 'Mitochondria make ATP' },
    ]);
    expect(state.visible).toEqual(['t1']);
  });

  it('strips HTML from wb_draw_text, because content may be an HTML string', () => {
    const state = play({
      id: 'a1',
      type: 'wb_draw_text',
      elementId: 't1',
      content: '<p>Inner <b>membrane</b></p>',
      x: 0,
      y: 0,
    });
    expect(state.elements[0]).toMatchObject({ text: 'Inner membrane' });
  });

  it('turns wb_draw_shape into a box', () => {
    const state = play({
      id: 'a1',
      type: 'wb_draw_shape',
      elementId: 's1',
      shape: 'rectangle',
      x: 10,
      y: 20,
      width: 300,
      height: 100,
    });
    expect(state.elements).toEqual([
      { kind: 'box', id: 's1', x: 10, y: 20 * WB_SCALE_Y, w: 300, h: 100 * WB_SCALE_Y, label: '' },
    ]);
  });

  it('turns wb_draw_line into an arrow, keeping the dash', () => {
    const state = play({
      id: 'a1',
      type: 'wb_draw_line',
      elementId: 'l1',
      startX: 0,
      startY: 0,
      endX: 100,
      endY: 562,
      style: 'dashed',
    });
    expect(state.elements).toEqual([
      { kind: 'arrow', id: 'l1', from: { x: 0, y: 0 }, to: { x: 100, y: 620 }, dashed: true },
    ]);
  });

  it('turns wb_draw_latex into a formula', () => {
    const state = play({
      id: 'a1',
      type: 'wb_draw_latex',
      elementId: 'f1',
      latex: 'C_6H_{12}O_6',
      x: 500,
      y: 300,
    });
    expect(state.elements).toEqual([
      { kind: 'formula', id: 'f1', x: 500, y: 300 * WB_SCALE_Y, text: 'C_6H_{12}O_6' },
    ]);
  });

  it('generates an id when the author did not supply one', () => {
    const state = play({
      id: 'act-7',
      type: 'wb_draw_text',
      content: 'no elementId here',
      x: 0,
      y: 0,
    });
    expect(state.elements[0].id).toBe('act-7');
    expect(state.visible).toEqual(['act-7']);
  });
});

describe('focus verbs emphasise without hiding', () => {
  it('spotlight focuses one element', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_draw_text', elementId: 't2', content: 'b', x: 0, y: 0 },
      { id: 'a3', type: 'spotlight', elementId: 't2' },
    );
    expect(state.focus).toEqual(['t2']);
    expect(state.visible).toEqual(['t1', 't2']);
  });

  it('laser focuses too — a pointer is a spotlight that moves', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'laser', elementId: 't1' },
    );
    expect(state.focus).toEqual(['t1']);
  });

  it('a later focus replaces the earlier one rather than accumulating', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_draw_text', elementId: 't2', content: 'b', x: 0, y: 0 },
      { id: 'a3', type: 'spotlight', elementId: 't1' },
      { id: 'a4', type: 'spotlight', elementId: 't2' },
    );
    expect(state.focus).toEqual(['t2']);
  });
});

describe('board management', () => {
  it('wb_clear empties the board but leaves it open', () => {
    const state = play(
      { id: 'a0', type: 'wb_open' },
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_clear' },
    );
    expect(state.elements).toEqual([]);
    expect(state.visible).toEqual([]);
    expect(state.focus).toEqual([]);
    expect(state.whiteboardOpen).toBe(true);
  });

  it('wb_delete removes one element and drops it from focus', () => {
    const state = play(
      { id: 'a1', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a2', type: 'wb_draw_text', elementId: 't2', content: 'b', x: 0, y: 0 },
      { id: 'a3', type: 'spotlight', elementId: 't2' },
      { id: 'a4', type: 'wb_delete', elementId: 't2' },
    );
    expect(state.elements.map((e) => e.id)).toEqual(['t1']);
    expect(state.visible).toEqual(['t1']);
    expect(state.focus).toEqual([]);
  });

  it('wb_open and wb_close toggle the surface without losing what is drawn', () => {
    const state = play(
      { id: 'a1', type: 'wb_open' },
      { id: 'a2', type: 'wb_draw_text', elementId: 't1', content: 'a', x: 0, y: 0 },
      { id: 'a3', type: 'wb_close' },
    );
    expect(state.whiteboardOpen).toBe(false);
    expect(state.elements.map((e) => e.id)).toEqual(['t1']);
  });
});

describe('verbs that change nothing on the board', () => {
  it('leaves state untouched for speech — narration is audio, not ink', () => {
    const before = play({
      id: 'a1',
      type: 'wb_draw_text',
      elementId: 't1',
      content: 'a',
      x: 0,
      y: 0,
    });
    const after = reduce(before, { id: 'a2', type: 'speech', text: 'Listen carefully.' });
    expect(after).toBe(before);
  });

  it('leaves state untouched for an action it does not handle', () => {
    const before = initialBoard;
    const after = reduce(before, { id: 'a1', type: 'discussion', topic: 'anything' });
    expect(after).toBe(before);
  });
});
