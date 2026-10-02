import { TUTOR } from '@ai-tutor/persona';

/**
 * THE TEXT PART OF EVERY TTS CALL — and therefore the tutor's voice.
 *
 * Gemini TTS has no style parameter. Tone, pacing and accent are steered by
 * prose sitting in the same text part as the words to be spoken, so this
 * function is not formatting: it is the difference between a schoolteacher and
 * a station announcement. The recorded class and any line synthesised live
 * must be built by this one function, or the student hears one teacher in the
 * recording and a slightly different one the moment they raise a hand — which
 * is exactly the seam this product exists to hide.
 *
 * THE PREAMBLE AND THE TRANSCRIPT LABEL ARE LOAD-BEARING. Google documents
 * that a vague prompt can make the model read the director's notes aloud or
 * reject the request outright (PROHIBITED_CONTENT), and names an explicit
 * preamble plus an explicit transcript label as the mitigation. Short, bland
 * narration lines are precisely the vague prompts that trip it, and a lesson
 * is dozens of them.
 *
 * Field names mirror the labels Google prints in its own template, so a reader
 * can hold the code and the documented shape side by side.
 */

/** Google's prescribed opening line. Without it the notes can be read aloud. */
export const SPEECH_PREAMBLE =
  'Synthesize speech for the transcript below. Do not read these instructions aloud.';

/** Where the spoken words start. The model needs this said explicitly. */
export const TRANSCRIPT_LABEL = '### TRANSCRIPT';

/**
 * The tutor, taken from the persona rather than described again here.
 *
 * TUTOR.voice is deliberately prose — it is the sentence a human would read to
 * understand how she sounds — and that is exactly what a director's note wants,
 * so it is passed straight through to the synthesiser's style block.
 */
export const DEFAULT_SPEAKER_NAME = TUTOR.name;
export const DEFAULT_SPEAKER_DESCRIPTION = TUTOR.voice;

/** Google is explicit that a specific accent direction beats a generic one. */
export const DEFAULT_ACCENT =
  'Indian English as spoken by an educated schoolteacher in Delhi - clear,\nnatural Indian English, not anglicised and not a caricature.';

/**
 * A normal classroom voice, the same notes the live voice carries (relay
 * vertexSpeech.ts, Aarav 2026-10-02: the old warm, unhurried notes made her slow
 * and soothing).
 */
const DEFAULT_STYLE =
  'Clear, confident and natural, the way a good teacher talks in class. Friendly but matter-of-fact: no sing-song, no breathiness, no soothing or dramatic tone.';
const DEFAULT_PACING = 'A normal conversational pace, like everyday speech. Keep it moving, with no long pauses between phrases.';

export interface SpeechStyle {
  /** Name in the audio profile header. Pass `TUTOR.name`. */
  speakerName?: string;
  /** One line on how she sounds. Pass `TUTOR.voice`. */
  speakerDescription?: string;
  /** Lesson title, used to set the scene. Omitted when unknown. */
  lessonTitle?: string;
  /** What this beat is about. Omitted when unknown — the live path rarely has it. */
  beatTopic?: string;
  /** Replaces the generated scene entirely, for a beat that needs its own room. */
  scene?: string;
  /** Director's note printed as "Style:". */
  style?: string;
  /** Director's note printed as "Pacing:". */
  pacing?: string;
  /** Director's note printed as "Accent:". */
  accent?: string;
}

/**
 * The scene is written in the third person about a real room, because that is
 * the form Google's own examples take and the model is visibly steadier with a
 * situation than with an adjective.
 */
function describeScene(style: SpeechStyle): string {
  const { lessonTitle, beatTopic } = style;
  if (lessonTitle !== undefined && beatTopic !== undefined) {
    return [
      `A classroom. She is at the board teaching "${lessonTitle}", and this moment`,
      `is about "${beatTopic}". She is talking directly to the one student in front of her.`,
    ].join('\n');
  }
  if (lessonTitle !== undefined) {
    return [
      `A classroom. She is at the board teaching "${lessonTitle}", talking directly to`,
      'the one student in front of her.',
    ].join('\n');
  }
  return 'A classroom. She is at the board, talking directly to the one student in front of her.';
}

/**
 * Builds the whole text part: preamble, audio profile, scene, director's notes,
 * then the transcript under its own label.
 *
 * The caller's text is passed through untouched apart from trimming — never
 * summarised, never rewritten, never truncated. What the lesson says is what
 * the student hears.
 */
export function buildSpeechPrompt(text: string, style: SpeechStyle = {}): string {
  return [
    SPEECH_PREAMBLE,
    `# AUDIO PROFILE: ${style.speakerName ?? DEFAULT_SPEAKER_NAME}`,
    `## ${style.speakerDescription ?? DEFAULT_SPEAKER_DESCRIPTION}`,
    '## THE SCENE',
    style.scene ?? describeScene(style),
    "### DIRECTOR'S NOTES",
    `Style: ${style.style ?? DEFAULT_STYLE}`,
    `Pacing: ${style.pacing ?? DEFAULT_PACING}`,
    `Accent: ${style.accent ?? DEFAULT_ACCENT}`,
    TRANSCRIPT_LABEL,
    text.trim(),
  ].join('\n');
}
