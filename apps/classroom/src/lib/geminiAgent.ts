import {
  buildDoubtBrief,
  isRecallable,
  type AgentAdapter,
  type AgentIO,
  type AgentSession,
  type DoubtContext,
} from '@ai-tutor/doubt-session';
import type { StudentContext } from '@ai-tutor/persona';
import { relayFetch } from './relay';
import { createOutcomeLookup } from './outcomeLookup';

/**
 * The real TYPED doubt tutor, behind the same AgentAdapter the stub
 * implements. The whole seam (bridges, states, recall wiring) stays in
 * @ai-tutor/doubt-session and does not know this exists.
 *
 * Two transports, one session. Google direct is the original; OpenRouter is
 * the same models reached through one key, which is what keeps this working
 * while a Google project is blocked. Only the HTTP call differs — the promise
 * chain, the stop discipline and the reply sanitising are the valuable part
 * and must not be written twice.
 *
 * Reliability rules, in order of importance:
 *  1. The class must NEVER get stuck — any API failure says a friendly line
 *     and hands back to the recording (io.done()).
 *  2. After stop(), no io calls — same discipline the stub proves in tests.
 *  3. recallBeatId is only trusted if it names a beat the student has seen.
 */

export interface GeminiAgentOptions {
  /**
   * Only the DIRECT providers need one, and those are dev-only paths now.
   * The relay carries no key at all — that is the whole point of it.
   */
  apiKey?: string;
  /** Who is in front of her, forwarded to the persona exactly as measured. */
  student: StudentContext;
  model?: string;
  /**
   * Where the model is reached. 'gemini' is Google's own endpoint; 'openrouter'
   * is the same class of model through OpenRouter's one key.
   */
  provider?: 'relay' | 'gemini' | 'openrouter';
  /**
   * Who answers when the model cannot.
   *
   * A raised hand that ends in "having trouble connecting" is worse than a
   * short scripted answer that at least belongs to the lesson — and until the
   * relay is deployed, a built app has nothing behind /api/llm at all.
   */
  fallback?: AgentAdapter;
}

/** One turn of the conversation, in this file's own vocabulary. */
export interface Turn {
  role: 'user' | 'model';
  text: string;
}

/** What a transport must do: a system prompt and the turns so far, in, reply text out. */
export type Transport = (system: string, turns: readonly Turn[], signal: AbortSignal) => Promise<string>;

const DEFAULT_MODEL = {
  // The relay speaks OpenRouter's shape today and Gemini's tomorrow; either
  // way the browser names a model, never a vendor account.
  relay: 'google/gemini-3-flash-preview',
  gemini: 'gemini-3.7-flash',
  // OpenRouter names the same family with a vendor prefix.
  openrouter: 'google/gemini-3-flash-preview',
} as const;

export function createTransport(opts: GeminiAgentOptions): Transport {
  const provider = opts.provider ?? 'relay';
  const model = opts.model ?? DEFAULT_MODEL[provider];

  /**
   * THE ONE THAT SHIPS.
   *
   * Same origin, no key, no vendor in the browser at all — the server holds
   * the credential and decides what this student may spend. The two direct
   * transports below predate this and are dev-only now: Vite inlines every
   * VITE_ variable, so a key read in the browser is a key printed into
   * dist/assets/index-*.js for anyone who unzips the APK.
   */
  if (provider === 'relay') {
    return async (system, turns, signal) => {
      const res = await relayFetch('/api/llm', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          temperature: 0.7,
          messages: [
            { role: 'system', content: system },
            ...turns.map((t) => ({
              role: t.role === 'model' ? 'assistant' : 'user',
              content: t.text,
            })),
          ],
        }),
      });
      // Parsed defensively and AFTER the status is known: a gateway error
      // body is often HTML or empty, and letting JSON.parse throw first would
      // replace a useful "LLM 502" with a SyntaxError.
      const data = (await res.json().catch(() => ({}))) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(`LLM ${res.status}: ${data.error?.message ?? 'no detail'}`);
      // A 200 carrying an error body is how upstream failures arrive.
      if (data.error) throw new Error(data.error.message ?? 'unknown LLM error');
      return data.choices?.[0]?.message?.content ?? '';
    };
  }

  if (provider === 'openrouter') {
    return async (system, turns, signal) => {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${opts.apiKey}`,
          'X-Title': 'Curie',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            ...turns.map((t) => ({
              role: t.role === 'model' ? 'assistant' : 'user',
              content: t.text,
            })),
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
        }),
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      // OpenRouter reports upstream failures as a 200 with an error body.
      if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? 'unknown error'}`);
      return data.choices?.[0]?.message?.content ?? '';
    };
  }

  if (!opts.apiKey) throw new Error('The direct providers need a key; use the relay instead.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;
  return async (system, turns, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  };
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
    buildDoubtBrief(ctx, student, {
      moment: 'answering',
      surface: 'text',
      // She is told the outcome this beat is for, and what it rests on.
      outcomes: createOutcomeLookup(),
    }),
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
  const transport = createTransport(opts);

  return {
    start(ctx: DoubtContext, io: AgentIO): AgentSession {
      let stopped = false;
      const controller = new AbortController();
      const history: Turn[] = [];
      // Started only if the model actually fails, so the ordinary path costs
      // nothing for a safety net it never touches.
      let relief: AgentSession | null = null;
      if (opts.fallback) relief = opts.fallback.start(ctx, io);

      const call = async (userText: string): Promise<AgentReply> => {
        history.push({ role: 'user', text: userText });
        const text = await transport(
          buildDoubtSystemPrompt(ctx, opts.student),
          history,
          controller.signal,
        );
        history.push({ role: 'model', text });
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
            if (relief) {
              // The scripted tutor takes the question instead. Same persona,
              // same room, and the student gets an answer rather than an
              // apology about our plumbing.
              relief.sendUserText(userText);
              return;
            }
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
          relief?.stop();
        },
      };
    },
  };
}
