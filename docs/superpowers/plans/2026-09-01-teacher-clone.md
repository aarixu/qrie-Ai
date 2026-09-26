# Teacher Clone Implementation Plan

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a client's two real teachers — their face, their voice, their teaching style — into Qrie's live classroom, well enough to record a 2-minute demo, on a pipeline that can later run realtime.

**Architecture:** Three clones behind the seams that already exist. The **style** clone turns a transcript into a card the planner writes with, so the lesson is planned in their voice. The **voice** clone sits behind the existing `TtsAdapter`. The **face** clone is a `VideoAvatar` that plays a lip-dubbed clip per line, indexed by a manifest that mirrors the narration manifest exactly — same hash discipline, same fall-through. One Azure GPU VM runs MuseTalk and the chosen TTS behind a small HTTP service.

**Tech Stack:** TypeScript monorepo (Vite + React), new `@ai-tutor/teacher-clone` package, MuseTalk (lip-dub), Whisper (transcript), a cloned-voice TTS chosen by bake-off, one Azure GPU VM (T4/A10) with Python + FastAPI.

**Spec:** `docs/superpowers/specs/2026-09-01-teacher-clone-design.md`

## Global Constraints

- **Weights licences are checked separately from code licences.** Wav2Lip, V-Express, Sonic, FLOAT and XTTS-v2 weights are non-commercial and MUST NOT be used. Re-verify MuseTalk's weights licence on the day it is downloaded.
- **Nothing renders a teacher's face or voice until the written consent email exists.** It must name both teachers and say "voice and likeness".
- **The penguin stays.** This adds a second renderer; Qrie's own students keep `CartoonAvatar`.
- **Do not touch** `ClassRoom.tsx` beyond which avatar it mounts, nor the player, canvas, ask gate or mic.
- **The existing suite stays green:** `npm run typecheck` and `npx vitest run` before every commit.
- Comments explain WHY, in the voice of the existing codebase. No decoration.

---

## Phase A — everything that needs neither the GPU nor the video

### Task 1: The clip manifest

A lesson's lip-dubbed clips are indexed exactly the way its recorded audio is: one entry per beat, each carrying the hash of the narration it was rendered for. A hash mismatch means somebody edited the lesson without re-rendering, and the clip must NOT play — the idle loop plays instead. Same rule as `recordedTts`, for the same reason.

**Files:**
- Create: `packages/teacher-clone/package.json`
- Create: `packages/teacher-clone/tsconfig.json`
- Create: `packages/teacher-clone/src/manifest.ts`
- Create: `packages/teacher-clone/src/index.ts`
- Test: `packages/teacher-clone/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `hashNarration` from `@ai-tutor/voice`.
- Produces: `CLIP_DIR`, `CLIP_MANIFEST_FILE`, `clipFileName(beatId: string): string`, `parseClipManifest(json: unknown): ClipManifest | null`, types `ClipEntry` and `ClipManifest`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/teacher-clone/tests/manifest.test.ts
import { describe, expect, it } from 'vitest';
import { clipFileName, parseClipManifest } from '../src/manifest';

const good = {
  formatVersion: 1,
  lessonId: 'class9-tissues',
  teacher: 'sharma',
  idle: 'idle.mp4',
  beats: { b1: { file: 'b1.mp4', durationMs: 4200, hash: 'abc' } },
};

describe('the clip manifest', () => {
  it('names a clip after its beat', () => {
    expect(clipFileName('b1')).toBe('b1.mp4');
  });

  it('takes a manifest we wrote', () => {
    const m = parseClipManifest(good);
    expect(m?.beats.b1.durationMs).toBe(4200);
    expect(m?.idle).toBe('idle.mp4');
  });

  it('refuses anything else, rather than half-playing it', () => {
    expect(parseClipManifest(null)).toBeNull();
    expect(parseClipManifest({ ...good, formatVersion: 2 })).toBeNull();
    expect(parseClipManifest({ ...good, idle: '' })).toBeNull();
    expect(parseClipManifest({ ...good, beats: { b1: { file: 'b1.mp4' } } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/teacher-clone`
Expected: FAIL — cannot resolve `../src/manifest`.

- [ ] **Step 3: Write the package and the manifest**

`packages/teacher-clone/package.json` — copy the shape of `packages/voice/package.json`, name `@ai-tutor/teacher-clone`, dependency `"@ai-tutor/voice": "*"`.
`packages/teacher-clone/tsconfig.json` — copy `packages/voice/tsconfig.json` verbatim.

```ts
// packages/teacher-clone/src/manifest.ts
/**
 * THE LIP-DUBBED TAKE — indexed exactly like the recorded voice.
 *
 * Deliberately a mirror of `NarrationManifest`: one entry per beat, each
 * carrying the hash of the narration it was rendered FOR. Nothing stops
 * someone fixing a sentence in lesson.json without re-rendering the video,
 * and a clip that plays anyway is a teacher whose lips say words the class
 * is not speaking. So a take plays only when the hashes agree, and anything
 * else falls back to the idle loop — the teacher simply listening.
 */
export const CLIP_DIR = 'clips';
export const CLIP_MANIFEST_FILE = 'clips.json';

export interface ClipEntry {
  /** File name inside the lesson's clips folder, e.g. "b1.mp4". */
  file: string;
  durationMs: number;
  /** `hashNarration(beat.narration)` at render time. */
  hash: string;
}

export interface ClipManifest {
  formatVersion: 1;
  lessonId: string;
  /** Which teacher this take is of, so two clones cannot be mixed in one class. */
  teacher: string;
  /** The between-lines loop. Without one there is nothing to show, so it is required. */
  idle: string;
  beats: Record<string, ClipEntry>;
}

export function clipFileName(beatId: string): string {
  return `${beatId}.mp4`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isEntry = (v: unknown): v is ClipEntry =>
  isObject(v) &&
  typeof v.file === 'string' &&
  typeof v.hash === 'string' &&
  typeof v.durationMs === 'number' &&
  Number.isFinite(v.durationMs);

export function parseClipManifest(json: unknown): ClipManifest | null {
  if (!isObject(json) || json.formatVersion !== 1) return null;
  if (typeof json.lessonId !== 'string' || json.lessonId === '') return null;
  if (typeof json.teacher !== 'string' || json.teacher === '') return null;
  if (typeof json.idle !== 'string' || json.idle === '') return null;
  if (!isObject(json.beats)) return null;

  const beats: Record<string, ClipEntry> = {};
  for (const [beatId, entry] of Object.entries(json.beats)) {
    if (!isEntry(entry)) return null;
    beats[beatId] = { file: entry.file, durationMs: entry.durationMs, hash: entry.hash };
  }
  return {
    formatVersion: 1,
    lessonId: json.lessonId,
    teacher: json.teacher,
    idle: json.idle,
    beats,
  };
}
```

```ts
// packages/teacher-clone/src/index.ts
export {
  CLIP_DIR,
  CLIP_MANIFEST_FILE,
  clipFileName,
  parseClipManifest,
  type ClipEntry,
  type ClipManifest,
} from './manifest';
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `npx vitest run packages/teacher-clone && npm run typecheck`
Expected: PASS, and tsc silent.

- [ ] **Step 5: Commit**

```bash
git add packages/teacher-clone
git commit -m "feat: a lip-dub manifest with the recording's own hash discipline"
```

---

### Task 2: The style card

Ten minutes of transcript become a short structured card describing how this teacher talks and teaches. The card is what makes the clone more than a voice: the lesson is PLANNED in their style, not merely spoken in their voice.

**Files:**
- Create: `packages/teacher-clone/src/style.ts`
- Modify: `packages/teacher-clone/src/index.ts`
- Test: `packages/teacher-clone/tests/style.test.ts`

**Interfaces:**
- Produces: `STYLE_SYSTEM: string`, `styleUser(transcript: string): string`, `parseStyleCard(raw: string): StyleCard`, `styleBrief(card: StyleCard): string`, type `StyleCard`.
- `styleBrief` returns the paragraph Task 3 appends to the planner prompt.

- [ ] **Step 1: Write the failing test**

```ts
// packages/teacher-clone/tests/style.test.ts
import { describe, expect, it } from 'vitest';
import { STYLE_SYSTEM, parseStyleCard, styleBrief, styleUser } from '../src/style';

const card = {
  teacher: 'Sharma sir',
  sound: 'Warm, unhurried, drops his voice on the important word.',
  languageMix: 'Terms in English, the explanation in Hindi.',
  phrases: ['dekhiye beta', 'samajh aaya?'],
  opening: 'Starts from something in the room before naming the topic.',
  questioning: 'Asks, waits, then asks the same thing a smaller way.',
  examples: 'Kitchen and cricket.',
};

describe('reading a style card out of a model reply', () => {
  it('takes a clean card', () => {
    const c = parseStyleCard(JSON.stringify(card));
    expect(c.teacher).toBe('Sharma sir');
    expect(c.phrases).toHaveLength(2);
  });

  it('digs the card out of a chatty reply', () => {
    const c = parseStyleCard(`Here you go:\n${JSON.stringify(card)}`);
    expect(c.languageMix).toContain('Hindi');
  });

  it('refuses a card with nothing in it, rather than teaching as nobody', () => {
    expect(() => parseStyleCard('{}')).toThrow();
    expect(() => parseStyleCard('no json here')).toThrow();
  });
});

describe('what the planner is told', () => {
  it('puts every part of the card in the brief, and the phrases verbatim', () => {
    const brief = styleBrief(parseStyleCard(JSON.stringify(card)));
    expect(brief).toContain('Sharma sir');
    expect(brief).toContain('dekhiye beta');
    expect(brief).toContain('Kitchen and cricket');
  });

  it('tells the planner to teach AS them, not to describe them', () => {
    expect(styleBrief(parseStyleCard(JSON.stringify(card)))).toMatch(/never (say|mention|describe)/i);
  });
});

describe('what the model is asked for', () => {
  it('asks for the switch POINT, not just the languages', () => {
    expect(STYLE_SYSTEM).toMatch(/where .*switch|switch .*point|which words/i);
  });

  it('carries the transcript into the user prompt', () => {
    expect(styleUser('dekhiye beta, force ka matlab')).toContain('dekhiye beta');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/teacher-clone/tests/style.test.ts`
Expected: FAIL — cannot resolve `../src/style`.

- [ ] **Step 3: Write the style card**

```ts
// packages/teacher-clone/src/style.ts
/**
 * HOW THIS TEACHER TEACHES, IN SEVEN LINES.
 *
 * A cloned voice reading somebody else's phrasing sounds like a stranger
 * using that teacher's throat, and their own colleague hears it in one
 * sentence. So the transcript is read once, offline, into a card — and the
 * card goes into the PLANNER, so the lesson is planned the way they would
 * have planned it. The voice clone then only has to say it.
 *
 * Deliberately short. A long card gets averaged away by the model; seven
 * concrete lines survive into the writing.
 */

export interface StyleCard {
  /** What the students call them — used the way they use it, if at all. */
  teacher: string;
  /** Their sound in words: pace, warmth, where the emphasis falls. */
  sound: string;
  /** Which language carries the terms and which carries the explanation. */
  languageMix: string;
  /** Their own phrases, verbatim, to be reused rather than paraphrased. */
  phrases: readonly string[];
  /** How they get into a topic. */
  opening: string;
  /** How they ask, and what they do when nobody answers. */
  questioning: string;
  /** The world their examples come from. */
  examples: string;
}

export const STYLE_SYSTEM = `You are given a transcript of one real teacher teaching. Describe HOW they teach, so another writer can plan a lesson that sounds like them.

Reply with ONE JSON object and nothing else:
{"teacher","sound","languageMix","phrases":["..."],"opening","questioning","examples"}

- "teacher": what the students appear to call them. If the transcript never says, use "the teacher".
- "sound": pace, warmth, and WHERE the emphasis falls — one sentence.
- "languageMix": which language carries the technical terms and which carries the explanation, and WHERE they switch — the switch point matters more than the ratio. Many Indian teachers keep the term in English and explain in Hindi; say what THIS teacher does.
- "phrases": 3 to 6 of their actual recurring phrases, copied VERBATIM from the transcript, in their own script. Not paraphrases.
- "opening": how they get into a topic — one sentence.
- "questioning": how they ask a question, and what they do when the answer does not come.
- "examples": the world their examples come from (kitchen, cricket, the classroom itself).

Describe only what the transcript shows. Do not flatter, do not generalise about Indian teachers, and do not invent a phrase they never said.`;

export function styleUser(transcript: string): string {
  return `TRANSCRIPT\n\n${transcript}`;
}

export function parseStyleCard(raw: string): StyleCard {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('The style reply had no JSON in it.');
  const data = JSON.parse(match[0]) as Record<string, unknown>;
  const str = (key: string): string => {
    const value = data[key];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`The style card is missing "${key}".`);
    }
    return value.trim();
  };
  const phrases = Array.isArray(data.phrases)
    ? data.phrases.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    : [];
  if (phrases.length === 0) throw new Error('The style card names no phrases of their own.');

  return {
    teacher: str('teacher'),
    sound: str('sound'),
    languageMix: str('languageMix'),
    phrases,
    opening: str('opening'),
    questioning: str('questioning'),
    examples: str('examples'),
  };
}

/**
 * The card as the planner hears it.
 *
 * Written as instructions rather than as a description, because a model
 * given a description of a teacher writes ABOUT that teacher.
 */
export function styleBrief(card: StyleCard): string {
  return `TEACH AS THIS TEACHER. You are writing the spoken lines of ${card.teacher}, a real teacher, and the class must sound like them.

- Their sound: ${card.sound}
- Their languages: ${card.languageMix}
- Their own phrases, to be used as they use them: ${card.phrases.map((p) => `"${p}"`).join(', ')}
- How they open a topic: ${card.opening}
- How they question: ${card.questioning}
- Where their examples come from: ${card.examples}

Write their lines the way they speak them. Never say, mention or describe any of this — a student hears a teacher, not a description of one.`;
}
```

Append to `packages/teacher-clone/src/index.ts`:

```ts
export {
  STYLE_SYSTEM,
  parseStyleCard,
  styleBrief,
  styleUser,
  type StyleCard,
} from './style';
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/teacher-clone && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/teacher-clone
git commit -m "feat: a style card, so the lesson is planned in their voice"
```

---

### Task 3: The planner writes with the card

**Files:**
- Modify: `packages/class-prep/src/prompts.ts` (the `plannerUser` signature and body)
- Modify: `packages/class-prep/src/prepare.ts` (`PrepOptions`, and the `plannerUser` call)
- Test: `packages/class-prep/tests/prompts.test.ts` (append)

**Interfaces:**
- Consumes: `styleBrief` output from Task 2 — an opaque string.
- Produces: `plannerUser(topic, klass, minutes, studentLines?, teacherStyle?)` and `PrepOptions.teacherStyle?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/class-prep/tests/prompts.test.ts
describe('planning in a real teacher\'s style', () => {
  it('carries the brief into the prompt, last, where it colours everything', () => {
    const brief = 'TEACH AS THIS TEACHER. Their own phrases: "dekhiye beta".';
    const p = plannerUser('Evaporation', 9, 4, undefined, brief);
    expect(p).toContain('dekhiye beta');
    expect(p.indexOf('dekhiye beta')).toBeGreaterThan(p.indexOf('Evaporation'));
  });

  it('says not a word about a teacher when there is no brief', () => {
    expect(plannerUser('Evaporation', 9, 4)).not.toMatch(/TEACH AS THIS TEACHER/);
  });

  it('takes a student dossier and a teacher brief together', () => {
    const p = plannerUser('Evaporation', 9, 4, ['Her name is Ananya.'], 'TEACH AS THIS TEACHER.');
    expect(p).toContain('Ananya');
    expect(p).toContain('TEACH AS THIS TEACHER.');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/class-prep/tests/prompts.test.ts`
Expected: FAIL — `plannerUser` takes 4 arguments.

- [ ] **Step 3: Thread the brief through**

In `packages/class-prep/src/prompts.ts`, add the parameter and append the brief last:

```ts
export function plannerUser(
  topic: string,
  klass: number,
  minutes: number,
  studentLines?: readonly string[],
  /**
   * How a REAL teacher being cloned teaches, from `styleBrief`. Last in the
   * prompt on purpose: it is the voice everything above must come out in,
   * and a model weights the end of its instructions most heavily.
   */
  teacherStyle?: string,
): string {
```

At every `return` in that function, append the brief when it exists. The
simplest shape that keeps both existing returns honest:

```ts
  const withStyle = (body: string): string =>
    teacherStyle && teacherStyle.trim() !== '' ? `${body}\n\n${teacherStyle.trim()}` : body;

  if (!studentLines || studentLines.length === 0) return withStyle(base);

  return withStyle(`${base}

THIS STUDENT — private notes for planning, mirrored from how her live persona
is briefed. Never recite this list, never mention scores or say you are
adapting; a student should feel known, not measured.
${studentLines.map((line) => `- ${line}`).join('\n')}

Teach to it: use the name naturally, the way a teacher does — a greeting, a
question addressed to them — not in every line. Spend the minutes where the
notes say the ground is shaky; what is held securely gets one confident
sentence of recall, not a re-teaching. If a note says they stumbled on
something this topic touches, that is where your first ask belongs.`);
```

In `packages/class-prep/src/prepare.ts`, add to `PrepOptions`:

```ts
  /**
   * How a real teacher being cloned teaches (`styleBrief`). Absent for
   * Qrie's own tutor, which has a persona of her own.
   */
  teacherStyle?: string;
```

and pass it:

```ts
  const raw = await planner.complete(
    PLANNER_SYSTEM,
    plannerUser(topic, klass, minutes, opts.studentLines, opts.teacherStyle),
  );
```

- [ ] **Step 4: Run the whole class-prep suite**

Run: `npx vitest run packages/class-prep && npm run typecheck`
Expected: PASS — including the repair-round tests, which must be unaffected.

- [ ] **Step 5: Commit**

```bash
git add packages/class-prep
git commit -m "feat: the planner can write as a real teacher"
```

---

### Task 4: VideoAvatar

The renderer that plays the lip-dubbed clip for the line being spoken and holds the idle loop between lines. It reads the same `avatarBus` the penguin reads, so the voice pipeline does not learn a new word.

**Files:**
- Create: `apps/classroom/src/avatar/VideoAvatar.tsx`
- Create: `apps/classroom/src/avatar/clips.ts`
- Test: `apps/classroom/tests/clips.test.ts`

**Interfaces:**
- Consumes: `progress()` from `./avatarBus`; `parseClipManifest`, `clipFileName`, `CLIP_DIR`, `CLIP_MANIFEST_FILE` from `@ai-tutor/teacher-clone`; `hashNarration` from `@ai-tutor/voice`.
- Produces: `clipFor(manifest, baseUrl, beatId, narration): string | null` in `clips.ts`, and `<VideoAvatar manifest baseUrl className />`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/classroom/tests/clips.test.ts
import { describe, expect, it } from 'vitest';
import { hashNarration } from '@ai-tutor/voice';
import { clipFor } from '../src/avatar/clips';
import type { ClipManifest } from '@ai-tutor/teacher-clone';

const narration = 'Water leaves the puddle without ever boiling.';
const manifest: ClipManifest = {
  formatVersion: 1,
  lessonId: 'l',
  teacher: 'sharma',
  idle: 'idle.mp4',
  beats: { b1: { file: 'b1.mp4', durationMs: 3000, hash: hashNarration(narration) } },
};

describe('which clip plays', () => {
  it('plays the take rendered for exactly these words', () => {
    expect(clipFor(manifest, '/x', 'b1', narration)).toBe('/x/clips/b1.mp4');
  });

  it('refuses a take rendered for different words — the lips would lie', () => {
    expect(clipFor(manifest, '/x', 'b1', 'Some other sentence entirely.')).toBeNull();
  });

  it('has nothing for a beat that was never rendered', () => {
    expect(clipFor(manifest, '/x', 'b2', narration)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/classroom/tests/clips.test.ts`
Expected: FAIL — cannot resolve `../src/avatar/clips`.

- [ ] **Step 3: Write the chooser and the component**

```ts
// apps/classroom/src/avatar/clips.ts
import { hashNarration } from '@ai-tutor/voice';
import { CLIP_DIR, type ClipManifest } from '@ai-tutor/teacher-clone';

/**
 * The clip for a beat, or null.
 *
 * Null is the ordinary answer, not an error: a beat nobody rendered, or a
 * beat whose words changed since it was rendered. Both mean the idle loop —
 * the teacher listening — which is honest. A take whose lips say the old
 * sentence is not.
 */
export function clipFor(
  manifest: ClipManifest,
  baseUrl: string,
  beatId: string,
  narration: string,
): string | null {
  const entry = manifest.beats[beatId];
  if (!entry) return null;
  if (entry.hash !== hashNarration(narration)) return null;
  return `${baseUrl}/${CLIP_DIR}/${entry.file}`;
}
```

```tsx
// apps/classroom/src/avatar/VideoAvatar.tsx
import { useEffect, useRef } from 'react';
import { CLIP_DIR, type ClipManifest } from '@ai-tutor/teacher-clone';
import { progress } from './avatarBus';
import { clipFor } from './clips';

/**
 * A REAL TEACHER, LIP-DUBBED.
 *
 * The second renderer behind the same seam the penguin uses: it asks the bus
 * what line is being spoken and shows the take rendered for exactly those
 * words. Between lines — and whenever there is no honest take — it holds the
 * idle loop, which reads as the teacher listening rather than as a freeze.
 *
 * The clip is not seeked to match the audio. Both were made from the same
 * synthesised line and start together; seeking a video element every frame
 * costs more than the drift it would fix.
 */
export function VideoAvatar({
  manifest,
  baseUrl,
  beatId,
  className,
}: {
  manifest: ClipManifest;
  /** Where this lesson's folder lives, e.g. "/class9-tissues". */
  baseUrl: string;
  /** The beat the class is on, from the player. */
  beatId: string | null;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const idleUrl = `${baseUrl}/${CLIP_DIR}/${manifest.idle}`;
  const showing = useRef<string>('');

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      raf = requestAnimationFrame(tick);
      const el = videoRef.current;
      if (!el) return;
      const p = progress();
      const speaking =
        p.text !== '' && beatId ? clipFor(manifest, baseUrl, beatId, p.text) : null;
      const want = speaking ?? idleUrl;
      if (want === showing.current) return;
      showing.current = want;
      el.src = want;
      el.loop = want === idleUrl;
      void el.play().catch(() => undefined);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [manifest, baseUrl, beatId, idleUrl]);

  return (
    <video
      ref={videoRef}
      className={className}
      // The class's audio comes from the voice pipeline; the clip's own track
      // would be the same words twice, a fraction of a second apart.
      muted
      playsInline
      autoPlay
      aria-hidden
    />
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/classroom && npm run typecheck`
Expected: PASS — 446 tests plus the three new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/classroom/src/avatar apps/classroom/tests/clips.test.ts
git commit -m "feat: a lip-dubbed teacher behind the penguin's own seam"
```

---

### Task 5: The tile chooses its renderer

**Files:**
- Modify: `apps/classroom/src/ui/TutorTile.tsx`
- Modify: `apps/classroom/src/screens/ClassRoom.tsx` (pass the clip manifest down; nothing else)
- Test: `apps/classroom/tests/tutor-tile.test.tsx`

**Interfaces:**
- Consumes: `ClipManifest` from Task 1, `VideoAvatar` from Task 4.
- Produces: `TutorTile` gains `clone?: { manifest: ClipManifest; baseUrl: string; beatId: string | null }`. Absent — every existing call site — renders the penguin exactly as today.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/classroom/tests/tutor-tile.test.tsx
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TutorTile } from '../src/ui/TutorTile';
import type { ClipManifest } from '@ai-tutor/teacher-clone';

const manifest: ClipManifest = {
  formatVersion: 1, lessonId: 'l', teacher: 'sharma', idle: 'idle.mp4', beats: {},
};

describe('which face the tile shows', () => {
  it('shows the penguin when no clone is given — Qrie keeps her mascot', () => {
    const html = renderToStaticMarkup(<TutorTile mode="teaching" variant="rail" />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<video');
  });

  it('shows the teacher when a clone is given', () => {
    const html = renderToStaticMarkup(
      <TutorTile mode="teaching" variant="rail" clone={{ manifest, baseUrl: '/x', beatId: 'b1' }} />,
    );
    expect(html).toContain('<video');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/classroom/tests/tutor-tile.test.tsx`
Expected: FAIL — `clone` is not a prop of `TutorTile`.

- [ ] **Step 3: Add the prop**

In `TutorTile.tsx`, add the optional prop and swap only the avatar element:

```tsx
import { VideoAvatar } from '../avatar/VideoAvatar';
import type { ClipManifest } from '@ai-tutor/teacher-clone';

export function TutorTile({
  mode,
  variant,
  clone,
}: {
  mode: TutorMode;
  variant: 'pip' | 'rail';
  /**
   * A real teacher's lip-dubbed take. Absent — every ordinary class — the
   * penguin plays, because he is Qrie's own tutor and this is a second
   * renderer, not a replacement.
   */
  clone?: { manifest: ClipManifest; baseUrl: string; beatId: string | null };
}) {
```

and where `<CartoonAvatar ... />` is rendered:

```tsx
      {clone ? (
        <VideoAvatar
          manifest={clone.manifest}
          baseUrl={clone.baseUrl}
          beatId={clone.beatId}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <CartoonAvatar pose={pose} className="absolute inset-0 w-full h-full" />
      )}
```

In `ClassRoom.tsx`, accept an optional `clone` prop of the same shape minus
`beatId` and pass it to both `TutorTile` call sites with
`beatId: player.beat?.id ?? null`. Change nothing else in that file.

- [ ] **Step 4: Run everything**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/classroom
git commit -m "feat: the tile shows the teacher when there is one, the penguin otherwise"
```

---

## Phase B — the VM, the clones, the demo

Phase B needs two things Phase A does not: the 10-minute videos, and a GPU.
Do Task 6 FIRST — before touching the video, before writing the service —
because a quota block changes the plan and it is invisible until asked.

### Task 6: Prove the GPU exists

- [ ] **Step 1: Read the current quota**

On Aarav's machine, signed in to the client-funded subscription:

```bash
az login
az account show --output table
az vm list-usage --location centralindia --output table | grep -i -E "NC|ND|NV|Standard.*Family"
az vm list-usage --location eastus --output table | grep -i -E "NC|ND|NV|Standard.*Family"
```

Expected on a new subscription: several GPU families showing `CurrentValue 0`,
`Limit 0`. A `Limit` of 0 means **no GPU can be created at all** until a
quota increase is approved.

- [ ] **Step 2: Ask for the smallest thing that works**

If any family shows `Limit 0`, raise a quota request in the portal for
**Standard NCASv3_T4 Family vCPUs = 4** (one `Standard_NC4as_T4_v3`) in the
cheapest region that has it, and note the ticket number. Ask for T4 rather
than A100: it is the SKU most often approved same-day, and MuseTalk fits.

- [ ] **Step 3: Record the answer in the plan**

Write the outcome — region, SKU, limit, hourly price — into this file under
Task 6 before continuing. Every later task depends on which SKU we got.

- [ ] **Step 4: If it is blocked**

Two exits, in order: Azure ML compute (a separate quota pool — check with
`az ml compute list-usage`), then a hosted render service for the demo only.
Say so out loud rather than waiting on a ticket.

### Task 7: The clone service on the VM

Concrete steps depend on the SKU from Task 6, so they are written when that
answer exists. The shape is fixed: one FastAPI service, three routes —
`POST /transcribe` (Whisper), `POST /speak` (cloned TTS, text in, wav out),
`POST /dub` (wav + source loop in, mp4 out via MuseTalk) — reached from the
laptop over the SSH tunnel Aarav opens, so nothing is exposed publicly.

### Task 8: The voice bake-off

Three sentences — one plain English, one Hinglish with a technical term, one
question — through Fish S1, ElevenLabs, and the VM's own model, from the same
reference audio. Listen. Pick. Wire the winner behind `TtsAdapter` and keep
the runner-up as its fallback, exactly as `createStreamingTts` already takes
one.

### Task 9: Render the demo

Prepare one class with `teacherStyle` set, synthesise every line in the
cloned voice, render one 15-second clip and LOOK AT IT before rendering the
rest, then render the remainder, write `clips.json`, and record the class.

---

## Self-review notes

- **Spec coverage:** style clone → Tasks 2, 3. Voice clone → Task 8. Avatar →
  Tasks 1, 4, 5, 7, 9. The Qrie seam → Tasks 4, 5. Consent and licences →
  Global Constraints. Azure risk → Task 6, first in Phase B.
- **Deliberately deferred:** Tasks 7 and 9 carry shape but not commands,
  because both depend on the SKU Task 6 discovers. This is a real dependency,
  not a placeholder — Task 6 ends by writing the answer into this file.
- **Names checked across tasks:** `clipFor`, `parseClipManifest`,
  `clipFileName`, `styleBrief`, `parseStyleCard`, `plannerUser`,
  `PrepOptions.teacherStyle`, `TutorTile.clone` are used consistently.
