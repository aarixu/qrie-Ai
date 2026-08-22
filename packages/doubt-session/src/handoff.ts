import type { AgentAdapter } from './agent';
import type { DoubtContext } from './context';

export type HandoffState =
  | 'PLAYING'
  | 'PAUSING'
  | 'AGENT_ENTERING'
  | 'LIVE'
  | 'AGENT_LEAVING'
  | 'RESUMING';

export type HandoffEvent = 'statechange' | 'agent-say';

export interface HandoffOptions {
  agent: AgentAdapter;
  /** How bridge lines and agent lines get voiced. Resolves when spoken. */
  speak(text: string): Promise<void>;
  /** Pause the recording (called during PAUSING). */
  onPause(): void;
  /** Resume the recording (called during RESUMING). */
  onResume(): void;
  /** Canvas jump during LIVE. */
  onRecall?(beatId: string): void;
}

export interface Handoff {
  readonly state: HandoffState;
  /** Legal only from PLAYING; otherwise a no-op (a double-tap must not crash a class). */
  raiseHand(ctx: DoubtContext): void;
  /** Forward a student message to the live session. No-op outside LIVE. */
  sendUserText(text: string): void;
  /** Manual end; the agent's io.done() ends it too. */
  endDoubt(): void;
  on(event: HandoffEvent, cb: (payload?: string) => void): () => void;
}

/**
 * STUB — replaced by the doubt-session builder. The full contract, including
 * the state diagram, lives in packages/doubt-session/README.md.
 */
export function createHandoff(_opts: HandoffOptions): Handoff {
  throw new Error('@ai-tutor/doubt-session createHandoff: not implemented yet');
}
