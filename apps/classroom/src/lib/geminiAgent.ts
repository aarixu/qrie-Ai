import {
  buildDoubtBrief,
  isRecallable,
  type AgentAdapter,
  type AgentIO,
  type AgentSession,
  type DoubtContext,
  type SendOptions,
} from '@ai-tutor/doubt-session';
import type { StudentContext } from '@ai-tutor/persona';
import { relayFetch } from './relay';
import { createOutcomeLookup } from './outcomeLookup';
import { masteryFromModel } from './learnerModel';
import { tutorLanguage } from './workspace';
import type { DoubtBoard, RawStep } from './doubtBoard';

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
 *  1. The class must NEVER get stuck — any API failure hands the question to
 *     the scripted relief (`fallback`), or, with none, says a friendly line
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
   *
   * Started on the FIRST failed call and not before; see `start` below.
   */
  fallback?: AgentAdapter;
  /**
   * THE BOARD SHE WRITES ON (T2.4, 2026-09-29). Present, she is shown what is
   * on the board and answers in steps — a sentence and the ink that goes with
   * it — which lib/doubtBoard.ts screens, leak-checks, maths-checks and lays
   * out before a word is said; each step's ink is drawn as her voice starts
   * its sentence. Absent (tests, the scripted stub), she only talks.
   */
  board?: DoubtBoard;
  /**
   * Told what each turn cost in tokens, when the reply says. Relay transport
   * only: the direct dev transports do not read it.
   */
  onUsage?: (usage: TurnUsage) => void;
}

/**
 * One turn's token counts, as the relay's reply reported them.
 *
 * A count the reply did not carry is ABSENT, not zero — a zero here would be
 * read later as a turn that was free.
 */
export interface TurnUsage {
  prompt?: number;
  output?: number;
  thinking?: number;
}

/**
 * The relay's `usage` block, in either vocabulary it arrives in.
 *
 * Vertex's `usageMetadata` is passed through under `usage` as-is
 * (packages/relay/src/vertex.ts, toOpenAiReply), so its names are Google's.
 * The OpenRouter path answers in OpenAI's names. Null when there is nothing
 * countable in it.
 *
 * THE TWO VOCABULARIES COUNT THINKING DIFFERENTLY. Vertex's
 * `candidatesTokenCount` leaves thoughts out and reports them separately as
 * `thoughtsTokenCount`. OpenAI's `completion_tokens` INCLUDES them, itemised
 * under `completion_tokens_details.reasoning_tokens`. So when that item is
 * there, it is reported as thinking and taken out of output, which keeps
 * `output` meaning the same thing whichever path answered.
 */
export function readUsage(usage: unknown): TurnUsage | null {
  if (usage === null || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;
  const finite = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  const count = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const v = finite(u[key]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const read: TurnUsage = {};
  const prompt = count('promptTokenCount', 'prompt_tokens');
  let output = count('candidatesTokenCount');
  let thinking = count('thoughtsTokenCount');
  const completion = finite(u.completion_tokens);
  if (output === undefined && completion !== undefined) {
    const details = u.completion_tokens_details;
    const reasoning =
      details !== null && typeof details === 'object'
        ? finite((details as Record<string, unknown>).reasoning_tokens)
        : undefined;
    output = reasoning !== undefined ? Math.max(0, completion - reasoning) : completion;
    if (thinking === undefined && reasoning !== undefined) thinking = reasoning;
  }
  if (prompt !== undefined) read.prompt = prompt;
  if (output !== undefined) read.output = output;
  if (thinking !== undefined) read.thinking = thinking;
  return Object.keys(read).length > 0 ? read : null;
}

/** One turn of the conversation, in this file's own vocabulary. */
export interface Turn {
  role: 'user' | 'model';
  text: string;
}

/**
 * What a transport hands back: the reply's text, and whether the provider's
 * own filter stopped it.
 *
 * `filtered` is true when the reply's finish_reason is 'content_filter', which
 * is how the relay answers a Vertex policy stop (packages/relay/src/vertex.ts,
 * BLOCKED_FINISH): a 200 whose content is the relay's fixed line rather than
 * an answer. The session must be able to tell the two apart, because a
 * filtered turn is handled differently from an answer (see `call` below), and
 * a filtered reply's text is never spoken (FILTERED_REPLY_LINE).
 */
export interface TransportReply {
  text: string;
  filtered: boolean;
}

/** What a transport must do: a system prompt and the turns so far, in, the reply out. */
export type Transport = (system: string, turns: readonly Turn[], signal: AbortSignal) => Promise<TransportReply>;

/** OpenAI's finish_reason for a reply a content filter stopped. */
const FILTERED_FINISH = 'content_filter';

const DEFAULT_MODEL = {
  // The relay speaks OpenRouter's shape today and Gemini's tomorrow; either
  // way the browser names a model, never a vendor account.
  relay: 'google/gemini-3.7-flash',
  gemini: 'gemini-3.7-flash',
  // OpenRouter names the same family with a vendor prefix.
  openrouter: 'google/gemini-3.7-flash',
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
          // THINKING AT ITS FLOOR (T0.1). One doubt turn is one short line
          // for a child, and with no effort named the relay leaves Vertex on
          // the model's default thinking (packages/relay/src/vertex.ts sets
          // thinkingConfig only when this field is present). 'none' maps to
          // thinking LOW there, which is the floor on a 3.x model: thinking
          // cannot be switched off, only kept this low.
          reasoning_effort: 'none',
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
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        error?: { message?: string };
        usage?: unknown;
      };
      if (!res.ok) throw new Error(`LLM ${res.status}: ${data.error?.message ?? 'no detail'}`);
      // A 200 carrying an error body is how upstream failures arrive.
      if (data.error) throw new Error(data.error.message ?? 'unknown LLM error');
      // Reported for a filtered turn too: the relay passes Vertex's counts
      // through on a block as well (vertex.ts, toOpenAiReply).
      const usage = readUsage(data.usage);
      if (usage !== null) opts.onUsage?.(usage);
      const choice = data.choices?.[0];
      return { text: choice?.message?.content ?? '', filtered: choice?.finish_reason === FILTERED_FINISH };
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
          'X-Title': 'Qrie',
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
        choices?: { message?: { content?: string }; finish_reason?: string }[];
        error?: { message?: string };
      };
      // OpenRouter reports upstream failures as a 200 with an error body.
      if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? 'unknown error'}`);
      // The same OpenAI field the relay path reads, read the same way.
      const choice = data.choices?.[0];
      return { text: choice?.message?.content ?? '', filtered: choice?.finish_reason === FILTERED_FINISH };
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
    // This dev-only path does not read Google's block signals (finishReason,
    // promptFeedback), so it never reports a filter: a blocked reply here
    // reaches parseAgentReply as whatever text it carried, as it always has.
    return {
      text: data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
      filtered: false,
    };
  };
}

interface AgentReply {
  say: string;
  recallBeatId: string | null;
  done: boolean;
  /** Her reply as board steps, when she was given a board to write on. */
  steps?: RawStep[];
}

/**
 * WHAT SHE IS TOLD ABOUT THE BOARD. The ops are the closed list in
 * @ai-tutor/live-board; the ids are the elements on screen now. She never
 * gives a position — the live board places everything.
 */
function boardBrief(board: DoubtBoard, ctx: DoubtContext): string[] {
  const onScreen = Object.entries(board.onScreen(ctx))
    .slice(-40)
    .map(([id, el]) => `  ${id} (${el.kind}${el.author === 'lesson' ? '' : ', ' + el.author}): ${el.text.slice(0, 80)}`);
  const holding = board.holding(ctx);
  return [
    '',
    'THE BOARD. You teach like a real tutor at a whiteboard: while you talk, you WRITE and MARK on the board. What is on it now (id, kind: text):',
    ...(onScreen.length > 0 ? onScreen : ['  (nothing yet)']),
    ...(holding
      ? [`The class is paused on this question, which the student must answer themselves: "${holding}". Do NOT give its answer, not in words and not on the board — guide with a smaller question or a hint.`]
      : []),
    'Answer in short steps. Each step is ONE spoken sentence (say) and the ink you write while saying it. Ink ops (never give positions):',
    '  {"op":"equation","text":"21 - 14y - 15y = 2"}  one line of maths, correct and exact',
    '  {"op":"write","text":"a short line of words"}',
    '  {"op":"note","text":"a key idea in a box"}',
    '  {"op":"work","steps":[{"say":"...","line":"7(3 - 2y)"},{"say":"...","line":"= 21 - 14y"}]}  a worked solution, one line per step',
    '  {"op":"mark","targetId":"<an id from the board>","shape":"circle"}  shapes: circle, underline, box, cross, tick',
    '  {"op":"arrow","fromId":"<id>","toId":"<id>","label":"optional"}',
    'Use 1 to 4 steps. Write maths on the board rather than reading symbols aloud; say it in words.',
    'Board text is plain text, never LaTeX: write ⇒, ×, ÷, ≠, ≤, (a)/(b), √(x) — no backslashes, no $.',
  ];
}

/**
 * The briefing, plus the one instruction the persona cannot give: the JSON
 * shape this transport needs back. Her character, her rules and the legal
 * recall targets all come from @ai-tutor/persona — nothing about who she is
 * is written here.
 *
 * THE LANGUAGE THE CHILD CHOSE is the one thing added to `student` on the way
 * past. `buildStudentContext` (lib/student.ts) does not carry it, so without
 * this the brief had no language at all and a Hinglish class answered its
 * doubts in whatever language the model liked. It is read from the workspace
 * (`tutorLanguage()`, the onboarding choice) every time a turn's prompt is
 * built, so a change reaches the next turn. A language the caller already put
 * on `student` is kept: whoever built the context measured it, and the
 * workspace is the fallback, not an override.
 */
export function buildDoubtSystemPrompt(ctx: DoubtContext, student: StudentContext, board?: DoubtBoard): string {
  const spokenTo: StudentContext = { ...student, language: student.language ?? tutorLanguage() };
  return [
    buildDoubtBrief(ctx, spokenTo, {
      moment: 'answering',
      surface: 'text',
      // She is told the outcome this beat is for, and what it rests on.
      // With the MODEL's belief, so the foundations she names carry a real
      // secure/shaky marking instead of arriving unmarked.
      outcomes: createOutcomeLookup(masteryFromModel()),
    }),
    ...(board ? boardBrief(board, ctx) : []),
    '',
    board
      ? 'Respond with ONLY a JSON object: {"steps": [{"say": string, "ink": [op, ...]}], "recallBeatId": string | null, "done": boolean}'
      : 'Respond with ONLY a JSON object: {"say": string, "recallBeatId": string | null, "done": boolean}',
    'Set recallBeatId to bring an earlier moment back onto the board, or null. Set done to true once the doubt is resolved.',
  ].join('\n');
}

/**
 * What she says when the model's reply is not the JSON it was asked for.
 *
 * Fixed, because the alternative was reading the raw reply aloud: a model that
 * broke format has already stopped following its instructions, and whatever
 * it wrote instead — half an object, a refusal, a monologue — is the least
 * checked text on the path to a child. It asks the student to try again rather
 * than pretending to have answered, and it does not end the doubt.
 */
export const MALFORMED_REPLY_LINE =
  "Sorry, I got muddled saying that. Could you ask me once more, maybe in different words?";

/** The same line for a child who chose Hinglish (overnight review #27). */
export const MALFORMED_REPLY_LINE_HI =
  'Sorry, bolte-bolte main thoda uljha gayi. Ek baar phir se puchoge, shayad alag shabdon mein?';

export const malformedLine = (lang?: string): string =>
  lang === 'hi-en' ? MALFORMED_REPLY_LINE_HI : MALFORMED_REPLY_LINE;

/**
 * What she says when the provider's own filter stopped the turn.
 *
 * Not MALFORMED_REPLY_LINE. That one invites the student to say it again "in
 * different words", which after a filter is an invitation to rephrase exactly
 * what was blocked. This one steers back to the lesson and invites a question
 * about it, and the doubt stays open — the same way ClassRoom handles an
 * off-limits typed question (screens/ClassRoom.tsx, `sendText`).
 *
 * The wording is the relay's BLOCKED_LINE (packages/relay/src/vertex.ts),
 * spelled here rather than imported because @ai-tutor/relay is server code the
 * client bundle does not import. tests/geminiAgent.test.ts fails if the two
 * drift apart. Spoken from here, never from the reply: a filtered reply that
 * reached us some other way could carry the partial text the filter stopped.
 */
export const FILTERED_REPLY_LINE = "Let's keep our class on the lesson — ask me anything about it!";

/** The same line for a child who chose Hinglish (fifth review, 2026-09-29). */
export const FILTERED_REPLY_LINE_HI = 'Chalo class ko lesson pe hi rakhte hain — lesson ke baare mein kuch bhi pucho!';

/**
 * Parse + sanitise a model reply. Unknown recall ids are dropped, never
 * trusted; a reply that is not the asked-for shape becomes
 * MALFORMED_REPLY_LINE, never its own text.
 */
export function parseAgentReply(raw: string, canRecall: (beatId: string) => boolean, lang?: string): AgentReply {
  const fallback: AgentReply = {
    say: malformedLine(lang),
    recallBeatId: null,
    done: false,
  };
  try {
    const cleaned = raw.replace(/```(?:json)?|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<AgentReply> & { steps?: unknown };
    // Board steps, when she was given a board: every step needs a sentence.
    const steps: RawStep[] = Array.isArray(parsed.steps)
      ? (parsed.steps as unknown[])
          .filter(
            (x): x is { say: string; ink?: unknown } =>
              typeof (x as { say?: unknown } | null)?.say === 'string' && (x as { say: string }).say.trim() !== '',
          )
          .map((x) => ({ say: x.say, ink: Array.isArray(x.ink) ? (x.ink as unknown[]) : [] }))
      : [];
    if (steps.length > 0 && (typeof parsed.say !== 'string' || parsed.say.length === 0)) {
      parsed.say = steps.map((x) => x.say).join(' ');
    }
    if (typeof parsed.say !== 'string' || parsed.say.length === 0) return fallback;
    const recall =
      typeof parsed.recallBeatId === 'string' && canRecall(parsed.recallBeatId)
        ? parsed.recallBeatId
        : null;
    return { say: parsed.say, recallBeatId: recall, done: parsed.done === true, ...(steps.length > 0 ? { steps } : {}) };
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
      /**
       * STARTED ON THE FIRST FAILED CALL, AND NOT BEFORE.
       *
       * It used to be started here, with the session — and starting an agent
       * is what makes it speak: the scripted stub greets and demonstrates a
       * recall the moment it starts. So every raised hand heard the handoff's
       * bridge line, then the stub's own opening and an old beat pulled onto
       * the board, while the model was working perfectly and about to answer
       * too. Started lazily, a doubt the model handles never meets it; one
       * relief, once started, takes every later failure in this doubt.
       */
      let relief: AgentSession | null = null;
      const reliefFor = (): AgentSession | null => {
        if (relief === null && opts.fallback) relief = opts.fallback.start(ctx, io);
        return relief;
      };

      /**
       * A FILTERED TURN LEAVES NO TRACE IN THE HISTORY.
       *
       * Every turn sends the whole history again, and a Vertex prompt block
       * (promptFeedback.blockReason) is a verdict on the prompt as a whole. So
       * a blocked question left in `history` travels in every later prompt and
       * can trip the same block on every question after it, however harmless.
       * The blocked question is taken back out and the reply to it is never
       * added; the turns answered before it stay.
       */
      const call = async (userText: string): Promise<AgentReply> => {
        history.push({ role: 'user', text: userText });
        const reply = await transport(
          buildDoubtSystemPrompt(ctx, opts.student, opts.board),
          history,
          controller.signal,
        );
        if (reply.filtered) {
          history.pop();
          return {
            say: tutorLanguage() === 'hi-en' ? FILTERED_REPLY_LINE_HI : FILTERED_REPLY_LINE,
            recallBeatId: null,
            done: false,
          };
        }
        history.push({ role: 'model', text: reply.text });
        return parseAgentReply(reply.text, (id) => isRecallable(ctx, id), tutorLanguage());
      };

      const deliver = async (reply: AgentReply): Promise<void> => {
        if (stopped) return;
        if (reply.recallBeatId) io.recall(reply.recallBeatId);
        if (opts.board && reply.steps && reply.steps.length > 0) {
          // Checked and laid out before a word is said; null means the class
          // halted on something in the reply (lib/doubtBoard.ts).
          const turn = opts.board.turn(reply.steps, ctx);
          if (turn === null) return;
          for (const [i, line] of turn.lines.entries()) {
            if (stopped) return;
            if (line.recall) io.recall(line.recall);
            const next = turn.lines[i + 1]?.say;
            // The line's ink is drawn when her voice starts the sentence, and
            // the NEXT sentence's audio starts fetching then — each step used
            // to pay Vertex's 1-2 s to first audio as dead air between
            // sentences (overnight review #30). The lines were screened in
            // `board.turn` before any of them is said.
            await io.say(line.say, {
              onStart: () => {
                line.show();
                if (next && !stopped) io.prime?.(next);
              },
              more: i < turn.lines.length - 1,
            });
          }
        } else {
          await io.say(reply.say);
        }
        if (reply.done && !stopped) io.done();
      };

      // One promise chain so replies can never interleave out of order.
      let chain = Promise.resolve();
      const enqueue = (userText: string, opts?: SendOptions): void => {
        chain = chain
          .then(async () => {
            if (stopped) return;
            const reply = await call(userText);
            /**
             * A failure while DELIVERING the reply — laying it on the board
             * or recalling a beat; `io.say` itself never rejects — is not a
             * failed call (overnight review #41). Handing the question to the
             * scripted tutor then could answer it over lines already said.
             * She says the muddled line and the doubt stays open.
             */
            try {
              await deliver(reply);
            } catch {
              if (!stopped) await io.say(malformedLine(tutorLanguage()));
            }
          })
          .catch(async () => {
            // Rule 1: a failed call must hand the room back, never hold it.
            if (stopped) return;
            const scripted = reliefFor();
            // The app's own opener is one the stand-in ignores; handing it
            // over left the doubt silent (sixth review). She says the
            // connection line instead.
            if (scripted && !opts?.opener) {
              // The scripted tutor takes the question instead. Same persona,
              // same room, and the student gets an answer rather than an
              // apology about our plumbing.
              scripted.sendUserText(userText, opts);
              return;
            }
            await io.say(
              tutorLanguage() === 'hi-en'
                ? 'Hmm, abhi connection mein thodi dikkat hai. Chalo class continue karte hain — thodi der mein phir haath utha dena.'
                : "Hmm, I'm having trouble connecting right now. Let's continue the class — try raising your hand again in a bit.",
            );
            if (!stopped) io.done();
          });
      };

      // No opening line: the handoff already spoke the bridge line in her
      // voice before this session existed. See the same note in liveAgent.ts.

      return {
        sendUserText(text: string, opts?: SendOptions): void {
          if (!stopped) enqueue(text, opts);
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
