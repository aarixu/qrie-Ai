import { describe, expect, it } from 'vitest';
import { TUTOR } from '../src/traits';
import { buildSystemPrompt, type Surface } from '../src/prompt';

/**
 * WHO SHE IS, AS DATA: a name, a role, how she sounds, and the voice her words
 * are synthesised with. Her character itself is the v3 core (meera.ts), which
 * every prompt opens on; the old values and never-lists were retired with it.
 */

describe('TUTOR traits', () => {
  it('has an identity filled in', () => {
    expect(TUTOR.name).toBe('Meera');
    expect(TUTOR.role.trim().length).toBeGreaterThan(0);
    expect(TUTOR.voice.trim().length).toBeGreaterThan(0);
  });

  it('is a friendly teacher, and names no AI, students, class or syllabus (Aarav, 2026-10-10)', () => {
    expect(TUTOR.role).not.toMatch(/\bAI\b|students?|class\s*\d|CBSE|NCERT|syllabus/i);
    expect(Object.keys(TUTOR).sort()).toEqual(['name', 'role', 'speechVoiceName', 'voice']);
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
