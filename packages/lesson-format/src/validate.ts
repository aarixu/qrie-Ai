import type { Beat, Element, Lesson, Point } from './types';

/**
 * Runtime validation of a lesson document.
 *
 * Used in three places:
 *   - the FACTORY, to reject/repair what the LLM generated (errors are fed back
 *     to the model for a retry, so messages must be specific and actionable);
 *   - the CLASSROOM app, before loading any lesson from content/;
 *   - tests, as the guarantee that every committed lesson is playable.
 *
 * Deliberately dependency-free and hand-rolled: error strings are the API.
 */

export type ValidationResult =
  | { ok: true; lesson: Lesson }
  | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isPoint = (v: unknown): v is Point => isObj(v) && isNum(v.x) && isNum(v.y);

/** Fields required per element kind, beyond `kind` and `id`. */
function elementErrors(el: Record<string, unknown>, path: string): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errs.push(`${path}: ${msg}`);
  };
  /**
   * An OPTIONAL number must still be a number when it is there.
   *
   * A live planner wrote `"size": "md"` once, which every other check waved
   * through and the renderer turned into `NaN` width on a mask — an element
   * that silently vanished with only a console warning. An optional field left
   * unchecked is the one that reaches the board.
   */
  const optionalNumber = (key: string) => {
    if (el[key] !== undefined && !isNum(el[key])) {
      errs.push(`${path}: ${String(el.kind)} ${key} must be a number, got ${JSON.stringify(el[key])}`);
    }
  };

  switch (el.kind) {
    case 'title':
      need(isNum(el.x) && isNum(el.y), 'title needs numeric x,y');
      need(isStr(el.text), 'title needs non-empty text');
      break;
    case 'text':
      need(isNum(el.x) && isNum(el.y), 'text needs numeric x,y');
      need(isStr(el.text), 'text needs non-empty text');
      optionalNumber('size');
      break;
    case 'note':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w), 'note needs numeric x,y,w');
      need(isStr(el.text), 'note needs non-empty text');
      break;
    case 'box':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'box needs numeric x,y,w,h');
      // An EMPTY label is legitimate: a box is also the frame a card draws
      // around its own heading and body. Requiring a label there forced the
      // centred label to share the box's middle with the body line, which is
      // exactly how the two used to collide.
      need(typeof el.label === 'string', 'box needs a label string (may be empty)');
      break;
    case 'doc':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'doc needs numeric x,y,w,h');
      optionalNumber('lines');
      break;
    case 'arrow':
      need(isPoint(el.from) && isPoint(el.to), 'arrow needs from:{x,y} and to:{x,y}');
      break;
    case 'pen':
      need(
        Array.isArray(el.points) && el.points.length >= 2 && el.points.every(isPoint),
        'pen needs points: at least 2 {x,y} entries',
      );
      break;
    case 'formula':
      need(isNum(el.x) && isNum(el.y), 'formula needs numeric x,y');
      need(isStr(el.text), 'formula needs non-empty text');
      break;
    case 'image':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'image needs numeric x,y,w,h');
      need(isStr(el.src), 'image needs src');
      need(isStr(el.alt), 'image needs alt text');
      break;
    case 'diagram':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'diagram needs numeric x,y,w,h');
      need(isStr(el.src), 'diagram needs src');
      need(isStr(el.alt), 'diagram needs alt text');
      // A diagram with no named parts is just an image with extra ceremony.
      // The whole point of the kind is that a tutor can point INSIDE it.
      need(
        Array.isArray(el.parts) && el.parts.length > 0 && el.parts.every((p) => isStr(p)),
        'diagram needs a non-empty parts array of group ids',
      );
      if (Array.isArray(el.parts)) {
        for (const part of el.parts) {
          if (String(part).includes(PART_SEPARATOR)) {
            need(false, `diagram part "${String(part)}" must not contain "${PART_SEPARATOR}"`);
          }
        }
        if (new Set(el.parts.map(String)).size !== el.parts.length) {
          need(false, 'diagram lists the same part twice');
        }
      }
      break;
    case 'chart':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'chart needs numeric x,y,w,h');
      need(el.chartType === 'bar', 'chart needs chartType "bar"');
      need(
        Array.isArray(el.data) &&
          el.data.length > 0 &&
          el.data.every((d) => isObj(d) && isStr(d.label) && isNum(d.value) && d.value >= 0),
        'chart needs data: at least one { label, value } with a non-negative value',
      );
      break;
    case 'flow':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w), 'flow needs numeric x,y,w');
      need(
        Array.isArray(el.steps) && el.steps.length >= 2 && el.steps.every((st) => isObj(st) && isStr(st.label)),
        'flow needs steps: at least two { label } entries',
      );
      // One box with an arrow to nowhere is not a workflow; it is a box.
      if (el.direction !== undefined) {
        need(el.direction === 'row' || el.direction === 'column', 'flow direction must be "row" or "column"');
      }
      break;
    case 'handwrite':
      need(isNum(el.x) && isNum(el.y), 'handwrite needs numeric x,y');
      need(isStr(el.text), 'handwrite needs non-empty text');
      optionalNumber('size');
      break;
    case 'model3d':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'model3d needs numeric x,y,w,h');
      break;
    default:
      errs.push(`${path}: unknown element kind "${String(el.kind)}"`);
  }
  return errs;
}

/**
 * Separates a diagram's element id from the part inside it: `d_mito#cristae`.
 *
 * Chosen because `#` is already how a fragment inside a document is addressed,
 * and because it cannot appear in a part id — the validator enforces that, so
 * splitting is never ambiguous.
 */
export const PART_SEPARATOR = '#';

/** Split a focus id into its element and, if present, the part inside it. */
export function splitPartRef(ref: string): { elementId: string; part: string | null } {
  const at = ref.indexOf(PART_SEPARATOR);
  if (at < 0) return { elementId: ref, part: null };
  return { elementId: ref.slice(0, at), part: ref.slice(at + 1) };
}

function beatErrors(
  beat: Record<string, unknown>,
  path: string,
  elementIds: Set<string>,
  partsByElement: Map<string, Set<string>>,
): string[] {
  const errs: string[] = [];
  if (!isStr(beat.id)) errs.push(`${path}: beat needs a non-empty id`);
  if (!isStr(beat.topic)) errs.push(`${path}: beat needs a non-empty topic label`);
  if (!isStr(beat.narration)) errs.push(`${path}: beat needs non-empty narration`);

  if (!Array.isArray(beat.show)) {
    errs.push(`${path}: beat needs a show array of element ids`);
  } else {
    for (const id of beat.show) {
      if (!elementIds.has(String(id))) {
        errs.push(`${path}: show references unknown element "${String(id)}"`);
      }
    }
  }

  if (beat.focus !== undefined) {
    if (!Array.isArray(beat.focus)) {
      errs.push(`${path}: focus must be an array when present`);
    } else {
      const shown = new Set(Array.isArray(beat.show) ? beat.show.map(String) : []);
      for (const raw of beat.focus) {
        const ref = String(raw);
        const { elementId, part } = splitPartRef(ref);
        if (!shown.has(elementId)) {
          errs.push(`${path}: focus "${ref}" is not in this beat's show list`);
          continue;
        }
        if (part === null) continue;
        const parts = partsByElement.get(elementId);
        if (!parts) {
          errs.push(`${path}: focus "${ref}" names a part, but "${elementId}" is not a diagram`);
        } else if (!parts.has(part)) {
          // Pointing at a part the artwork never drew leaves the tutor
          // gesturing at nothing, and nobody would see the mistake at runtime.
          errs.push(`${path}: focus "${ref}" names a part "${elementId}" does not have`);
        }
      }
    }
  }

  // `teaches` and `checks` are outcome ids from the Learning Outcome Map. This
  // package cannot see that map — it has zero dependencies by design — so it
  // checks the SHAPE here and leaves "does this id exist" to whoever holds the
  // map. What it can enforce is that the two lists never overlap: a beat that
  // both teaches and checks the same outcome is a question marking its own
  // homework.
  for (const field of ['teaches', 'checks'] as const) {
    const value = beat[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((id) => isStr(id))) {
      errs.push(`${path}: ${field} must be an array of outcome ids`);
      continue;
    }
    if (new Set(value.map(String)).size !== value.length) {
      errs.push(`${path}: ${field} lists the same outcome twice`);
    }
  }
  if (Array.isArray(beat.teaches) && Array.isArray(beat.checks)) {
    const taught = new Set(beat.teaches.map(String));
    for (const id of beat.checks) {
      if (taught.has(String(id))) {
        errs.push(`${path}: "${String(id)}" is both taught and checked in the same beat`);
      }
    }
  }

  if (beat.minMs !== undefined && (!isNum(beat.minMs) || beat.minMs < 0)) {
    errs.push(`${path}: minMs must be a non-negative number`);
  }
  return errs;
}

export function validateLesson(json: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObj(json)) return { ok: false, errors: ['lesson must be a JSON object'] };

  if (json.formatVersion !== 1) errors.push('formatVersion must be exactly 1');
  if (!isStr(json.id)) errors.push('lesson needs a non-empty id');
  if (!isStr(json.title)) errors.push('lesson needs a non-empty title');
  if (json.language !== 'hi-en' && json.language !== 'en') {
    errors.push('language must be "hi-en" or "en"');
  }
  if (!isObj(json.canvas) || !isNum(json.canvas.w) || !isNum(json.canvas.h) || json.canvas.w <= 0 || json.canvas.h <= 0) {
    errors.push('canvas must be { w, h } with positive dimensions');
  }

  const elementIds = new Set<string>();
  const partsByElement = new Map<string, Set<string>>();
  if (!Array.isArray(json.elements) || json.elements.length === 0) {
    errors.push('lesson needs a non-empty elements array');
  } else {
    json.elements.forEach((el, i) => {
      const path = `elements[${i}]`;
      if (!isObj(el)) {
        errors.push(`${path}: must be an object`);
        return;
      }
      if (!isStr(el.id)) {
        errors.push(`${path}: element needs a non-empty id`);
      } else if (elementIds.has(el.id)) {
        errors.push(`${path}: duplicate element id "${el.id}"`);
      } else {
        elementIds.add(el.id);
      }
      if (el.kind === 'diagram' && isStr(el.id) && Array.isArray(el.parts)) {
        partsByElement.set(el.id, new Set(el.parts.map(String)));
      }
      errors.push(...elementErrors(el, path));
    });
  }

  const beatIds = new Set<string>();
  if (!Array.isArray(json.beats) || json.beats.length === 0) {
    errors.push('lesson needs a non-empty beats array');
  } else {
    json.beats.forEach((beat, i) => {
      const path = `beats[${i}]`;
      if (!isObj(beat)) {
        errors.push(`${path}: must be an object`);
        return;
      }
      if (isStr(beat.id)) {
        if (beatIds.has(beat.id)) errors.push(`${path}: duplicate beat id "${beat.id}"`);
        beatIds.add(beat.id);
      }
      errors.push(...beatErrors(beat, path, elementIds, partsByElement));
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, lesson: json as unknown as Lesson };
}

/** Convenience: find a beat by id. Returns null rather than throwing — callers decide. */
export function findBeat(lesson: Lesson, beatId: string): Beat | null {
  return lesson.beats.find((b) => b.id === beatId) ?? null;
}

/** Convenience: elements visible in a given beat, in element-declaration order. */
export function elementsForBeat(lesson: Lesson, beat: Beat): Element[] {
  const shown = new Set(beat.show);
  return lesson.elements.filter((el) => shown.has(el.id));
}
