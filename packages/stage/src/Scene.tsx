import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { CANVAS_H, CANVAS_W, type Element, type Lesson, type Point, type Tone } from '@ai-tutor/lesson-format';

export interface SceneProps {
  lesson: Lesson;
  /** Element ids to render (complete set for the current moment). */
  visible: string[];
  /** Element ids to emphasise; everything else dims (never hides). */
  focus: string[];
}

/**
 * Tones map to theme colors HERE — content never carries hex codes, so the
 * whole look of every lesson can be retuned in this one table.
 */
const TONE_COLORS: Record<Tone, string> = {
  neutral: '#cfd4dc',
  good: '#7ed491',
  bad: '#ff8a8a',
  accent: '#ffb347',
};

/** The app's page background. Used only for text halos so labels stay readable over strokes. */
const PAGE_BG = '#0f1116';
/** Headline/formula ink — brighter than the neutral tone so titles pop on the dark page. */
const INK = '#e9ecf3';

const FONT_HAND = "'Segoe Print', 'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif";
const FONT_MONO = "'Cascadia Code', Consolas, Menlo, monospace";

const DRAW_MS = 400;

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
      return { x: el.x, y: el.y };
    case 'note':
      return { x: el.x + el.w / 2, y: el.y + 30 };
    case 'box':
    case 'doc':
    case 'image':
    case 'model3d':
      return { x: el.x + el.w / 2, y: el.y + el.h / 2 };
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
 * Server/first-paint rendering cannot measure text, so the note's foreignObject
 * gets an overestimated height (plus overflow:visible) and the card inside it
 * hugs its real wrapped content — wrap can never clip.
 */
function noteBoxHeight(text: string, w: number): number {
  const charsPerLine = Math.max(6, Math.floor((w - 26) / 7));
  return Math.ceil(text.length / charsPerLine) * 21 + 60;
}

const noteCardStyle = (color: string): CSSProperties => ({
  boxSizing: 'border-box',
  background: `${color}17`,
  border: `1.5px solid ${color}59`,
  borderRadius: 10,
  padding: '9px 12px',
  color: '#dde1ea',
  fontFamily: FONT_HAND,
  fontSize: 14.5,
  lineHeight: 1.45,
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
      <text x={el.x} y={el.y} textAnchor="middle" fontFamily={FONT_HAND} fontSize={44} fontWeight={700} fill={INK}>
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

function renderBox(el: Extract<Element, { kind: 'box' }>): ReactElement {
  const color = TONE_COLORS[toneOf(el)];
  const lines = el.label.split('\n');
  const lineHeight = 20;
  const firstY = el.y + el.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <>
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={10} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2} />
      {lines.map((line, i) => (
        <text
          key={i}
          x={el.x + el.w / 2}
          y={firstY + i * lineHeight}
          dominantBaseline="middle"
          textAnchor="middle"
          fontFamily={FONT_HAND}
          fontSize={17}
          fontWeight={600}
          letterSpacing={0.6}
          fill={color}
        >
          {line}
        </text>
      ))}
    </>
  );
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

function renderImage(el: Extract<Element, { kind: 'image' }>): ReactElement {
  const color = TONE_COLORS.neutral;
  return (
    <>
      <image href={el.src} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid meet" aria-label={el.alt} />
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={4} fill="none" stroke={color} strokeOpacity={0.3} strokeWidth={1.5} />
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
      <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={12} fill="#ffffff" fillOpacity={0.04} stroke={color} strokeOpacity={0.55} strokeWidth={1.8} strokeDasharray="7 6" />
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

function renderElement(el: Element): ReactElement {
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
    case 'formula':
      return (
        <text x={el.x} y={el.y} textAnchor="middle" fontFamily={FONT_MONO} fontStyle="italic" fontSize={24} letterSpacing={0.5} fill={INK}>
          {el.text}
        </text>
      );
    case 'image':
      return renderImage(el);
    case 'model3d':
      return renderModel3d(el);
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
}

function SceneElement({ el, isNew, dimmed, focused }: SceneElementProps): ReactElement {
  const c = centerOf(el);
  const transform = `rotate(${jitterDeg(el.id).toFixed(2)} ${c.x} ${c.y})`;
  const isStroke = el.kind === 'arrow' || el.kind === 'pen';
  const sweeping = isNew && isStroke;
  const glow = focused ? { filter: `drop-shadow(0 0 7px ${TONE_COLORS[toneOf(el)]}b3)` } : undefined;

  return (
    <>
      {sweeping && (
        <mask id={`stage-sweep-${el.id}`} maskUnits="userSpaceOnUse" x={0} y={0} width={CANVAS_W} height={CANVAS_H}>
          {/* Same jitter transform as the element, so the mask tracks it exactly. */}
          <g transform={transform}>{sweepStroke(el as StrokeElement)}</g>
        </mask>
      )}
      <g
        data-element-id={el.id}
        transform={transform}
        opacity={dimmed ? 0.25 : undefined}
        mask={sweeping ? `url(#stage-sweep-${el.id})` : undefined}
        style={glow}
      >
        <g className={isNew && !isStroke ? 'stage-pop' : undefined}>{renderElement(el)}</g>
      </g>
    </>
  );
}

/**
 * The SVG renderer. Renders; decides nothing — what is visible/focused was
 * decided upstream and arrives as props. All animation is CSS inside the SVG,
 * so there are no timers to leak past unmount.
 */
export function Scene({ lesson, visible, focus }: SceneProps): ReactElement {
  // Previous render's visible set, committed after paint so the render pass can
  // tell which elements just appeared and animate only those. On the first
  // render (prev === null) everything draws in — the canvas is coming from blank.
  const prevVisibleRef = useRef<ReadonlySet<string> | null>(null);
  const prev = prevVisibleRef.current;
  useEffect(() => {
    prevVisibleRef.current = new Set(visible);
  });

  const visibleSet = new Set(visible);
  const focusSet = new Set(focus);
  const dimming = focusSet.size > 0;

  return (
    <svg
      viewBox={`0 0 ${lesson.canvas.w} ${lesson.canvas.h}`}
      role="img"
      aria-label={lesson.title}
      style={{ display: 'block', width: '100%', height: 'auto', maxHeight: '100%' }}
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
          />
        ))}
    </svg>
  );
}
