import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../src/Scene';
import { computeVisible } from '../src/visible';

// The committed fixture is the real contract test: if the format or this
// renderer drifts, the lesson every other package tests against breaks here.
const fixturePath = resolve(process.cwd(), 'content/class10-heart-mini/lesson.json');
const parsed = validateLesson(JSON.parse(readFileSync(fixturePath, 'utf8')));
if (!parsed.ok) throw new Error(`fixture lesson invalid: ${parsed.errors.join('; ')}`);
const lesson = parsed.lesson;

const render = (visible: string[], focus: string[] = []) =>
  renderToString(<Scene lesson={lesson} visible={visible} focus={focus} />);

/** The opening <g> tag of one element's group, wherever its attributes landed. */
function groupTag(html: string, id: string): string {
  const m = html.match(new RegExp(`<g[^>]*data-element-id="${id}"[^>]*>`));
  if (!m) throw new Error(`no group rendered for element "${id}"`);
  return m[0];
}

describe('Scene: visibility', () => {
  it('renders labels of shown elements and nothing from hidden ones', () => {
    // Beat "pump" shows only the heart box and its caption.
    const html = render(['b_heart', 'x_pump']);
    expect(html).toContain('HEART');
    expect(html).toContain('One pump');
    expect(html).not.toContain('LUNGS');
    expect(html).not.toContain('delivery kaun');
    expect(html).not.toContain('data-element-id="b_lungs"');
  });

  it('renders every beat of the fixture without throwing', () => {
    lesson.beats.forEach((_beat, i) => {
      const { visible, focus } = computeVisible(lesson, i);
      const html = render(visible, focus);
      for (const id of visible) expect(html).toContain(`data-element-id="${id}"`);
    });
  });

  it('silently ignores unknown ids in visible', () => {
    const html = render(['ghost-element', 'b_heart']);
    expect(html).toContain('HEART');
    expect(html).not.toContain('ghost-element');
  });

  it('renders an empty canvas for an empty visible set', () => {
    expect(render([])).not.toContain('data-element-id');
  });
});

describe('Scene: focus', () => {
  it('dims non-focused elements without erasing them, and glows the focused one', () => {
    const html = render(['b_heart', 'x_pump'], ['b_heart']);
    expect(groupTag(html, 'x_pump')).toContain('opacity="0.4"');
    expect(groupTag(html, 'b_heart')).not.toContain('opacity="0.4"');
    expect(groupTag(html, 'b_heart')).toContain('drop-shadow');
  });

  it('dims nothing when focus is empty', () => {
    const html = render(['b_heart', 'x_pump'], []);
    expect(html).not.toContain('opacity="0.4"');
  });

  it('still renders the dimmed element content (dim, never hide)', () => {
    const html = render(['b_heart', 'x_pump'], ['b_heart']);
    expect(html).toContain('One pump');
  });
});

describe('Scene: frame and determinism', () => {
  it('frames the camera on the visible content, not the whole board', () => {
    const html = render(['b_heart']);
    const m = html.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/);
    expect(m).not.toBeNull();
    // Zoomed in: the frame is smaller than the board, but never past MAX_ZOOM.
    const [, , , w, h] = m!.map(Number);
    expect(w).toBeLessThan(lesson.canvas.w);
    expect(h).toBeLessThan(lesson.canvas.h);
    expect(w).toBeGreaterThanOrEqual(lesson.canvas.w / 3 - 0.1); // toFixed(1) rounding
    expect(html).toContain('width:100%');
  });

  it('holds the whole board when `wide` is set', () => {
    const html = renderToString(<Scene lesson={lesson} visible={['b_heart']} focus={[]} wide />);
    expect(html).toContain(`viewBox="0.0 0.0 ${lesson.canvas.w}.0 ${lesson.canvas.h}.0"`);
  });

  it('is byte-identical across renders (no Math.random anywhere)', () => {
    const all = lesson.elements.map((e) => e.id);
    expect(render(all, ['b_lv'])).toBe(render(all, ['b_lv']));
  });

  it('applies a small per-id rotation jitter', () => {
    const tag = groupTag(render(['b_heart']), 'b_heart');
    const m = tag.match(/rotate\((-?\d+\.\d+) /);
    expect(m).not.toBeNull();
    const deg = Number(m![1]);
    expect(Math.abs(deg)).toBeLessThanOrEqual(0.7);
    expect(deg).not.toBe(0);
  });

  it('maps tones to theme colors (content itself has no hex codes)', () => {
    const html = render(['b_lungs', 'b_heart', 'a_lungs_la']);
    expect(html).toContain('#58cc02'); // good → lungs box + O2 arrow
    expect(html).toContain('#1cb0f6'); // accent → heart box
    expect(JSON.stringify(lesson)).not.toContain('#');
  });
});

describe('Scene: draw-in (renderToString is always a first render — everything is new)', () => {
  it('gives shapes the opacity+scale draw-in class', () => {
    expect(groupTag(render(['b_heart']), 'b_heart')).not.toContain('stage-pop');
    expect(render(['b_heart'])).toContain('class="stage-pop"');
  });

  it('sweeps arrows in via a mask so a dashed arrow keeps its dash pattern', () => {
    const html = render(['a_body_ra']); // the fixture's dashed arrow
    expect(html).toContain('mask="url(#stage-sweep-a_body_ra)"');
    expect(html).toContain('class="stage-sweep"');
    expect(html).toContain('pathLength="1"');
    expect(html).toContain('stroke-dasharray="8 7"');
  });
});

describe('Scene: every element kind renders', () => {
  // The fixture exercises title/text/note/box/arrow; this synthetic lesson
  // covers the remaining kinds so the closed vocabulary stays fully renderable.
  const kinds: Lesson = {
    formatVersion: 1,
    id: 'kinds',
    title: 'All Kinds',
    language: 'en',
    canvas: { w: 1000, h: 620 },
    elements: [
      { kind: 'title', id: 'k_title', x: 500, y: 60, text: 'Every Kind', sub: 'the closed vocabulary' },
      { kind: 'text', id: 'k_text', x: 500, y: 120, text: 'plain text', size: 24, muted: true },
      { kind: 'note', id: 'k_note', x: 40, y: 160, w: 220, text: 'a wrapped note card', tone: 'accent' },
      { kind: 'box', id: 'k_box', x: 300, y: 160, w: 160, h: 90, label: 'Left\nVentricle', tone: 'bad' },
      { kind: 'doc', id: 'k_doc', x: 500, y: 160, w: 140, h: 110, label: 'NCERT page', lines: 5 },
      { kind: 'arrow', id: 'k_arrow', from: { x: 300, y: 320 }, to: { x: 500, y: 340 }, label: 'flow', tone: 'good' },
      { kind: 'pen', id: 'k_pen', points: [{ x: 100, y: 400 }, { x: 160, y: 380 }, { x: 220, y: 420 }], tone: 'accent' },
      { kind: 'formula', id: 'k_formula', x: 500, y: 430, text: 'E = mc^2' },
      { kind: 'image', id: 'k_image', x: 700, y: 160, w: 200, h: 140, src: 'heart.png', alt: 'a heart diagram', label: 'Figure 1' },
      { kind: 'model3d', id: 'k_model', x: 700, y: 380, w: 220, h: 180, asset: 'heart.glb', label: 'Heart in 3D' },
    ],
    beats: [{ id: 'all', topic: 'all', narration: 'all', show: [] }],
  };

  const html = renderToString(
    <Scene lesson={kinds} visible={kinds.elements.map((e) => e.id)} focus={[]} />,
  );

  it('renders all ten kinds without throwing', () => {
    for (const el of kinds.elements) expect(html).toContain(`data-element-id="${el.id}"`);
  });

  it('title renders headline and sub', () => {
    expect(html).toContain('Every Kind');
    expect(html).toContain('the closed vocabulary');
  });

  it('note wraps in a foreignObject card', () => {
    expect(html).toContain('<foreignObject');
    expect(html).toContain('a wrapped note card');
  });

  it('box supports multi-line labels', () => {
    expect(html).toContain('>Left</text>');
    expect(html).toContain('>Ventricle</text>');
  });

  it('doc draws its placeholder line strokes and label', () => {
    expect(html).toContain('NCERT page');
    // Slice may also contain the arrow's sweep-mask line (stroke #fff); count
    // only the doc's own neutral-toned placeholder strokes.
    const docGroup = html.slice(html.indexOf('data-element-id="k_doc"'), html.indexOf('data-element-id="k_arrow"'));
    expect(docGroup.match(/<line [^>]*stroke="#4b4b4b"/g)?.length).toBe(5);
  });

  it('arrow gets an arrowhead marker and a mid label', () => {
    expect(html).toContain('marker-end="url(#stage-arrow-good)"');
    expect(html).toContain('>flow</text>');
  });

  it('pen renders a polyline through its points', () => {
    expect(html).toContain('points="100,400 160,380 220,420"');
  });

  it('formula is monospace italic', () => {
    expect(html).toContain('E = mc^2');
    expect(html).toContain('font-style="italic"');
  });

  it('image references its src and shows its label', () => {
    expect(html).toContain('href="heart.png"');
    expect(html).toContain('Figure 1');
  });

  it('model3d renders a labelled placeholder panel', () => {
    expect(html).toContain('Heart in 3D');
  });
});
