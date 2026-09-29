import { describe, expect, it } from 'vitest';
import { TUTOR } from '../src/traits';
import { MOMENTS, momentGuidance } from '../src/moments';
import { describeFactors } from '../src/factors';
import { buildSystemPrompt, type Surface } from '../src/prompt';

/**
 * The persona's two lists are prose, so the only thing a test can hold them to
 * is internal consistency. That turns out to be the failure that matters: a
 * persona rots by saying the same thing twice in two voices, or by breaking its
 * own ban somewhere further down the file.
 */

const normalise = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

describe('TUTOR traits', () => {
  it('has an identity and both behaviour lists filled in', () => {
    expect(TUTOR.name.trim().length).toBeGreaterThan(0);
    expect(TUTOR.role.trim().length).toBeGreaterThan(0);
    expect(TUTOR.voice.trim().length).toBeGreaterThan(0);
    expect(TUTOR.values.length).toBeGreaterThan(0);
    expect(TUTOR.neverDoes.length).toBeGreaterThan(0);
    for (const line of [...TUTOR.values, ...TUTOR.neverDoes]) {
      expect(line.trim().length).toBeGreaterThan(0);
    }
  });

  it('never states the same commitment twice', () => {
    const all = [...TUTOR.values, ...TUTOR.neverDoes].map(normalise);
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps commitments positive and prohibitions negative', () => {
    // A behaviour described once as a value and once as a ban is the classic
    // way these two lists start contradicting each other.
    for (const line of TUTOR.neverDoes) expect(normalise(line)).toContain('never');
    for (const line of TUTOR.values) expect(normalise(line)).not.toContain('never');
  });

  it('does not use the phrases it bans anywhere else in the persona', () => {
    // The bans name these phrases verbatim. If any of them turned up in a value,
    // a moment rule or a factor line, the persona would break its own rule while
    // stating it.
    const banned = [
      'as i said before',
      'obviously',
      'as you know',
      // The stock praise the persona bans: a value or a moment rule that
      // modelled one would be teaching the phrase while forbidding it.
      'great job',
      'great question',
      'well done',
    ];

    const elsewhere = [
      ...TUTOR.values,
      ...MOMENTS.map(momentGuidance),
      ...describeFactors({
        klass: 8,
        mastery: 0.2,
        namedMisconception: 'a placeholder wrong idea',
        doubtCount: 5,
        lastAnswer: 'slow-wrong',
        attendance: { kind: 'returning', daysAway: 3 },
      }),
    ].map(normalise);

    for (const phrase of banned) {
      for (const line of elsewhere) expect(line).not.toContain(phrase);
    }
  });
});

/**
 * The two sides of the seam, as their call sites actually see them: the
 * recorded class is synthesised beat by beat ahead of time (surface
 * `narration`), the live doubt tutor is synthesised in the room while the
 * student waits (surface `voice`). Each needs exactly two things from this
 * package — the words, and the name of the voice that says them.
 */
const speechRequestFor = (surface: Surface): { prompt: string; voiceName: string } => ({
  prompt: buildSystemPrompt({
    moment: surface === 'narration' ? 'TEACHING' : 'DOUBT_ANSWERING',
    student: { klass: 9 },
    surface,
  }),
  voiceName: TUTOR.speechVoiceName,
});

describe('the synthesised voice', () => {
  it('names one prebuilt voice rather than describing one', () => {
    // A speech API takes a voice id, not a sentence; anything with a space in
    // it would be rejected by the synthesiser at the worst possible moment.
    expect(TUTOR.speechVoiceName).toBe('Sulafat');
    expect(TUTOR.speechVoiceName).toMatch(/^[A-Za-z]+$/);
  });

  it('is not the same field as the prose description of how she sounds', () => {
    // Two neighbouring fields with "voice" in the name is exactly the pair a
    // hurried caller confuses, and sending prose to a synthesiser fails loudly
    // while sending a voice id to a reader fails silently.
    expect(TUTOR.voice).not.toBe(TUTOR.speechVoiceName);
    expect(TUTOR.voice.trim().split(/\s+/).length).toBeGreaterThan(3);
  });

  it('gives the recorded narration and the live doubt the same voice', () => {
    const recorded = speechRequestFor('narration');
    const live = speechRequestFor('voice');

    // This is the whole reason the constant exists: mid-lesson the student
    // hears the recording, then the live tutor, minutes apart. Same voice, or
    // the handoff is audibly a second teacher.
    expect(live.voiceName).toBe(recorded.voiceName);
    expect(recorded.voiceName).toBe(TUTOR.speechVoiceName);

    // Same person, different physical form: only the speaking rules differ.
    expect(live.prompt).not.toBe(recorded.prompt);
    expect(live.prompt).toContain(TUTOR.name);
    expect(recorded.prompt).toContain(TUTOR.name);
  });
});
