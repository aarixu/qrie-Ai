import type { DoubtContext } from './context';

/** How an agent talks back to the room. Implemented by the app / handoff. */
export interface AgentIO {
  /** Speak a line (routed to TTS). Resolves when spoken. */
  say(text: string): Promise<void>;
  /** Jump the canvas to an earlier beat's state. */
  recall(beatId: string): void;
  /** Signal that the doubt is resolved — triggers the exit bridge. */
  done(): void;
}

export interface AgentSession {
  /** Forward a student message (text for now; voice lands with the live agent). */
  sendUserText(text: string): void;
  /** Hard-stop the session (student cancelled / teardown). */
  stop(): void;
}

/** The live agent boundary. Gemini Live implements this later; the stub implements it today. */
export interface AgentAdapter {
  start(ctx: DoubtContext, io: AgentIO): AgentSession;
}

/**
 * STUB — replaced by the doubt-session builder. A deterministic scripted agent:
 * greets referencing ctx.beatTopic, demonstrates one recall() when a previous
 * beat exists, answers one user message generically, then done().
 */
export function createStubAgent(): AgentAdapter {
  throw new Error('@ai-tutor/doubt-session createStubAgent: not implemented yet');
}
