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

  switch (el.kind) {
    case 'title':
      need(isNum(el.x) && isNum(el.y), 'title needs numeric x,y');
      need(isStr(el.text), 'title needs non-empty text');
      break;
    case 'text':
      need(isNum(el.x) && isNum(el.y), 'text needs numeric x,y');
      need(isStr(el.text), 'text needs non-empty text');
      break;
    case 'note':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w), 'note needs numeric x,y,w');
      need(isStr(el.text), 'note needs non-empty text');
      break;
    case 'box':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'box needs numeric x,y,w,h');
      need(isStr(el.label), 'box needs non-empty label');
      break;
    case 'doc':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'doc needs numeric x,y,w,h');
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
    case 'model3d':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'model3d needs numeric x,y,w,h');
      break;
    default:
      errs.push(`${path}: unknown element kind "${String(el.kind)}"`);
  }
  return errs;
}

function beatErrors(beat: Record<string, unknown>, path: string, elementIds: Set<string>): string[] {
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
      for (const id of beat.focus) {
        if (!shown.has(String(id))) {
          errs.push(`${path}: focus "${String(id)}" is not in this beat's show list`);
        }
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
      errors.push(...beatErrors(beat, path, elementIds));
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
