import type { AgentAdapter, AgentIO, AgentSession, DoubtContext } from '@ai-tutor/doubt-session';

/**
 * The real live doubt tutor: Gemini behind the same AgentAdapter the stub
 * implements. The whole seam (bridges, states, recall wiring) stays in
 * @ai-tutor/doubt-session and does not know this exists.
 *
 * Reliability rules, in order of importance:
 *  1. The class must NEVER get stuck — any API failure says a friendly line
 *     and hands back to the recording (io.done()).
 *  2. After stop(), no io calls — same discipline the stub proves in tests.
 *  3. recallBeatId is only trusted if it names a beat the student has seen.
 */

export interface GeminiAgentOptions {
  apiKey: string;
  model?: string;
}

interface AgentReply {
  say: string;
  recallBeatId: string | null;
  done: boolean;
}

/** What the model must return. Kept strict so the UI never renders prose soup. */
export function buildDoubtSystemPrompt(ctx: DoubtContext): string {
  const beats = ctx.recentBeats.map((b) => `- id "${b.id}": ${b.topic}`).join('\n');
  return [
    'You are a warm, patient Indian school tutor in a LIVE doubt session. A student watching a pre-recorded class just raised their hand. The recording is paused; you have taken over the room.',
    '',
    `CURRENT MOMENT: the class was on "${ctx.beatTopic}".`,
    'WHAT THE CLASS HAS COVERED SO FAR (the recording transcript):',
    ctx.transcriptSoFar,
    '',
    'MOMENTS YOU CAN PULL BACK ON SCREEN (recall targets — only these ids are valid):',
    beats,
    '',
    'RULES:',
    '- Speak clear, simple English. 20-60 words per turn — this is spoken aloud by TTS. No markdown, no lists, no stage directions.',
    '- Answer ONLY from the class content and standard school science. If the question is far outside this lesson, gently steer back.',
    '- When an earlier diagram would help your explanation, set recallBeatId to that beat id — the canvas will jump to it.',
    '- When the student confirms they understood (or asks nothing more), set done=true with a short closing line.',
    '- NEVER invent a recallBeatId that is not in the list above.',
    '',
    'Respond with ONLY a JSON object: {"say": string, "recallBeatId": string | null, "done": boolean}',
  ].join('\n');
}

/** Parse + sanitise a model reply. Unknown recall ids are dropped, never trusted. */
export function parseAgentReply(raw: string, validBeatIds: ReadonlySet<string>): AgentReply {
  const fallback: AgentReply = {
    say: raw.replace(/```(?:json)?|```/g, '').trim().slice(0, 400),
    recallBeatId: null,
    done: false,
  };
  try {
    const cleaned = raw.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<AgentReply>;
    if (typeof parsed.say !== 'string' || parsed.say.length === 0) return fallback;
    const recall =
      typeof parsed.recallBeatId === 'string' && validBeatIds.has(parsed.recallBeatId)
        ? parsed.recallBeatId
        : null;
    return { say: parsed.say, recallBeatId: recall, done: parsed.done === true };
  } catch {
    return fallback;
  }
}

export function createGeminiAgent(opts: GeminiAgentOptions): AgentAdapter {
  const model = opts.model ?? 'gemini-3.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;

  return {
    start(ctx: DoubtContext, io: AgentIO): AgentSession {
      let stopped = false;
      const controller = new AbortController();
      const validIds = new Set(ctx.recentBeats.map((b) => b.id));
      const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

      const call = async (userText: string): Promise<AgentReply> => {
        history.push({ role: 'user', parts: [{ text: userText }] });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildDoubtSystemPrompt(ctx) }] },
            contents: history,
            generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
          }),
        });
        if (!res.ok) throw new Error(`Gemini ${res.status}`);
        const data = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        history.push({ role: 'model', parts: [{ text }] });
        return parseAgentReply(text, validIds);
      };

      const deliver = async (reply: AgentReply): Promise<void> => {
        if (stopped) return;
        if (reply.recallBeatId) io.recall(reply.recallBeatId);
        await io.say(reply.say);
        if (reply.done && !stopped) io.done();
      };

      // One promise chain so replies can never interleave out of order.
      let chain = Promise.resolve();
      const enqueue = (userText: string): void => {
        chain = chain
          .then(async () => {
            if (stopped) return;
            await deliver(await call(userText));
          })
          .catch(async () => {
            // Rule 1: a failed call must hand the room back, never hold it.
            if (stopped) return;
            await io.say("Hmm, I'm having trouble connecting right now. Let's continue the class — try raising your hand again in a bit.");
            if (!stopped) io.done();
          });
      };

      // Open the session: the model greets and invites the doubt.
      enqueue(
        `(The student just raised their hand during "${ctx.beatTopic}" and hasn't typed yet. Greet them in one short line and invite the doubt.)`,
      );

      return {
        sendUserText(text: string): void {
          if (!stopped) enqueue(text);
        },
        stop(): void {
          stopped = true;
          controller.abort();
        },
      };
    },
  };
}
