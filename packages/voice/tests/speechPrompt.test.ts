import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT,
  DEFAULT_SPEAKER_NAME,
  SPEECH_PREAMBLE,
  TRANSCRIPT_LABEL,
  buildSpeechPrompt,
} from '../src/speechPrompt';

const NARRATION = 'Blood is a tissue, not just a red liquid. Watch what settles.';

describe('buildSpeechPrompt', () => {
  it('opens with the preamble that stops the notes being read aloud', () => {
    const prompt = buildSpeechPrompt(NARRATION);
    expect(prompt.startsWith(SPEECH_PREAMBLE)).toBe(true);
  });

  it('labels where the spoken text begins, and puts the text after it', () => {
    const prompt = buildSpeechPrompt(NARRATION);
    const label = prompt.indexOf(TRANSCRIPT_LABEL);
    expect(label).toBeGreaterThan(0);
    expect(prompt.indexOf(NARRATION)).toBeGreaterThan(label);
  });

  it('never loses, rewrites or truncates the caller’s words', () => {
    const long = `${NARRATION} ${'One more sentence about plasma. '.repeat(20)}`.trim();
    expect(buildSpeechPrompt(long)).toContain(long);
  });

  it('carries an audio profile and all three director’s notes', () => {
    const prompt = buildSpeechPrompt(NARRATION);
    expect(prompt).toContain(`# AUDIO PROFILE: ${DEFAULT_SPEAKER_NAME}`);
    expect(prompt).toContain("### DIRECTOR'S NOTES");
    expect(prompt).toContain('Style: ');
    expect(prompt).toContain('Pacing: ');
    expect(prompt).toContain(`Accent: ${DEFAULT_ACCENT}`);
  });

  it('directs a specific Indian English rather than a generic accent', () => {
    const prompt = buildSpeechPrompt(NARRATION);
    expect(prompt).toContain('Indian English as spoken by an educated schoolteacher');
    expect(prompt).not.toMatch(/Accent: Indian accent/);
  });

  it('names the lesson and the beat in the scene when both are known', () => {
    const prompt = buildSpeechPrompt(NARRATION, {
      lessonTitle: 'Blood & Its Components',
      beatTopic: 'What blood is',
    });
    expect(prompt).toContain('"Blood & Its Components"');
    expect(prompt).toContain('"What blood is"');
  });

  it('still sets a scene when the live path knows neither', () => {
    const prompt = buildSpeechPrompt(NARRATION);
    expect(prompt).toContain('## THE SCENE');
    expect(prompt).toContain('A classroom.');
    expect(prompt).not.toContain('undefined');
    // A normal classroom pace (Aarav, 2026-10-02), not the slow, soothing one.
    expect(prompt).not.toMatch(/no hurry|unhurried|vocal smile/i);
  });

  it('lets a caller override the persona and the notes', () => {
    const prompt = buildSpeechPrompt(NARRATION, {
      speakerName: 'Meera',
      speakerDescription: 'a warm teacher',
      scene: 'A revision session at seven in the evening.',
      style: 'Brisk.',
      pacing: 'Quick.',
      accent: 'Neutral.',
    });
    expect(prompt).toContain('# AUDIO PROFILE: Meera');
    expect(prompt).toContain('A revision session at seven in the evening.');
    expect(prompt).toContain('Style: Brisk.');
    expect(prompt).toContain('Pacing: Quick.');
    expect(prompt).toContain('Accent: Neutral.');
    expect(prompt).not.toContain(DEFAULT_ACCENT);
  });

  it('is deterministic — the same beat renders the same prompt every time', () => {
    const style = { lessonTitle: 'Blood', beatTopic: 'Plasma' };
    expect(buildSpeechPrompt(NARRATION, style)).toBe(buildSpeechPrompt(NARRATION, style));
  });
});
