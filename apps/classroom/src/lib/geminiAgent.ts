import {
  buildDoubtBrief,
  isRecallable,
  type AgentAdapter,
  type AgentIO,
  type AgentSession,
  type DoubtContext,
} from '@ai-tutor/doubt-session';
import type { StudentContext } from '@ai-tutor/persona';

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
  /** Who is in front of her, forwarded to the persona exactly as measured. */
  student: StudentContext;
  model?: string;
}

interface AgentReply {
  say: string;
  recallBeatId: string | null;
  done: boolean;
}

/**
 * The briefing, plus the one instruction the persona cannot give: the JSON
 * shape this transport needs back. Her character, her rules and the legal
 * recall targets all come from @ai-tutor/persona — nothing about who she is
 * is written here.
 */
export function buildDoubtSystemPrompt(ctx: DoubtContext, student: StudentContext): string {
  return [
    buildDoubtBrief(ctx, student, { moment: 'answering', surface: 'text' }),
    '',
    'Respond with ONLY a JSON object: {"say": string, "recallBeatId": string | null, "done": boolean}',
    'Set recallBeatId to bring an earlier moment back onto the board, or null. Set done to true once the doubt is resolved.',
  ].join('\n');
}

/** Parse + sanitise a model reply. Unknown recall ids are dropped, never trusted. */
export function parseAgentReply(raw: string, canRecall: (beatId: string) => boolean): AgentReply {
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
      typeof parsed.recallBeatId === 'string' && canRecall(parsed.recallBeatId)
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
      const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

      const call = async (userText: string): Promise<AgentReply> => {
        history.push({ role: 'user', parts: [{ text: userText }] });
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: buildDoubtSystemPrompt(ctx, opts.student) }] },
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
        return parseAgentReply(text, (id) => isRecallable(ctx, id));
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

      // No opening line: the handoff already spoke the bridge line in her
      // voice before this session existed. See the same note in liveAgent.ts.

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
