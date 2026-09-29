// With its extension: the relay's keep route (packages/relay/src/classStore.ts)
// runs this file in Deno, which resolves no extensionless specifier.
import { ALTERNATE_MODES, type AlternateMode, type Beat, type Element, type Lesson, type Point } from './types.ts';

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
    case 'list':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w), 'list needs numeric x,y,w');
      // No height: a list is as tall as its items make it, measured by
      // listBoxHeight. A width it must have, because that is what it wraps to.
      need(
        Array.isArray(el.items) && el.items.length > 0,
        'list needs at least one item',
      );
      need(
        Array.isArray(el.items) && el.items.every((it) => isObj(it) && isStr(it.term)),
        'every list item needs a term — the term is the thing being defined',
      );
      optionalNumber('size');
      break;
    case 'handwrite':
      need(isNum(el.x) && isNum(el.y), 'handwrite needs numeric x,y');
      need(isStr(el.text), 'handwrite needs non-empty text');
      optionalNumber('size');
      break;
    case 'graphic':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'graphic needs numeric x,y,w,h');
      need(isStr(el.noun), 'graphic needs a noun');
      break;
    case 'mark':
      need(isNum(el.x) && isNum(el.y) && isNum(el.w) && isNum(el.h), 'mark needs numeric x,y,w,h');
      need(
        el.shape === 'circle' || el.shape === 'underline' || el.shape === 'tick' || el.shape === 'cross',
        'mark shape must be circle, underline, tick or cross',
      );
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

  if (beat.ask !== undefined) {
    const ask = beat.ask as {
      question?: unknown;
      written?: unknown;
      options?: unknown;
      expect?: unknown;
      hint?: unknown;
      whyProbe?: unknown;
    };
    if (!isStr(ask.question)) errs.push(`${path}: ask needs a non-empty question`);
    if (ask.written !== undefined) {
      if (!isStr(ask.written)) errs.push(`${path}: an ask's written question must be a non-empty string when present`);
      else if ((ask.written.match(/\$/g) ?? []).length % 2 !== 0) errs.push(`${path}: an ask's written question has an unclosed maths group`);
    }
    if (ask.expect !== undefined && !isStr(ask.expect))
      errs.push(`${path}: ask expect must be a non-empty string when present`);
    if (ask.hint !== undefined && !isStr(ask.hint))
      errs.push(`${path}: ask hint must be a non-empty string when present`);
    // C6: a worked example of a SIMILAR problem (the L5 rung). Optional; when
    // present, 1 to 6 steps, each with a spoken line and a board line.
    const worked = (ask as { workedExample?: unknown }).workedExample;
    if (worked !== undefined) {
      const steps = isObj(worked) ? (worked as { steps?: unknown }).steps : undefined;
      if (
        !Array.isArray(steps) ||
        steps.length < 1 ||
        steps.length > 6 ||
        !steps.every((s) => isObj(s) && isStr((s as { say?: unknown }).say) && isStr((s as { line?: unknown }).line))
      ) {
        errs.push(`${path}: ask workedExample needs 1 to 6 steps, each with a non-empty say and line`);
      }
    }
    // H4: 1 to 3 re-explanations, each a known mode with something to say.
    const alternates = (ask as { alternates?: unknown }).alternates;
    if (alternates !== undefined) {
      if (
        !Array.isArray(alternates) ||
        alternates.length < 1 ||
        alternates.length > 3 ||
        !alternates.every(
          (a) =>
            isObj(a) &&
            ALTERNATE_MODES.includes((a as { mode?: unknown }).mode as AlternateMode) &&
            isStr((a as { say?: unknown }).say) &&
            (a as { say: string }).say.trim() !== '' &&
            ((a as { line?: unknown }).line === undefined ||
              (isStr((a as { line?: unknown }).line) && (a as { line: string }).line.trim() !== '')),
        )
      ) {
        errs.push(`${path}: ask alternates needs 1 to 3 entries, each with a known mode, a non-blank say and, if it has a line, a non-blank line`);
      }
    }
    if (ask.options !== undefined) {
      const options = ask.options as { text?: unknown; correct?: unknown }[];
      if (!Array.isArray(options) || options.length < 2) {
        errs.push(`${path}: ask options need at least two choices`);
      } else {
        if (!options.every((o) => isObj(o) && isStr(o.text)))
          errs.push(`${path}: every ask option needs text`);
        // A question with no right answer is a trick with no door out of it.
        if (!options.some((o) => o.correct === true))
          errs.push(`${path}: one ask option must be marked correct`);
      }
    }
    /**
     * The whyProbe is judged at playback with NO model in the loop, so every
     * promise the format makes about it has to be checked here: an option the
     * matcher lands on with no `why` leaves the tutor silent, two `correct`
     * options make the verdict a coin toss, and either failure is invisible
     * until a child hits it. Optional overall — 15 committed lessons and every
     * pre-whyProbe blueprint carry none, and that stays valid.
     */
    if (ask.whyProbe !== undefined) {
      if (!isObj(ask.whyProbe)) {
        errs.push(`${path}: whyProbe must be an object with options and askedAs`);
      } else {
        const probe = ask.whyProbe as { options?: unknown; askedAs?: unknown };
        if (probe.askedAs !== 'options' && probe.askedAs !== 'open') {
          errs.push(`${path}: whyProbe askedAs must be "options" or "open"`);
        }
        const options = probe.options as { text?: unknown; correct?: unknown; why?: unknown; hint?: unknown }[];
        if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
          errs.push(
            `${path}: whyProbe needs 2 to 4 options — one right answer and the named misconceptions`,
          );
        } else {
          if (!options.every((o) => isObj(o) && isStr(o.text)))
            errs.push(`${path}: every whyProbe option needs text`);
          if (!options.every((o) => !isObj(o) || isStr(o.why)))
            errs.push(
              `${path}: every whyProbe option needs a non-empty why — the why is what she says on a match, so an option without one leaves her silent`,
            );
          if (options.some((o) => isObj(o) && o.hint !== undefined && !isStr(o.hint)))
            errs.push(`${path}: a whyProbe option hint must be a non-empty string when present`);
          if (options.some((o) => isObj(o) && (o as { followUp?: unknown }).followUp !== undefined && !isStr((o as { followUp?: unknown }).followUp)))
            errs.push(`${path}: a whyProbe option followUp must be a non-empty string when present`);
          const correct = options.filter((o) => isObj(o) && o.correct === true).length;
          if (correct !== 1) {
            errs.push(
              `${path}: whyProbe needs exactly one option marked correct, got ${correct}`,
            );
          }
        }
      }
    }
  }
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
  /**
   * PRD-4 requirement 2: an ask beat may check AT MOST TWO outcomes. One
   * spoken answer filed as evidence about five things is a pedagogy defect
   * even after the fold arithmetic is fixed, and the planner prompt's cap is
   * a request, not a mechanism. Bound to beats that carry an ask because the
   * cap is about what one ANSWER may be evidence for — a beat that lists
   * three checks and asks nothing files no answer and stays valid. Committed
   * content relies on that: four askless beats across three lessons exceed
   * two checks (class10-excretion `recap`, life-processes-transportation
   * `beat_significance_and_summary_3`, class9-particle-size `b5` and `b11`,
   * which files SEVEN). A cap on every beat, as PRD-4's heading literally
   * reads, would have invalidated three shipped lessons.
   */
  if (beat.ask !== undefined && Array.isArray(beat.checks) && beat.checks.length > 2) {
    errs.push(
      `${path}: an ask beat may check at most two outcomes, got ${beat.checks.length} — one answer cannot be evidence about ${beat.checks.length} things; split the beat`,
    );
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

  if (beat.frame !== undefined) {
    if (!Array.isArray(beat.frame) || !beat.frame.every((id) => isStr(id))) {
      errs.push(`${path}: frame must be an array of element ids`);
    } else {
      // The camera can only look at what exists this beat. A frame id outside
      // show would aim the class at empty board and nobody would see why.
      const shown = new Set(Array.isArray(beat.show) ? beat.show.map(String) : []);
      for (const id of beat.frame) {
        if (!shown.has(String(id))) {
          errs.push(`${path}: frame references "${String(id)}" which is not shown`);
        }
      }
    }
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

  /**
   * The live fill, if there is one.
   *
   * Optional, and absent is the ordinary case: a cached class replayed by
   * somebody it was not made for has none, which is correct. What is NOT
   * allowed is a line pointing at a beat that does not exist — that is a
   * personal greeting that would never be spoken, and silently.
   */
  if (json.fill !== undefined) {
    if (!Array.isArray(json.fill)) {
      errors.push('fill must be an array of { beatId, say }');
    } else {
      json.fill.forEach((line, i) => {
        const path = `fill[${i}]`;
        if (!isObj(line)) {
          errors.push(`${path}: must be an object`);
          return;
        }
        if (!isStr(line.beatId)) errors.push(`${path}: needs a beatId`);
        else if (!beatIds.has(line.beatId)) {
          errors.push(`${path}: no beat "${line.beatId}" to open`);
        }
        if (!isStr(line.say)) errors.push(`${path}: needs something to say`);
      });
    }
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
