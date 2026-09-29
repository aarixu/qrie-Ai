import type { DoubtContext } from './context';

/**
 * What an agent may say about one line besides its words.
 *
 * `onStart` is called when her voice actually starts the line — the board
 * reveals that step's ink then (T2.4). The handoff hands it to the speaker and
 * never calls it itself, so a line that is not spoken (the handoff halted, the
 * screen replaced it) reveals nothing. When a voice cannot tell when its sound
 * starts, the app's speaker decides the fallback (apps/classroom
 * lib/voiceStart.ts).
 *
 * `more` says another line of the SAME reply follows, so the turn cap does
 * not close the doubt between two sentences of one answer.
 */
export interface SayOptions {
  onStart?: () => void;
  more?: boolean;
}

/** How an agent talks back to the room. Implemented by the app / handoff. */
export interface AgentIO {
  /** Speak a line (routed to TTS). Resolves when spoken. */
  say(text: string, options?: SayOptions): Promise<void>;
  /** Jump the canvas to an earlier beat's state. */
  recall(beatId: string): void;
  /** Signal that the doubt is resolved — triggers the exit bridge. */
  done(): void;
  /**
   * Start fetching the audio for a line she is about to say, so it is ready
   * when the current one ends. Optional: a voice that cannot prime ignores it.
   * Only for a line that has already been through the reply's safety screen.
   */
  prime?(text: string): void;
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
 * A deterministic scripted agent for dev and tests. It exercises every part of
 * the seam a real agent will use — say, recall, done — without any AI, so the
 * whole handoff is provable before Gemini Live exists.
 *
 * Script: greet on the current topic; if an earlier beat exists, recall it
 * unprompted (the product's party trick, demonstrated on every run); answer
 * the first student message; close and hand back on the second.
 *
 * `opening: false` drops the greeting and the recall, so the script starts at
 * the answer. That is the stub as a RELIEF: started by the typed tutor only
 * when its model fails, by which point the bridge line has been said and the
 * student has already asked. Greeting them again would be a second opening to
 * a doubt that is under way.
 */
export function createStubAgent(options: { opening?: boolean } = {}): AgentAdapter {
  const opening = options.opening ?? true;
  return {
    start(ctx: DoubtContext, io: AgentIO): AgentSession {
      let stopped = false;
      let userMessages = 0;

      // All scripted steps run through one promise chain so lines can never
      // interleave, and every step re-checks `stopped` first — after stop()
      // the stub makes no further io calls, the exact discipline the real
      // adapter must honour too.
      let chain: Promise<void> = Promise.resolve();
      const enqueue = (step: () => void | Promise<void>): void => {
        chain = chain.then(() => (stopped ? undefined : step()));
      };

      // recentBeats includes the current beat as its last entry, so a
      // "previous" moment exists only from the second beat onwards.
      const prev =
        ctx.recentBeats.length >= 2 ? ctx.recentBeats[ctx.recentBeats.length - 2] : null;

      // Her lines here in the child's language too (overnight review #27).
      const hi = ctx.lang === 'hi-en';
      if (opening) {
        enqueue(() =>
          io.say(
            hi
              ? `Main sun rahi hoon. '${ctx.beatTopic}' ke baare mein kya poochna hai? Bolo.`
              : `I'm listening. What would you like to ask about '${ctx.beatTopic}'? Go ahead.`,
          ),
        );
      }
      if (opening && prev !== null) {
        enqueue(async () => {
          io.recall(prev.id);
          await io.say(
            hi
              ? `Yaad hai, isse just pehle humne '${prev.topic}' dekha tha — maine use board pe wapas la diya hai, dono ko jodte hain.`
              : `Remember, just before this we saw '${prev.topic}' — I've brought it back on the board, we'll connect the two.`,
          );
        });
      }

      return {
        sendUserText(): void {
          if (stopped) return;
          userMessages += 1;
          if (userMessages === 1) {
            enqueue(() =>
              io.say(
                hi
                  ? `Achha sawaal — yahan confuse hona bilkul normal hai. Board ko dhyaan se dekho: '${ctx.beatTopic}' ko aise socho, main step by step samjhaati hoon.`
                  : `Good question — it's completely natural to feel confused here. Look at the board carefully: think of '${ctx.beatTopic}' this way, and I'll walk you through it step by step.`,
              ),
            );
          } else if (userMessages === 2) {
            enqueue(async () => {
              await io.say(
                hi ? `Badhiya, lagta hai ab clear hai. Chalo class pe wapas chalte hain.` : `Great, sounds like that's clear now. Let's get back to the class.`,
              );
              // done() usually triggers our own stop() synchronously via the
              // handoff's leaving sequence — re-check before signalling.
              if (!stopped) io.done();
            });
          }
          // Third message onwards: the doubt is already closing — stay quiet.
        },
        stop(): void {
          stopped = true;
        },
      };
    },
  };
}
