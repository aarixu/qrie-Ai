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
 * A deterministic scripted agent for dev and tests. It exercises every part of
 * the seam a real agent will use — say, recall, done — without any AI, so the
 * whole handoff is provable before Gemini Live exists.
 *
 * Script: greet on the current topic; if an earlier beat exists, recall it
 * unprompted (the product's party trick, demonstrated on every run); answer
 * the first student message; close and hand back on the second.
 */
export function createStubAgent(): AgentAdapter {
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

      enqueue(() =>
        io.say(`Haan, main sun raha hoon. '${ctx.beatTopic}' ke baare mein kya poochhna hai? Bolo.`),
      );
      if (prev !== null) {
        enqueue(async () => {
          io.recall(prev.id);
          await io.say(
            `Yaad karo, isse pehle humne '${prev.topic}' dekha tha — wahi wapas le aaya hoon screen pe, isse jodkar samjhenge.`,
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
                `Achha sawaal hai, yahan confusion hona bilkul natural hai. Dekho, '${ctx.beatTopic}' ko aise samjho — jo screen pe hai usko dhyaan se dekho, main step by step samjhata hoon.`,
              ),
            );
          } else if (userMessages === 2) {
            enqueue(async () => {
              await io.say(`Badhiya, lagta hai clear ho gaya. Chalo, class aage badhaate hain.`);
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
