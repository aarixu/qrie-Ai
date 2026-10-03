import type { ReactElement } from 'react';
import type { Element, Tone } from '@ai-tutor/lesson-format';

/** Scene's ink and faces, handed to every tool so a tool never invents a colour. */
export interface ToolTheme {
  ink: string;
  tones: Record<Tone, string>;
  fontHand: string;
  fontMono: string;
}

export interface ToolContext {
  /** Newly in view this beat: animate. Otherwise draw it complete. */
  isNew: boolean;
  theme: ToolTheme;
}

export type ToolElement = Extract<Element, { kind: 'tool' }>;
export type ToolRenderer = (el: ToolElement, ctx: ToolContext) => ReactElement;
