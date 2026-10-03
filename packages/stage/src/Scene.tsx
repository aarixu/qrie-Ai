import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  CANVAS_H,
  CANVAS_W,
  EQUATION_MOVE_MS,
  compileFunction,
  mathPlain,
  samplePoints,
  splitPartRef,
  type Element,
  type Lesson,
  type Point,
  type Tone,
} from '@ai-tutor/lesson-format';
import { computeFrame, flowHeight, noteBoxHeight, FLOW_GAP, FLOW_STEP_H, type Rect } from './frame';
import { formulaTex, hasMath, lineToHtml, plainFormula, texToHtml, typesetsAsMaths } from './math';
import { renderTool } from './tools';
import type { ToolTheme } from './tools/context';
import {
  graphicLabelSize,
  textWidth,
  fitText,
  titleSize,
  writeMs,
  wrapLines,
  listItemText,
  listBoxHeight,
  LIST_HEADING_SIZE,
  LIST_ITEM_SIZE,
  LIST_LINE_H,
  LIST_ITEM_GAP,
  LIST_INDENT,
  LIST_HEADING_GAP,
  BESIDE_GAP,
} from '@ai-tutor/lesson-format';

export interface SceneProps {
  lesson: Lesson;
  /** Element ids to render (complete set for the current moment). */
  visible: string[];
  /** Element ids to emphasise; everything else dims (never hides). */
  focus: string[];
  /**
   * Hold the camera on the whole board instead of framing the beat.
   *
   * For the places that show a lesson at thumbnail size, where zooming in on
   * two words would be a worse preview than a small complete board.
   */
  wide?: boolean;
  /**
   * Markup for `diagram` elements, keyed by element id.
   *
   * Passed in rather than fetched because this renderer makes no network calls
   * — the app already loads the lesson, so it loads the artwork beside it.
   * A diagram with no entry here draws its frame and its alt text.
   */
  assets?: Record<string, string>;
  /**
   * Element ids the camera frames, when the beat narrows it. Everything in
   * `visible` still renders — on a long board the earlier pages stay drawn to
   * the side, and panning to the framed page slides them out of view instead
   * of blinking them away.
   */
  frame?: string[];
}

/**
 * Tones map to theme colors HERE — content never carries hex codes, so the
 * whole look of every lesson can be retuned in this one table.
 */
const TONE_COLORS: Record<Tone, string> = {
  neutral: '#4b4b4b',
  good: '#58cc02',
  bad: '#ff4b4b',
  accent: '#1cb0f6',
};

/** The canvas card's background. Used only for text halos so labels stay readable over strokes. */
const PAGE_BG = '#ffffff';
/** Headline/formula ink — darker than the neutral tone so titles anchor the page. */
const INK = '#3c3c3c';

/**
 * The board's face, and it must be one the app actually loads.
 *
 * This used to name Nunito, which index.html has never requested — so every
 * lesson has been drawn in the Segoe UI fallback while the surrounding UI used
 * Quicksand, and the board quietly did not match the room it sits in. Then it
 * named 'Quicksand', which is not what @fontsource-variable/quicksand registers
 * either (canvas audit 2026-10-01): the family is 'Quicksand Variable', as the
 * app's own tailwind.config.js asks for it. Measured in the browser, it draws
 * at 0.48 em a character (0.51 bold), inside the ruler's 0.58.
 */
const FONT_HAND = "'Quicksand Variable', 'Quicksand', 'Baloo 2', 'Segoe UI', system-ui, sans-serif";
const FONT_MONO = "'Cascadia Code', Consolas, Menlo, monospace";
/** A real handwriting face, for the lines the tutor writes out rather than shows. */
// 'Caveat Variable' is the family @fontsource-variable/caveat registers
// (apps/classroom/src/fonts.ts); asking only for 'Caveat' fell through to the
// system's script face on every board, and every writing mask was sized for a
// font the child never saw (seventh review, 2026-09-29).
const FONT_WRITE = "'Caveat Variable', 'Caveat', 'Segoe Script', 'Bradley Hand', cursive";

/** The ink and faces every toolkit tool draws with. */
const THEME: ToolTheme = { ink: INK, tones: TONE_COLORS, fontHand: FONT_HAND, fontMono: FONT_MONO };

/**
 * Kinds that animate their own pieces in sequence, so the element as a whole
 * must not also pop in.
 */
const SELF_ANIMATED: ReadonlySet<Element['kind']> = new Set(['tool']);

/**
 * How long a handwritten line takes to appear.
 *
 * Measured in `@ai-tutor/lesson-format`, beside the width of the same text,
 * because layout needs the identical answer to know when the line BELOW this
 * one may start. Two counts of the same thing meant a long line was still
 * being written when its second line began.
 */
const WRITE_MS = 1600;

const DRAW_MS = 400;
/** How long a circle, a tick or an underline takes to draw. */
const MARK_MS = 620;
/** A bar growing to its value; a term sliding to its new place (lesson-format's EQUATION_MOVE_MS). */
const GROW_MS = 500;
const MOVE_MS = EQUATION_MOVE_MS;

/**
 * FNV-1a. Renders must be byte-identical across frames and test runs, so all
 * "hand-drawn" variation is seeded from element ids — never Math.random.
 */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Tiny deterministic rotation, -0.7deg..0.7deg — enough to feel drawn, not enough to misalign. */
const jitterDeg = (id: string): number => ((hash(id) % 1400) / 1400) * 1.4 - 0.7;

/** 0..1 fraction seeded by id+salt, for per-stroke width variation in docs. */
const frac = (id: string, salt: number): number => (hash(`${id}:${salt}`) % 1000) / 1000;

const toneOf = (el: Element): Tone => ('tone' in el && el.tone ? el.tone : 'neutral');

/** Rotation pivot: each element jitters around its own visual center, not the canvas origin. */
function centerOf(el: Element): Point {
  switch (el.kind) {
    case 'title':
    case 'text':
    case 'formula':
    case 'handwrite':
      return { x: el.x, y: el.y };
    case 'note':
      return { x: el.x + el.w / 2, y: el.y + 30 };
    case 'box':
    case 'doc':
    case 'image':
    case 'diagram':
    case 'chart':
    case 'plot':
    case 'graphic':
    case 'mark':
    case 'model3d':
    case 'tool':
      return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
    case 'flow':
      return { x: el.x + el.w / 2, y: el.y + flowHeight(el.steps.length, el.direction) / 2 };
    case 'list':
      return {
        x: el.x + el.w / 2,
        y: el.y + listBoxHeight(el.items, el.heading, el.w, el.size ?? LIST_ITEM_SIZE) / 2,
      };
    case 'arrow':
      return { x: (el.from.x + el.to.x) / 2, y: (el.from.y + el.to.y) / 2 };
    case 'pen': {
      const xs = el.points.map((p) => p.x);
      const ys = el.points.map((p) => p.y);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
    }
  }
}

/**
 * An aside the tutor wrote on the board — not a UI card.
 *
 * The filled, bordered box this used to be read as a dialog dropped onto the
 * lesson, and over artwork it read as a dialog COVERING the lesson. A rule down
 * the left is how a person marks a passage on a page: it groups the text
 * without enclosing it, so whatever is behind stays visible.
 */
const noteCardStyle = (color: string): CSSProperties => ({
  boxSizing: 'border-box',
  borderLeft: `4px solid ${color}`,
  padding: '2px 0 2px 14px',
  color: '#3c3c3c',
  fontFamily: FONT_HAND,
  fontWeight: 700,
  fontSize: 17,
  lineHeight: 1.55,
});

/** Small halo behind free-floating labels so they read over strokes and fills. */
const HALO = { paintOrder: 'stroke', stroke: PAGE_BG, strokeWidth: 4, strokeLinejoin: 'round' } as const;

const SCENE_CSS = `
@keyframes stage-pop {
  from { opacity: 0; transform: scale(0.9); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes stage-sweep { to { stroke-dashoffset: 0; } }
.stage-pop {
  transform-box: fill-box;
  transform-origin: center;
  animation: stage-pop ${DRAW_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
.stage-sweep {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: stage-sweep ${DRAW_MS}ms ease-out forwards;
}
@keyframes stage-write { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes stage-nib { from { transform: translateX(0); } to { transform: translateX(var(--hw-travel, 0)); } }
.stage-write {
  transform-box: fill-box;
  transform-origin: left center;
  /* Duration and delay come from the element: a line is as long as its words,
     and a wrapped line waits for the one above it. */
  animation: stage-write var(--hw-ms, ${WRITE_MS}ms) linear both var(--hw-after, 0ms);
}
.stage-nib {
  /* The nib travels the line in the same time the ink appears, then lifts. */
  animation:
    stage-nib var(--hw-ms, ${WRITE_MS}ms) linear both var(--hw-after, 0ms),
    stage-nib-out 200ms calc(var(--hw-ms, ${WRITE_MS}ms) + var(--hw-after, 0ms)) forwards;
}
@keyframes stage-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
/* A teacher's loop is DRAWN, not dropped in. pathLength="1" normalises every
   shape to a single unit so one rule paces them all. */
.stage-draw {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: stage-draw ${MARK_MS}ms ease-out forwards;
}
@keyframes stage-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
/* A bar grows from its axis, the way a teacher draws it out. */
.stage-grow {
  transform-box: fill-box;
  transform-origin: left center;
  animation: stage-grow ${GROW_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes stage-move {
  0%   { opacity: 0; transform: translate(var(--dx, 0), var(--dy, 0)); }
  12%  { opacity: 1; }
  100% { opacity: 1; transform: translate(0, 0); }
}
/* A term of working slides from where it was in the line above. Hidden until
   its step: \`both\` holds the first frame, which is transparent. */
.stage-move { animation: stage-move ${MOVE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@keyframes stage-nib-out { to { opacity: 0; } }

/* THE PAINTER'S FOUR MOTIONS.

   A generated drawing may mark a shape with exactly one of these — the gate in
   class-prep rejects every other class — and this is where each one gets its
   meaning. Ink wanders, a current runs along its own line, a heart beats, a
   leaf rocks. Small and slow on purpose: the motion is there to say "this is a
   PROCESS", never to perform.

   fill-box, because an SVG transform otherwise pivots on the page corner and a
   pulsing atom would orbit the title instead of beating in place. */
.curie-drift, .curie-pulse, .curie-sway {
  transform-box: fill-box;
  transform-origin: center;
}
.curie-drift { animation: curie-drift 5.2s ease-in-out infinite alternate; }
@keyframes curie-drift {
  from { transform: translate(0, 0) rotate(0deg); }
  33%  { transform: translate(7px, -6px) rotate(2deg); }
  66%  { transform: translate(-5px, -10px) rotate(-2deg); }
  to   { transform: translate(4px, -14px) rotate(1deg); }
}
/* Flow is a marching dash, so it reads as movement ALONG the stroke — a
   current in its wire, water in its pipe — without needing a motion path. */
.curie-flow {
  stroke-dasharray: 10 14;
  animation: curie-flow 1.4s linear infinite;
}
@keyframes curie-flow { to { stroke-dashoffset: -24; } }
.curie-pulse { animation: curie-pulse 1.6s ease-in-out infinite; }
@keyframes curie-pulse {
  0%, 100% { transform: scale(1); }
  35%      { transform: scale(1.1); }
  50%      { transform: scale(0.98); }
}
.curie-sway { animation: curie-sway 3.4s ease-in-out infinite alternate; }
@keyframes curie-sway {
  from { transform: rotate(-2.5deg); }
  to   { transform: rotate(2.5deg); }
}

@media (prefers-reduced-motion: reduce) {
  .stage-pop, .stage-sweep, .stage-write, .stage-nib, .stage-draw, .stage-grow, .stage-move {
    animation-duration: 0.01ms;
    animation-delay: 0ms;
  }
  /* The painter's motions LOOP, so they stop outright rather than speeding up. */
  .curie-drift, .curie-flow, .curie-pulse, .curie-sway { animation: none; }
}
`;

/** One arrowhead per tone: markers cannot inherit stroke color, so each tone gets its own. */
const ARROW_MARKERS = (Object.keys(TONE_COLORS) as Tone[]).map((tone) => (
  <marker
    key={tone}
    id={`stage-arrow-${tone}`}
    viewBox="0 0 10 10"
    refX={8}
    refY={5}
    markerWidth={7}
    markerHeight={7}
    orient="auto-start-reverse"
  >
    <path d="M0 0 L10 5 L0 10 z" fill={TONE_COLORS[tone]} />
  </marker>
));

function renderTitle(el: Extract<Element, { kind: 'title' }>): ReactElement {
  return (
    <>
      <text x={el.x} y={el.y} textAnchor="middle" fontFamily={FONT_HAND} fontSize={titleSize(el.text)} fontWeight={900} fill={INK}>
        {el.text}
      </text>
      {el.sub && (
        <text x={el.x} y={el.y + 38} textAnchor="middle" fontFamily={FONT_HAND} fontSize={19} fill={TONE_COLORS.neutral} fillOpacity={0.62}>
          {el.sub}
        </text>
      )}
    </>
  );
}

/**
 * The frame a card is drawn in.
 *
 * Same rectangle, said differently. A board where every idea arrives in an
 * identical rounded box reads as generated however good the words are, so the
 * shape is the author's choice and this is where the choices live.
 *
 * Each is built from the card's own rectangle, so whatever the shape, the words
 * inside it land in the same place and the layout engine's guarantees hold.
 */
function cardFrame(
  el: Extract<Element, { kind: 'box' }>,
  color: string,
): ReactElement | null {
  const { x, y, w, h } = el;
  const fill = { fill: color, fillOpacity: 0.12 };
  const line = { stroke: color, strokeWidth: 2, strokeLinejoin: 'round' as const };

  switch (el.as ?? 'box') {
    case 'plain':
      // Nothing at all. The quietest a card gets, and often the right one.
      return null;

    case 'banner':
      // A ribbon: notched inward at both ends, the shape of a heading strip.
      return (
        <path
          d={`M ${x} ${y} H ${x + w} L ${x + w - 22} ${y + h / 2} L ${x + w} ${y + h} H ${x} L ${x + 22} ${y + h / 2} Z`}
          {...fill}
          {...line}
        />
      );

    case 'bubble': {
      // Speech: a rounded rectangle with a tail dropping from the lower left.
      const tail = x + w * 0.22;
      return (
        <path
          d={
            `M ${x + 16} ${y} H ${x + w - 16} A 16 16 0 0 1 ${x + w} ${y + 16} V ${y + h - 30}` +
            ` A 16 16 0 0 1 ${x + w - 16} ${y + h - 14} H ${tail + 26}` +
            ` L ${tail} ${y + h} L ${tail + 8} ${y + h - 14} H ${x + 16}` +
            ` A 16 16 0 0 1 ${x} ${y + h - 30} V ${y + 16} A 16 16 0 0 1 ${x + 16} ${y} Z`
          }
          {...fill}
          {...line}
        />
      );
    }

    case 'cloud': {
      // A thought: overlapping arcs along the top and bottom, so the outline
      // bulges the way a drawn cloud does.
      const r = h * 0.42;
      const puffs = Math.max(3, Math.round(w / (r * 1.5)));
      const step = w / puffs;
      let d = `M ${x} ${y + h - r * 0.4}`;
      for (let i = 0; i < puffs; i += 1) {
        d += ` A ${step * 0.62} ${r} 0 0 1 ${x + step * (i + 1)} ${y + h * 0.34}`;
      }
      for (let i = puffs; i > 0; i -= 1) {
        d += ` A ${step * 0.62} ${r * 0.8} 0 0 1 ${x + step * (i - 1)} ${y + h - r * 0.4}`;
      }
      return <path d={`${d} Z`} {...fill} {...line} />;
    }

    case 'box':
    default:
      return <rect x={x} y={y} width={w} height={h} rx={10} {...fill} {...line} />;
  }
}

function renderBox(el: Extract<Element, { kind: 'box' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const lines = el.label.split('\n');
  const lineHeight = 20;
  const firstY = el.y + el.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <>
      {cardFrame(el, color)}
      {lines.map((line, i) => (
        <text
          key={i}
          x={el.x + el.w / 2}
          y={firstY + i * lineHeight}
          dominantBaseline="middle"
          textAnchor="middle"
          fontFamily={FONT_HAND}
          fontSize={17}
          fontWeight={800}
          letterSpacing={0.6}
          fill={color}
        >
          {line}
        </text>
      ))}
    </>
  );
}

/**
 * A heading over numbered "term — meaning" items.
 *
 * Drawn the way a section of a good notes page is: the heading underlined, the
 * numbers hanging in their own margin so wrapped lines line up under the words
 * rather than under the digit, and the TERM in each item carrying the weight —
 * a student scanning the board for "left ventricle" should find it without
 * reading the sentence around it.
 *
 * In the tutor's printed hand rather than her written one. Her handwriting is
 * for the two or three sentences she wants remembered; four definitions in
 * cursive on a phone screen is a paragraph nobody reads.
 */
function renderList(el: Extract<Element, { kind: 'list' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const size = el.size ?? LIST_ITEM_SIZE;
  const lead = size * LIST_LINE_H;
  const headSize = LIST_HEADING_SIZE * (size / LIST_ITEM_SIZE);
  const out: ReactElement[] = [];
  let y = el.y;

  if (el.heading) {
    const baseline = y + headSize;
    out.push(
      <text key="heading" x={el.x} y={baseline} fontFamily={FONT_HAND} fontSize={headSize} fontWeight={800} letterSpacing={0.4} fill={color}>
        {el.heading}
      </text>,
      <path
        key="rule"
        d={`M ${el.x} ${baseline + 5} L ${el.x + Math.min(el.w, textWidth(el.heading, headSize) + 8)} ${baseline + 5}`}
        stroke={color}
        strokeOpacity={0.45}
        strokeWidth={1.6}
        strokeLinecap="round"
      />,
    );
    y += headSize * LIST_LINE_H + LIST_HEADING_GAP;
  }

  el.items.forEach((item, n) => {
    const prefix = `${n + 1}. `;
    const lines = wrapLines(`${prefix}${listItemText(item)}`, el.w - LIST_INDENT, size);
    lines.forEach((line, k) => {
      const baseline = y + size + k * lead;
      if (k > 0) {
        // Hanging indent: a continued line starts under the words, not the digit.
        out.push(
          <text key={`${n}-${k}`} x={el.x + LIST_INDENT} y={baseline} fontFamily={FONT_HAND} fontSize={size} fill={INK}>
            {line}
          </text>,
        );
        return;
      }
      // The first line carries the number and the term, which are the two
      // things a student's eye is looking for.
      const rest = line.slice(prefix.length);
      const dash = rest.indexOf(' — ');
      const term = dash >= 0 ? rest.slice(0, dash) : rest;
      const after = dash >= 0 ? rest.slice(dash) : '';
      out.push(
        <text key={`${n}-0`} x={el.x} y={baseline} fontFamily={FONT_HAND} fontSize={size} fill={INK}>
          <tspan fill={color} fontWeight={700}>
            {prefix}
          </tspan>
          <tspan fontWeight={700}>{term}</tspan>
          {after && <tspan fillOpacity={0.85}>{after}</tspan>}
        </text>,
      );
    });
    y += lines.length * lead + LIST_ITEM_GAP;
  });

  return <>{out}</>;
}

function renderDoc(el: Extract<Element, { kind: 'doc' }>): ReactElement {
  const color = TONE_COLORS.neutral;
  const n = el.lines ?? 4;
  const top = el.y + 18;
  const bottom = el.y + el.h - 14;
  const step = n > 1 ? (bottom - top) / (n - 1) : 0;
  return (
    <>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={6} fill={color} fillOpacity={0.07} stroke={color} strokeOpacity={0.75} strokeWidth={1.8} />
      {Array.from({ length: n }, (_, i) => {
        // Placeholder text strokes; per-line width variation sells the "written page" look.
        const width = (el.w - 28) * (0.55 + frac(el.id, i) * 0.38);
        const y = top + i * step;
        return <line key={i} x1={el.x + 14} y1={y} x2={el.x + 14 + width} y2={y} stroke={color} strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />;
      })}
      {el.label && (
        <text x={el.x + el.w / 2} y={el.y + el.h + 20} textAnchor="middle" fontFamily={FONT_HAND} fontSize={14.5} fill={color} fillOpacity={0.7}>
          {el.label}
        </text>
      )}
    </>
  );
}

function renderArrow(el: Extract<Element, { kind: 'arrow' }>): ReactElement {
  const tone = toneOf(el);
  const color = TONE_COLORS[tone];
  return (
    <>
      <line
        x1={el.from.x}
        y1={el.from.y}
        x2={el.to.x}
        y2={el.to.y}
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={el.dashed ? '8 7' : undefined}
        markerEnd={`url(#stage-arrow-${tone})`}
      />
      {el.label && (
        <text x={(el.from.x + el.to.x) / 2} y={(el.from.y + el.to.y) / 2 - 9} textAnchor="middle" fontFamily={FONT_HAND} fontSize={14.5} fill={color} {...HALO}>
          {el.label}
        </text>
      )}
    </>
  );
}

/**
 * A generated picture.
 *
 * `src` on the element is where the artwork LIVES once a lesson is saved;
 * `asset` is the artwork itself, handed over at runtime by a class that was
 * prepared just now and has not been written anywhere. A class prepared live
 * has only the second, and rendering the first showed a broken-image icon
 * where the kidney should have been.
 */
function renderImage(el: Extract<Element, { kind: 'image' }>, asset?: string): ReactElement {
  const color = TONE_COLORS.neutral;
  return (
    <>
      {/* No frame. A picture is generated on white so it sits ON the board,
          the way a chart pinned up there does — a border would make it a
          panel dropped onto the lesson instead of part of it. */}
      <image href={asset ?? el.src} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid meet" aria-label={el.alt} />
      {el.label && (
        <text x={el.x + el.w / 2} y={el.y + el.h + 20} textAnchor="middle" fontFamily={FONT_HAND} fontSize={14.5} fill={color} fillOpacity={0.7}>
          {el.label}
        </text>
      )}
    </>
  );
}

/** model3d renders as a labelled placeholder panel; the real 3D viewport mounts over it in the app. */
function renderModel3d(el: Extract<Element, { kind: 'model3d' }>): ReactElement {
  const color = TONE_COLORS.neutral;
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2 - 10;
  const s = Math.min(el.w, el.h) * 0.14;
  const d = s * 0.55;
  return (
    <>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={12} fill="#000000" fillOpacity={0.03} stroke={color} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="7 6" />
      <g stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" opacity={0.85}>
        <rect x={cx - s} y={cy - s + d} width={2 * s} height={2 * s} rx={2} />
        <rect x={cx - s + d} y={cy - s} width={2 * s} height={2 * s} rx={2} opacity={0.45} />
        <line x1={cx - s} y1={cy - s + d} x2={cx - s + d} y2={cy - s} />
        <line x1={cx + s} y1={cy - s + d} x2={cx + s + d} y2={cy - s} />
        <line x1={cx - s} y1={cy + s + d} x2={cx - s + d} y2={cy + s} />
        <line x1={cx + s} y1={cy + s + d} x2={cx + s + d} y2={cy + s} />
      </g>
      <text x={cx} y={el.y + el.h - 16} textAnchor="middle" fontFamily={FONT_HAND} fontSize={15} fill={color} fillOpacity={0.8}>
        {el.label ?? el.asset ?? '3D model'}
      </text>
    </>
  );
}

/** The intrinsic size an SVG declares, so we can fit it into the element's box. */
function readViewBox(svg: string): { w: number; h: number } | null {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (!m) return null;
  const n = m[1].trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) return null;
  return { w: n[2], h: n[3] };
}

/** Everything between the artwork's own <svg> tags. */
function innerMarkup(svg: string): string {
  return svg.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
}

/**
 * A generated diagram, inlined so its named parts can be lit one at a time.
 *
 * `dangerouslySetInnerHTML` is the sink, and it is worth being exact about
 * what protects it, because this comment used to claim protection it did not
 * have. Committed lesson artwork carries the same trust as the `lesson.json`
 * beside it. But a class prepared LIVE routes freshly generated model markup
 * through this very path — with a lesson topic anyone can type — so for that
 * traffic the gate in `@ai-tutor/class-prep`'s `unsafeMarkup` is the whole
 * defence, not a second line of one. Anything reaching here must have passed
 * it. Rejected, never sanitised; see that file for why.
 *
 * Dimming is done in CSS rather than by rewriting the markup, because the
 * artwork must stay byte-identical to what was authored and reviewed — and a
 * CSS transition gives the light a moment to move, the way a real pointer does.
 */
function renderDiagram(
  el: Extract<Element, { kind: 'diagram' }>,
  svg: string | undefined,
  litParts: readonly string[],
): ReactElement {
  const color = TONE_COLORS.neutral;
  if (svg === undefined) {
    // The app has not handed the markup in yet. Draw the frame so the board
    // keeps its layout instead of collapsing, and say what is missing.
    return (
      <>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={12} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="7 6" />
        <text x={el.x + el.w / 2} y={el.y + el.h / 2} textAnchor="middle" fontFamily={FONT_HAND} fontSize={15} fill={color} fillOpacity={0.7}>
          {el.alt}
        </text>
      </>
    );
  }

  const view = readViewBox(svg) ?? { w: CANVAS_W, h: CANVAS_H };
  const scale = Math.min(el.w / view.w, el.h / view.h);
  const dx = el.x + (el.w - view.w * scale) / 2;
  const dy = el.y + (el.h - view.h * scale) / 2;
  const cls = `dg-${el.id}`;

  // Scoped by the wrapper class so one diagram's spotlight never reaches
  // another's parts, even though SVG group ids are document-global.
  const spotlight =
    litParts.length === 0
      ? null
      : [
          `.${cls} > g { opacity: 0.34; transition: opacity 320ms ease; }`,
          ...litParts.map((part) => `.${cls} > g[id="${part}"] { opacity: 1; }`),
        ].join(' ');

  return (
    <g transform={`translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})`}>
      {spotlight && <style>{spotlight}</style>}
      <g className={cls} dangerouslySetInnerHTML={{ __html: innerMarkup(svg) }} />
    </g>
  );
}

/**
 * A bar chart drawn from numbers.
 *
 * Bars are horizontal because the labels are words ("heart muscle", "skin") and
 * vertical bars would force them sideways or into abbreviations. Values are
 * printed at the end of each bar, so a student reads the number without
 * measuring against an axis.
 */
function renderChart(el: Extract<Element, { kind: 'chart' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const rows = el.data;
  const max = Math.max(1, ...rows.map((d) => d.value));
  const labelW = el.w * 0.3;
  const trackX = el.x + labelW + 12;
  const trackW = el.w - labelW - 70;
  const capH = el.caption ? 34 : 0;
  const rowH = Math.min(46, (el.h - capH) / Math.max(1, rows.length));
  const barH = rowH * 0.56;

  return (
    <>
      {el.caption && (
        <text x={el.x} y={el.y + 20} fontFamily={FONT_HAND} fontSize={19} fontWeight={800} fill={INK}>
          {el.caption}
        </text>
      )}
      {rows.map((d, i) => {
        const cy = el.y + capH + i * rowH + rowH / 2;
        const w = Math.max(2, (d.value / max) * trackW);
        return (
          <g key={d.label}>
            <text x={el.x + labelW} y={cy} textAnchor="end" dominantBaseline="middle" fontFamily={FONT_HAND} fontSize={15} fontWeight={700} fill={TONE_COLORS.neutral}>
              {d.label}
            </text>
            <rect x={trackX} y={cy - barH / 2} width={trackW} height={barH} rx={barH / 2} fill={color} fillOpacity={0.1} />
            <rect x={trackX} y={cy - barH / 2} width={w} height={barH} rx={barH / 2} fill={color} fillOpacity={0.85} />
            <text x={trackX + w + 10} y={cy} dominantBaseline="middle" fontFamily={FONT_HAND} fontSize={15} fontWeight={800} fill={color}>
              {d.value.toLocaleString('en-IN')}
            </text>
          </g>
        );
      })}
      {el.unit && (
        <text x={trackX} y={el.y + capH + rows.length * rowH + 18} fontFamily={FONT_HAND} fontSize={13} fill={TONE_COLORS.neutral} fillOpacity={0.7}>
          {el.unit}
        </text>
      )}
    </>
  );
}

/** A number as a board writes it on an axis: no more than three figures. */
const axisNumber = (v: number): string => {
  if (v === 0) return '0';
  const r = Number(v.toPrecision(3));
  return Math.abs(r) >= 1000 ? r.toLocaleString('en-IN') : String(r);
};

/**
 * A line graph COMPUTED from its formula (canvas C3).
 *
 * The points are `fn` sampled over [from, to], so the curve is the one the
 * formula makes. The y range is the computed values', with 0 pulled in when it
 * is near, so an axis a student expects is there; a value that is not a number
 * (a root of a negative, a division by zero) is a gap in the line, not a spike.
 * Where the values run away (1/x near 0), the range is the middle of them and
 * the line is clipped to the box.
 */
function renderPlot(el: Extract<Element, { kind: 'plot' }>): ReactElement | null {
  const fn = compileFunction(el.fn);
  if (!fn) return null;
  const color = TONE_COLORS[toneOf(el)];
  const capH = el.caption ? 32 : 0;
  const padL = el.yLabel ? 50 : 36;
  const padB = el.xLabel ? 44 : 28;
  const box = { x: el.x + padL, y: el.y + capH + 10, w: el.w - padL - 14, h: el.h - capH - 10 - padB };
  if (box.w <= 20 || box.h <= 20) return null;

  const points = samplePoints(fn, el.from, el.to, 161);
  if (points.length < 2) return null;
  const ys = points.map((p) => p.y).sort((a, b) => a - b);
  const at = (q: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(q * (ys.length - 1))))];
  let lo = ys[0];
  let hi = ys[ys.length - 1];
  if (hi - lo > 10 * Math.max(1e-9, at(0.9) - at(0.1))) {
    lo = at(0.05);
    hi = at(0.95);
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
  if (hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
  const pad = (hi - lo) * 0.06;
  lo -= pad;
  hi += pad;

  const sx = (x: number) => box.x + ((x - el.from) / (el.to - el.from)) * box.w;
  const sy = (y: number) => box.y + box.h - ((y - lo) / (hi - lo)) * box.h;
  const step = (el.to - el.from) / 160;
  let d = '';
  points.forEach((p, k) => {
    const gap = k === 0 || p.x - points[k - 1].x > step * 1.5;
    d += `${gap ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)} `;
  });

  const axisY = lo <= 0 && hi >= 0 ? sy(0) : box.y + box.h;
  const axisX = el.from <= 0 && el.to >= 0 ? sx(0) : box.x;
  const clipId = `plot-clip-${el.id}`;
  const label = { fontFamily: FONT_HAND, fontSize: 15, fontWeight: 700, fill: TONE_COLORS.neutral } as const;

  return (
    <>
      {el.caption && (
        <text x={el.x + el.w / 2} y={el.y + 22} textAnchor="middle" fontFamily={FONT_HAND} fontSize={20} fontWeight={800} fill={INK}>
          {el.caption}
        </text>
      )}
      <clipPath id={clipId}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} />
      </clipPath>
      <line x1={box.x} y1={axisY} x2={box.x + box.w} y2={axisY} stroke={INK} strokeWidth={1.6} />
      <line x1={axisX} y1={box.y} x2={axisX} y2={box.y + box.h} stroke={INK} strokeWidth={1.6} />
      <text x={box.x} y={box.y + box.h + 18} textAnchor="start" {...label}>
        {axisNumber(el.from)}
      </text>
      <text x={box.x + box.w} y={box.y + box.h + 18} textAnchor="end" {...label}>
        {axisNumber(el.to)}
      </text>
      <text x={box.x - 6} y={box.y + 10} textAnchor="end" {...label}>
        {axisNumber(hi - pad)}
      </text>
      <text x={box.x - 6} y={box.y + box.h} textAnchor="end" {...label}>
        {axisNumber(lo + pad)}
      </text>
      {el.xLabel && (
        <text x={box.x + box.w / 2} y={box.y + box.h + 38} textAnchor="middle" {...label} fontSize={16}>
          {el.xLabel}
        </text>
      )}
      {el.yLabel && (
        <text
          x={el.x + 14}
          y={box.y + box.h / 2}
          textAnchor="middle"
          {...label}
          fontSize={16}
          transform={`rotate(-90 ${el.x + 14} ${box.y + box.h / 2})`}
        >
          {el.yLabel}
        </text>
      )}
      <path
        d={d.trim()}
        clipPath={`url(#${clipId})`}
        fill="none"
        stroke={color}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stage-draw"
        pathLength={1}
      />
    </>
  );
}

/**
 * A workflow: boxes with arrows between them, laid out from the step count.
 *
 * The author writes the steps; every coordinate here is computed. That split is
 * the point — asking a model to place seven boxes and six arrows on a 1000-unit
 * board is asking it to do arithmetic it is bad at, and one wrong number puts a
 * box on top of an arrow.
 */
/**
 * Steps with arrows between them.
 *
 * Every line is fitted and wrapped to the step it belongs to. It used to be
 * drawn at a fixed size and centred, which is fine on a wide board and ruinous
 * anywhere else: sharing a beat with a list, this flow was handed a narrow
 * column where five steps left forty-two units each, and labels needing a
 * hundred and thirty overhung both sides and landed on the steps next door.
 * Five notes became one unreadable stripe.
 *
 * A step is as wide as it is; the writing is what gives way.
 */
function renderFlow(el: Extract<Element, { kind: 'flow' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const n = el.steps.length;
  const row = (el.direction ?? 'row') === 'row';
  const stepW = row ? (el.w - (n - 1) * FLOW_GAP) / Math.max(1, n) : el.w;
  /** Kept clear of the rounded corners on both sides. */
  const inner = Math.max(12, stepW - 14);

  return (
    <>
      {el.steps.map((step, i) => {
        const x = row ? el.x + i * (stepW + FLOW_GAP) : el.x;
        const y = row ? el.y : el.y + i * (FLOW_STEP_H + FLOW_GAP);
        const cx = x + stepW / 2;
        const cy = y + FLOW_STEP_H / 2;
        const last = i === n - 1;

        // Sized by the LONGEST WORD, because that is the one thing wrapping
        // cannot help with: "refraction" has to fit the step or it hangs out
        // of it however the rest of the sentence is broken up.
        const widest = (text: string) =>
          text.split(/\s+/).reduce((a, b) => (a.length >= b.length ? a : b), '');
        const labelSize = fitText(widest(step.label), inner, 16, 11);
        const labelLines = wrapLines(step.label, inner, labelSize);
        const noteSize = step.note ? fitText(widest(step.note), inner, 12.5, 10) : 0;
        const noteLines = step.note ? wrapLines(step.note, inner, noteSize) : [];

        const labelLead = labelSize * 1.2;
        const noteLead = noteSize * 1.25;
        const total = labelLines.length * labelLead + noteLines.length * noteLead;
        let ty = cy - total / 2 + labelLead * 0.75;

        const drawn: ReactElement[] = [];
        labelLines.forEach((line, k) => {
          drawn.push(
            <text key={`l${k}`} x={cx} y={ty} textAnchor="middle" fontFamily={FONT_HAND} fontSize={labelSize} fontWeight={800} fill={color}>
              {line}
            </text>,
          );
          ty += labelLead;
        });
        ty += noteLines.length > 0 ? noteLead * 0.15 : 0;
        noteLines.forEach((line, k) => {
          drawn.push(
            <text key={`n${k}`} x={cx} y={ty} textAnchor="middle" fontFamily={FONT_HAND} fontSize={noteSize} fill={color} fillOpacity={0.75}>
              {line}
            </text>,
          );
          ty += noteLead;
        });

        return (
          <g key={i}>
            <rect x={x} y={y} width={stepW} height={FLOW_STEP_H} rx={14} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2} />
            {drawn}
            {!last && (
              <line
                x1={row ? x + stepW + 8 : cx}
                y1={row ? cy : y + FLOW_STEP_H + 8}
                x2={row ? x + stepW + FLOW_GAP - 8 : cx}
                y2={row ? cy : y + FLOW_STEP_H + FLOW_GAP - 8}
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                markerEnd={`url(#stage-arrow-${toneOf(el)})`}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

/**
 * A line written out by hand, left to right, with the nib leading.
 *
 * The reveal is a mask that widens rather than a per-glyph stroke animation:
 * real stroke data would need a single-line font and glyph outlines, and what
 * sells "someone is writing this" is the nib moving and the ink arriving behind
 * it — which this gives for a fraction of the machinery.
 */
function renderHandwrite(el: Extract<Element, { kind: 'handwrite' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const size = el.size ?? 26;
  // The same ruler the layout and the camera use. A local guess of half an em
  // per character ran short of the real thing, and the mask — which hides
  // everything past its own right edge — clipped the last word off the line.
  // A little over, because a mask that is too wide costs nothing and a mask
  // that is too narrow eats words.
  // Generously over: the shared ruler is tuned for a sans face and the
  // tutor's hand is wider, and a mask that is too wide costs nothing while a
  // mask that is too narrow eats the last word off the line.
  const math = hasMath(el.text);
  // Typeset maths runs wider and taller than the plain characters the ruler
  // counts: KaTeX spaces operators and stacks fractions. So a maths line gets
  // a wider box, and a taller one when it has a fraction, root or power —
  // the writing mask clipped "…= 5x + 20" and hid a fraction's denominator
  // (seventh review, 2026-09-29).
  const width = textWidth(el.text, size) * (math ? 1.9 : 1.3);
  const tall = math && /\\[dt]?frac|\\sqrt|\^|_/.test(el.text);
  const top = el.y - size * (tall ? 1.6 : 1);
  const height = size * (tall ? 2.8 : 1.8);
  const left = el.x - width / 2;
  const maskId = `hw-${el.id}`;
  // One object, shared by the ink and the nib, so they can never drift apart.
  // Paced by what it reads as, not by the length of its LaTeX source.
  const pace = {
    ['--hw-ms' as string]: `${writeMs(math ? mathPlain(el.text) : el.text)}ms`,
    ['--hw-after' as string]: `${el.after ?? 0}ms`,
  };

  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse" x={left - 10} y={top} width={width + 20} height={height}>
        <rect
          className="stage-write"
          x={left - 10}
          y={top}
          width={width + 20}
          height={height}
          fill="#fff"
          style={pace}
        />
      </mask>
      {math ? (
        // Words in her hand, maths typeset (T6): HTML inside the board, under
        // the same writing mask, so it still appears as she writes.
        <foreignObject x={left - 10} y={top} width={width + 20} height={height} mask={`url(#${maskId})`} overflow="visible">
          <div
            className="stage-math"
            style={{
              fontFamily: FONT_WRITE,
              fontSize: size,
              fontWeight: 600,
              color,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              lineHeight: `${height}px`,
            }}
            dangerouslySetInnerHTML={{ __html: lineToHtml(el.text) }}
          />
        </foreignObject>
      ) : (
        <text
          x={el.x}
          y={el.y}
          textAnchor="middle"
          fontFamily={FONT_WRITE}
          fontSize={size}
          fontWeight={600}
          fill={color}
          mask={`url(#${maskId})`}
        >
          {el.text}
        </text>
      )}
      {/* The nib: it travels the same distance in the same time as the mask. */}
      <circle
        className="stage-nib"
        cx={left}
        cy={el.y - size * 0.28}
        r={size * 0.11}
        fill={color}
        style={{ ...pace, ['--hw-travel' as string]: `${width}px` }}
      />
    </>
  );
}

/**
 * One noun, drawn from the icon library.
 *
 * The glyph arrives with its own viewBox, so it is scaled into the element's
 * box and centred. Inlined rather than dropped in an <img> for the same reason
 * a diagram is: it has to take the board's colour, and it has to be able to be
 * dimmed and lit with everything else.
 */
function renderGraphic(
  el: Extract<Element, { kind: 'graphic' }>,
  svg: string | undefined,
): ReactElement {
  const color = TONE_COLORS.neutral;
  const beside = el.labelSide === 'beside';
  const labelSize = el.label ? graphicLabelSize(el.w, el.label, beside ? 'beside' : 'below') : 26;
  const labelY = beside ? el.y + el.h / 2 : el.y + el.h + 26;

  if (svg === undefined) {
    return (
      <>
        <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={10} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={2} strokeDasharray="6 6" />
        <text x={el.x + el.w / 2} y={el.y + el.h / 2} textAnchor="middle" dominantBaseline="middle" fontFamily={FONT_WRITE} fontSize={18} fill={color}>
          {el.noun}
        </text>
      </>
    );
  }

  const view = readViewBox(svg) ?? { w: 100, h: 100 };
  const scale = Math.min(el.w / view.w, el.h / view.h);
  const dx = el.x + (el.w - view.w * scale) / 2;
  const dy = el.y + (el.h - view.h * scale) / 2;

  return (
    <>
      <g
        transform={`translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale.toFixed(4)})`}
        dangerouslySetInnerHTML={{ __html: innerMarkup(svg) }}
      />
      {el.label && (
        <text
          x={beside ? el.x + el.w + BESIDE_GAP : el.x + el.w / 2}
          y={labelY}
          textAnchor={beside ? 'start' : 'middle'}
          dominantBaseline={beside ? 'middle' : undefined}
          fontFamily={FONT_WRITE}
          // The same size the camera and the layout believe it is — see
          // graphicLabelSize for why three guesses were one too many.
          fontSize={labelSize}
          fill={color}
          {...HALO}
        >
          {el.label}
        </text>
      )}
    </>
  );
}

/**
 * A mark the tutor makes on top of something already drawn.
 *
 * Drawn with the same sweep the pen strokes use, so it arrives the way a real
 * one does — a line travelling, not a shape appearing.
 */
function renderMark(el: Extract<Element, { kind: 'mark' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const common = {
    fill: 'none',
    stroke: color,
    strokeWidth: 4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    // Drawn rather than dropped in: the stroke arrives along its own path.
    className: 'stage-draw',
    pathLength: 1,
  };

  switch (el.shape) {
    case 'circle':
      // An ellipse rather than a rect: nobody boxes a thing on a board, they
      // loop around it, and the loop overshoots slightly where it closes.
      return (
        <path
          d={`M ${cx + el.w / 2} ${cy} A ${el.w / 2} ${el.h / 2} 0 1 1 ${cx} ${cy - el.h / 2} A ${el.w / 2} ${el.h / 2} 0 0 1 ${cx + el.w / 2 + 6} ${cy + 8}`}
          {...common}
        />
      );
    case 'underline':
      return (
        <path
          d={`M ${el.x} ${el.y + el.h} Q ${cx} ${el.y + el.h + 9} ${el.x + el.w} ${el.y + el.h - 2}`}
          {...common}
        />
      );
    case 'tick':
      return <path d={`M ${el.x} ${cy} L ${cx - el.w * 0.1} ${el.y + el.h} L ${el.x + el.w} ${el.y}`} {...common} />;
    case 'cross':
      return (
        <>
          <path d={`M ${el.x} ${el.y} L ${el.x + el.w} ${el.y + el.h}`} {...common} />
          <path d={`M ${el.x + el.w} ${el.y} L ${el.x} ${el.y + el.h}`} {...common} />
        </>
      );
    case 'box':
      // A frame round a line she wrote, drawn in one stroke the way a hand
      // boxes a definition: corners not quite square, the end running past
      // where it began.
      return (
        <path
          d={`M ${el.x + 6} ${el.y} L ${el.x + el.w} ${el.y + 2} L ${el.x + el.w - 2} ${el.y + el.h} L ${el.x} ${el.y + el.h - 2} L ${el.x + 2} ${el.y - 4} L ${el.x + 16} ${el.y - 1}`}
          {...common}
          strokeWidth={3}
        />
      );
    case 'highlight':
      // A marker pulled across the words: one broad, see-through stroke over
      // them, multiplied so the ink underneath stays black.
      return (
        <path
          d={`M ${el.x} ${cy} L ${el.x + el.w} ${cy}`}
          {...common}
          strokeWidth={el.h * 0.8}
          strokeLinecap="butt"
          strokeOpacity={0.32}
          style={{ mixBlendMode: 'multiply' }}
        />
      );
  }
}

function renderElement(el: Element, svg?: string, litParts: readonly string[] = [], isNew = false): ReactElement {
  switch (el.kind) {
    case 'title':
      return renderTitle(el);
    case 'text':
      return (
        <text x={el.x} y={el.y} textAnchor="middle" fontFamily={FONT_HAND} fontSize={el.size ?? 20} fill={TONE_COLORS.neutral} fillOpacity={el.muted ? 0.6 : 1}>
          {el.text}
        </text>
      );
    case 'note': {
      const color = TONE_COLORS[toneOf(el)];
      return (
        <foreignObject x={el.x} y={el.y} width={el.w} height={noteBoxHeight(el.text, el.w)} style={{ overflow: 'visible' }}>
          <div {...{ xmlns: 'http://www.w3.org/1999/xhtml' }} style={noteCardStyle(color)}>
            {el.text}
          </div>
        </foreignObject>
      );
    }
    case 'box':
      return renderBox(el);
    case 'list':
      return renderList(el);
    case 'doc':
      return renderDoc(el);
    case 'arrow':
      return renderArrow(el);
    case 'pen':
      return (
        <polyline
          points={el.points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={TONE_COLORS[toneOf(el)]}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'formula': {
      /**
       * An equation, typeset (T6). A formula is maths through and through, so
       * its whole text is read as LaTeX — "v = s / t" and "2x + 3 = 11" come out
       * as a maths book prints them — and one KaTeX cannot read keeps the old
       * monospace line.
       */
      const tex = formulaTex(el.text);
      const html = typesetsAsMaths(el.text) ? texToHtml(tex) : null;
      if (html !== null) {
        const w = Math.max(80, textWidth(`$${tex}$`, 26) * 1.4);
        return (
          <foreignObject x={el.x - w / 2} y={el.y - 30} width={w} height={48} overflow="visible">
            <div className="stage-math" style={{ fontSize: 26, color: INK, textAlign: 'center', whiteSpace: 'nowrap', lineHeight: '48px' }} dangerouslySetInnerHTML={{ __html: html }} />
          </foreignObject>
        );
      }
      return (
        <text x={el.x} y={el.y} textAnchor="middle" fontFamily={FONT_MONO} fontStyle="italic" fontSize={24} letterSpacing={0.5} fill={INK}>
          {plainFormula(el.text)}
        </text>
      );
    }
    case 'image':
      return renderImage(el, svg);
    case 'diagram':
      return renderDiagram(el, svg, litParts);
    case 'graphic':
      return renderGraphic(el, svg);
    case 'mark':
      return renderMark(el);
    case 'chart':
      return renderChart(el);
    case 'plot':
      return renderPlot(el) ?? <></>;
    case 'flow':
      return renderFlow(el);
    case 'handwrite':
      return renderHandwrite(el);
    case 'model3d':
      return renderModel3d(el);
    case 'tool':
      return renderTool(el, { isNew, theme: THEME });
  }
}

type StrokeElement = Extract<Element, { kind: 'arrow' | 'pen' }>;

/**
 * The draw-on reveal for strokes is a mask, not a dasharray on the stroke
 * itself: the visible line keeps its own dash pattern (a dashed arrow stays
 * dashed while appearing) and the sweep also reveals the arrowhead and label as
 * it passes them. pathLength=1 normalises the sweep so no geometry is measured.
 */
function sweepStroke(el: StrokeElement): ReactElement {
  const common = {
    className: 'stage-sweep',
    pathLength: 1,
    stroke: '#fff',
    strokeWidth: el.kind === 'arrow' ? 44 : 12,
    strokeLinecap: 'round',
    fill: 'none',
  } as const;
  return el.kind === 'arrow' ? (
    <line x1={el.from.x} y1={el.from.y} x2={el.to.x} y2={el.to.y} {...common} />
  ) : (
    <polyline points={el.points.map((p) => `${p.x},${p.y}`).join(' ')} {...common} />
  );
}

interface SceneElementProps {
  el: Element;
  /** Newly in `visible` since the previous render → draw-in animation. */
  isNew: boolean;
  dimmed: boolean;
  focused: boolean;
  /** Artwork for a `diagram` element, if the app handed any in. */
  svg?: string;
  /** Parts inside a `diagram` that are lit right now; everything else dims. */
  litParts?: readonly string[];
  /**
   * The whole plane, which on a long lesson is many pages wide.
   *
   * A sweep-in mask hides everything outside its own region, so a mask fixed
   * at one page's size erased any stroke drawn on page two the moment it
   * appeared — the exact vanishing the endless board exists to prevent.
   */
  canvas: { w: number; h: number };
}

function SceneElement({
  el,
  isNew,
  dimmed,
  focused,
  svg,
  litParts,
  canvas,
}: SceneElementProps): ReactElement {
  const c = centerOf(el);
  const transform = `rotate(${jitterDeg(el.id).toFixed(2)} ${c.x} ${c.y})`;
  const isStroke = el.kind === 'arrow' || el.kind === 'pen';
  const sweeping = isNew && isStroke;
  // Handwriting is excluded: a glow behind an outline reads as emphasis, but a
  // glow behind a written line reads as a highlighter pen someone left on.
  const glow =
    focused && el.kind !== 'handwrite'
      ? { filter: `drop-shadow(0 0 7px ${TONE_COLORS[toneOf(el)]}b3)` }
      : undefined;

  return (
    <>
      {sweeping && (
        <mask
          id={`stage-sweep-${el.id}`}
          maskUnits="userSpaceOnUse"
          x={0}
          y={0}
          width={canvas.w}
          height={canvas.h}
        >
          {/* Same jitter transform as the element, so the mask tracks it exactly. */}
          <g transform={transform}>{sweepStroke(el as StrokeElement)}</g>
        </mask>
      )}
      <g
        data-element-id={el.id}
        transform={transform}
        opacity={dimmed ? 0.4 : undefined}
        mask={sweeping ? `url(#stage-sweep-${el.id})` : undefined}
        style={glow}
      >
        <g
          className={isNew && !isStroke && !SELF_ANIMATED.has(el.kind) ? 'stage-pop' : undefined}
          // A line of working arrives after the one above it; the pop's
          // `both` fill keeps it hidden until then.
          style={isNew && el.kind === 'formula' && el.after ? { animationDelay: `${el.after}ms` } : undefined}
        >
          {renderElement(el, svg, litParts, isNew)}
        </g>
      </g>
    </>
  );
}

/** How long the camera takes to travel between two beats' frames. */
const PAN_MS = 620;

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const lerpRect = (a: Rect, b: Rect, t: number): Rect => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  w: a.w + (b.w - a.w) * t,
  h: a.h + (b.h - a.h) * t,
});

const sameRect = (a: Rect, b: Rect): boolean =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.w - b.w) < 0.5 &&
  Math.abs(a.h - b.h) < 0.5;

/**
 * The camera. Eases the viewBox from wherever it is to wherever the beat wants
 * it, so a change of subject reads as the board being panned rather than as a
 * cut to a different picture.
 *
 * viewBox is an attribute, not a style, so there is no CSS transition to lean
 * on — this is the rAF loop that would otherwise not exist. It settles exactly
 * on the target and then stops; there is no idle animation running behind a
 * still class.
 */
function useCamera(target: Rect, measured: boolean): Rect {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  shownRef.current = shown;

  // The opening frame lands instantly: a class opening with a 620ms zoom from
  // nowhere is a transition the student did not ask for.
  //
  // The guard is "we have not yet shown a MEASURED frame", not "the component
  // has mounted". The screen is measured just after mount, so a mount-only
  // guard was spent on a frame computed before anyone knew the screen's shape,
  // and the first real frame — the one the student actually sees — arrived on
  // a 620ms pan every single time.
  const opened = useRef(false);

  useEffect(() => {
    if (!opened.current) {
      opened.current = measured;
      setShown(target);
      return;
    }
    if (sameRect(shownRef.current, target)) return;

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(target);
      return;
    }

    const from = shownRef.current;
    const startedAt = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - startedAt) / PAN_MS);
      setShown(t >= 1 ? target : lerpRect(from, target, easeInOut(t)));
      if (t < 1) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y, target.w, target.h, measured]);

  return shown;
}

/**
 * One canvas unit never renders wider than this many CSS pixels. The zoom that
 * makes a note readable on a phone would set banner text on a desktop — past
 * this density the camera simply stops coming closer.
 */
const MAX_UNIT_PX = 1.6;

/** The rendered size of the SVG, so the frame can be shaped to the screen. */
function useMeasure(
  ref: React.RefObject<SVGSVGElement | null>,
): { aspect?: number; width?: number; measured: boolean } {
  const [size, setSize] = useState<{ aspect?: number; width?: number }>({});
  // Whether a real measurement has arrived. Where there is nothing to measure
  // with, the content's own shape IS the answer and it is available at once.
  const measured = size.aspect !== undefined || typeof ResizeObserver === 'undefined';
  useEffect(() => {
    const el = ref.current;
    // jsdom has no ResizeObserver and no layout; tests fall through to the
    // content's own shape, which is deterministic and is what they assert on.
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ aspect: width / height, width });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return { ...size, measured };
}

/**
 * The SVG renderer. Renders; decides nothing — what is visible/focused was
 * decided upstream and arrives as props, and where the camera points is
 * computed by `computeFrame`. All element animation is CSS inside the SVG.
 */
export function Scene({ lesson, visible, focus, wide = false, assets, frame }: SceneProps): ReactElement {
  // The visible set of the PREVIOUS BEAT, so the render pass can tell which
  // elements just appeared and animate only those. On the first beat
  // (prev === null) everything draws in — the canvas is coming from blank.
  //
  // It lags by a beat, not by a render. Committed after every paint, it was
  // overwritten about sixteen milliseconds in by the camera pan's own
  // re-renders, which flipped every element back to "not new" and cancelled
  // the draw-in halfway through.
  const keyRef = useRef<string | null>(null);
  const prevRef = useRef<ReadonlySet<string> | null>(null);
  const currentRef = useRef<ReadonlySet<string> | null>(null);
  const visibleKey = visible.join(String.fromCharCode(0));
  if (keyRef.current !== visibleKey) {
    keyRef.current = visibleKey;
    prevRef.current = currentRef.current;
    currentRef.current = new Set(visible);
  }
  const prev = prevRef.current;

  const visibleSet = new Set(visible);

  // A focus id may name a part inside a diagram ("d_mito#cristae"). The element
  // it belongs to is what stays bright on the board; the part is what stays
  // bright inside the drawing. Splitting here keeps both meanings straight.
  const focusSet = new Set<string>();
  const partsByElement = new Map<string, string[]>();
  for (const ref of focus) {
    const { elementId, part } = splitPartRef(ref);
    focusSet.add(elementId);
    if (part !== null) {
      const list = partsByElement.get(elementId);
      if (list) list.push(part);
      else partsByElement.set(elementId, [part]);
    }
  }
  const dimming = focusSet.size > 0;

  const svgRef = useRef<SVGSVGElement>(null);
  const { aspect, width, measured } = useMeasure(svgRef);
  const target = wide
    ? { x: 0, y: 0, w: lesson.canvas.w, h: lesson.canvas.h }
    : computeFrame(lesson, frame ?? visible, focus, aspect, width ? width / MAX_UNIT_PX : undefined);
  const box = useCamera(target, measured);

  return (
    <svg
      ref={svgRef}
      viewBox={`${box.x.toFixed(1)} ${box.y.toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`}
      role="img"
      aria-label={lesson.title}
      // width AND height 100%: the SVG letterboxes inside whatever box the app
      // gives it (preserveAspectRatio meet), so it can never push siblings off
      // the screen even when a frame's aspect misses the box's.
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <style>{SCENE_CSS}</style>
      <defs>{ARROW_MARKERS}</defs>
      {/* Unknown ids in `visible` simply match nothing — ignored silently by design. */}
      {lesson.elements
        .filter((el) => visibleSet.has(el.id))
        .map((el) => (
          <SceneElement
            key={el.id}
            el={el}
            isNew={prev === null || !prev.has(el.id)}
            dimmed={dimming && !focusSet.has(el.id)}
            focused={dimming && focusSet.has(el.id)}
            svg={assets?.[el.id]}
            litParts={partsByElement.get(el.id)}
            canvas={lesson.canvas}
          />
        ))}
    </svg>
  );
}
