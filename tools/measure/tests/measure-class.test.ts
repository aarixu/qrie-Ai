import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCommonsSearch,
  prepareClass,
  type ImageAdapter,
  type LlmAdapter,
  type TopicOutcome,
  type VisionAdapter,
} from '@ai-tutor/class-prep';
import { JUDGE_SYSTEM, CLOSE_SYSTEM, describeAsk } from '@ai-tutor/tutor-judge';
import { estimateSpeechMs } from '@ai-tutor/player';

/**
 * WHAT ONE CLASS ACTUALLY COSTS — measured, not estimated.
 *
 * Phase 2 prices a credit from this number and refuses to price it from a
 * guess. So this runs ONE cold Class 10 Science class through the DEPLOYED
 * relay, exactly as the app does — the same planner, artist, picture rungs,
 * vision checks and icon step, on the same models with the same prompts — and
 * then plays it back the way a web student would: every beat spoken through
 * the cloud voice, every ask answered through the cloud ear and judged. All of
 * it attributed to one session id, so the accounting the relay writes can be
 * read back and cross-checked against the calls this file counted itself.
 *
 * A test file rather than a script because the class-prep package cannot be
 * loaded by plain Node — the workspace barrels use extensionless imports that
 * Node's type stripping cannot resolve — and vitest's alias config can. It is
 * gated on an environment variable so it never runs in CI: it spends real
 * Vertex credits (about the price of one class) and real OpenRouter money
 * (a few rupees of speech).
 *
 * Run:  MEASURE_CLASS=1 npx vitest run tools/measure --reporter=verbose
 */

const env = Object.fromEntries(
  // Absent on a fresh checkout or worktree; the live suite below is skipped there anyway.
  (fs.existsSync(path.resolve(process.cwd(), '.env.local'))
    ? fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
    : '')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const URL_ = env.VITE_SUPABASE_URL as string;
const ANON = env.VITE_SUPABASE_ANON_KEY as string;
const RELAY = env.VITE_RELAY_URL as string;

// The exact models lib/liveClass.ts and lib/judge.ts name, so the measurement
// is of the product and not of a stand-in. The judge is the one exception and
// it is a finding: the app names google/gemini-3-flash-preview, which the
// relay's allow-list refuses, so in production every spoken answer's judge
// call is a 400 the class swallows. Measured here on the same-family model the
// app should be using.
const PLANNER_MODEL = 'google/gemini-3.7-flash';
const ARTIST_MODEL = 'google/gemini-3.7-flash';
const IMAGE_MODEL = 'google/gemini-3.1-flash-image';
const VISION_MODEL = 'google/gemini-3.7-flash';
const JUDGE_MODEL = 'google/gemini-3.7-flash';
const SPEECH_MODEL = 'deepgram/aura-2';
const HEAR_MODEL = 'deepgram/nova-3';

const TOPIC_REF = 'class10-science/heredity/rules-for-the-inheritance-of-traits-mendels-contributions';

/** Prices from tools/sql/model_price.sql, applied HERE because the table is
 *  the operator's to fill. USD per unit; the rate is one number. */
const RATE = 95.6;
const USD: Record<string, { in: number; out: number; think: number } | { char: number } | { sec: number }> = {
  'gemini-3.7-flash': { in: 0.75 / 1e6, out: 3.75 / 1e6, think: 3.75 / 1e6 },
  'gemini-3.8-flash': { in: 0.75 / 1e6, out: 3.75 / 1e6, think: 3.75 / 1e6 },
  'gemini-3.1-flash-lite': { in: 0.25 / 1e6, out: 1.5 / 1e6, think: 1.5 / 1e6 },
  'gemini-3.1-flash-image': { in: 0.5 / 1e6, out: 2.0 / 1e6, think: 2.0 / 1e6 },
  'deepgram/aura-2': { char: 30 / 1e6 },
  'deepgram/nova-3': { sec: 0.0043 / 60 },
};
const bare = (m: string | null): string => (m ?? '').replace(/^[a-z0-9-]+\//, '');

interface UsageRow {
  relay: string;
  provider: string;
  model: string | null;
  status: number;
  prompt_tokens: number | null;
  output_tokens: number | null;
  thought_tokens: number | null;
  images: number | null;
  characters: number | null;
  audio_bytes: number | null;
}

const inrOf = (r: UsageRow): number | null => {
  const key = r.relay === 'llm' ? bare(r.model) : (r.model ?? '');
  const p = USD[key];
  if (!p) return null;
  let usd = 0;
  if ('in' in p) {
    usd += (r.prompt_tokens ?? 0) * p.in + (r.output_tokens ?? 0) * p.out + (r.thought_tokens ?? 0) * p.think;
  } else if ('char' in p) {
    usd += (r.characters ?? 0) * p.char;
  } else {
    usd += ((r.audio_bytes ?? 0) / 32000) * p.sec;
  }
  return usd * RATE;
};

describe.skipIf(!process.env.MEASURE_CLASS)('one cold class, measured through the deployed relay', () => {
  it(
    'costs what it costs',
    async () => {
      // ------------------------------------------------------------ a student
      const signup = await fetch(`${URL_}/auth/v1/signup`, {
        method: 'POST',
        headers: { apikey: ANON, 'content-type': 'application/json' },
        body: '{}',
      });
      const { access_token: token } = (await signup.json()) as { access_token: string };
      expect(token).toBeTruthy();
      const sessionId = crypto.randomUUID();
      const auth = {
        apikey: ANON,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-session-id': sessionId,
      };

      // The books are kept SERVER-side, so a run that dies half way through has
      // still spent real money and still has a real answer sitting in
      // usage_event. Dropping the session id here means that answer is always
      // recoverable — `node tools/bin/cost-report.mjs` reads it back — instead
      // of being lost with the process. The first run of this file died on a
      // rate limit and took its own numbers with it.
      fs.mkdirSync(path.resolve('tools/measure'), { recursive: true });
      fs.writeFileSync(
        path.resolve('tools/measure/last-session.json'),
        JSON.stringify({ sessionId, topicRef: TOPIC_REF, token, startedAt: new Date().toISOString() }, null, 2),
      );

      // The sitting, opened the way the ledger drain opens it: through
      // record_evidence (0107), a phone's only way to write evidence since 0110,
      // with its session-started event and that sitting's entry. The org and the
      // learner come from the token. A sitting not opened leaves cost-report
      // nothing to join this class's usage onto, so the answer is checked.
      const startedAt = new Date().toISOString();
      const opened = await fetch(`${URL_}/rest/v1/rpc/record_evidence`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          p_sessions: [{ id: sessionId, source: 'class', topicRef: TOPIC_REF, startedAt }],
          p_events: [
            {
              id: crypto.randomUUID(),
              sessionId,
              seq: 0,
              at: startedAt,
              kind: 'session-started',
              source: 'class',
              surface: 'tap',
              outcomeIds: [],
              topicRef: TOPIC_REF,
              payload: {},
            },
          ],
        }),
      });
      expect(opened.ok).toBe(true);
      expect(((await opened.json()) as { status: string }[]).map((r) => r.status)).toEqual(['recorded']);

      // ------------------------------------------------- the adapters, as the app
      const counted: Record<string, number> = {};
      const count = (k: string): void => {
        counted[k] = (counted[k] ?? 0) + 1;
      };
      /**
       * A rate limit is weather, not a verdict.
       *
       * The first run of this file died 138 seconds in on a Vertex
       * RESOURCE_EXHAUSTED, which is a finding in its own right: the relay
       * passes an upstream 429 straight through and NOTHING between it and the
       * student retries. A class prep makes about forty model calls in two
       * minutes, several of them in parallel, so this is not an edge case — it
       * is what a classroom full of students looks like from Vertex's side.
       * The fix belongs in the relay and is made there; the same patience is
       * needed here so the measurement is of a class and not of a quota.
       */
      let waited = 0;
      const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
      const ask = async (body: unknown, what: string): Promise<{ choices?: { message?: { content?: string; images?: { image_url?: { url?: string } }[] } }[]; error?: { message?: string } }> => {
        count(what);
        for (let attempt = 0; ; attempt += 1) {
          const res = await fetch(`${RELAY}/api/llm`, { method: 'POST', headers: auth, body: JSON.stringify(body) });
          const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          const busy = res.status === 429 || res.status === 503;
          if (busy && attempt < 5) {
            const pause = 4000 * 2 ** attempt;
            waited += pause;
            await sleep(pause);
            continue;
          }
          if (!res.ok) throw new Error(`${what}: relay ${res.status}: ${data.error?.message ?? ''}`);
          if (data.error) throw new Error(`${what}: ${data.error.message}`);
          return data;
        }
      };
      const llm = (model: string, what: string, json = false): LlmAdapter => ({
        async complete(system, userText) {
          const data = await ask(
            {
              model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userText },
              ],
              ...(json ? { response_format: { type: 'json_object' } } : {}),
            },
            what,
          );
          const text = data.choices?.[0]?.message?.content ?? '';
          if (!text) throw new Error(`${what}: the model replied with nothing`);
          return text;
        },
      });
      const imageArtist: ImageAdapter = {
        async draw(prompt) {
          const data = await ask({ model: IMAGE_MODEL, messages: [{ role: 'user', content: prompt }] }, 'image');
          return data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
        },
      };
      const eyes: VisionAdapter = {
        async look(imageUrl, system, userText) {
          const data = await ask(
            {
              model: VISION_MODEL,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: imageUrl } }] },
              ],
            },
            'vision',
          );
          return data.choices?.[0]?.message?.content ?? '';
        },
      };

      // --------------------------------------------------------- the topic
      const graph = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'packages/knowledge-graph/data/class10-science.json'), 'utf8'),
      ) as { nodes: { id: string; outcome: string; difficulty: number; topicRef?: string }[] };
      const outcomes: TopicOutcome[] = graph.nodes
        .filter((n) => n.topicRef === TOPIC_REF)
        .sort((a, b) => a.difficulty - b.difficulty)
        .slice(0, 12)
        .map((n) => ({ id: n.id, statement: n.outcome }));
      expect(outcomes.length).toBeGreaterThan(0);

      // ------------------------------------------------- 1. prepare, as the app
      const t0 = Date.now();
      const phases: string[] = [];
      const result = await prepareClass({
        topic: "Rules for the Inheritance of Traits – Mendel's Contributions",
        klass: 10,
        minutes: 4, // Math.min(4, Math.max(1, estMinutes 45)) as LiveClass.tsx does
        outcomes,
        planner: llm(PLANNER_MODEL, 'planner', true),
        artist: llm(ARTIST_MODEL, 'artist'),
        imageArtist,
        eyes,
        web: createCommonsSearch(),
        onProgress: (p) => {
          phases.push(`${p.phase} ${Math.round(p.done * 100)}% ${p.message}`);
        },
      });
      const prepMs = Date.now() - t0;
      const lesson = result.lesson;

      // The icon step: /api/icons is a 501 in production by design, so this
      // costs nothing today. Called anyway so the measurement reflects the
      // product as deployed rather than as intended.
      const nouns = [...new Set(lesson.elements.filter((e) => e.kind === 'graphic').map((e) => (e as { noun: string }).noun))];
      let iconsStatus: number | null = null;
      if (nouns.length > 0) {
        const q = new URLSearchParams();
        for (const n of nouns) q.append('noun', n);
        iconsStatus = (await fetch(`${RELAY}/api/icons?${q}`, { headers: auth })).status;
      }

      // ------------------------------------------- 2. play it back, as the web
      const ticket = (await (await fetch(`${RELAY}/api/ticket`, { method: 'POST', headers: auth })).json()) as { ticket: string };
      let spokenChars = 0;
      for (const beat of lesson.beats) {
        if (!beat.narration) continue;
        count('speech');
        spokenChars += [...beat.narration].length;
        const res = await fetch(
          `${RELAY}/api/speech?text=${encodeURIComponent(beat.narration)}&model=${SPEECH_MODEL}&ticket=${encodeURIComponent(ticket.ticket)}&session=${sessionId}`,
        );
        await res.arrayBuffer().catch(() => null);
        expect(res.ok, `speech for ${beat.id}`).toBe(true);
      }

      // Every ask answered ALOUD on the expensive path: the ear hears five
      // seconds, the judge weighs it, she cross-questions, the ear hears the
      // reasoning, the close resolves it. Two hears and two judge calls per ask.
      const silence = silentWav(5);
      const asks = lesson.beats.filter((b) => b.ask);
      for (const beat of asks) {
        const askText = describeAsk(beat.ask!);
        for (let turn = 0; turn < 2; turn += 1) {
          count('hear');
          const heard = await fetch(`${RELAY}/api/hear?model=${HEAR_MODEL}`, {
            method: 'POST',
            headers: { ...auth, 'content-type': 'audio/wav' },
            body: silence,
          });
          expect(heard.ok, `hear for ${beat.id}`).toBe(true);
        }
        await llm(JUDGE_MODEL, 'judge', true).complete(JUDGE_SYSTEM(), `${askText}\n\nThe student said: "the tall one"`);
        await llm(JUDGE_MODEL, 'judge', true).complete(
          CLOSE_SYSTEM(),
          `${askText}\n\nThey answered: "the tall one"\nYou then asked: "why?"\nThey reasoned: "because T is dominant"`,
        );
      }

      // Time on task for THIS lesson: what she says, at speaking pace, plus the
      // holds, plus twenty seconds of thinking and answering per ask. An
      // estimate, labelled as one — the denominator of the per-hour figure.
      const activeMs =
        lesson.beats.reduce((s, b) => s + estimateSpeechMs(b.narration ?? '') + (b.minMs ?? 0), 0) + asks.length * 20_000;
      await fetch(`${URL_}/rest/v1/rpc/close_learning_session`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ p_session: sessionId, p_ended_at: new Date().toISOString(), p_active_ms: activeMs }),
      });

      // ---------------------------------------- 3. read the books back, as them
      await new Promise((r) => setTimeout(r, 2500)); // the sink is fire-and-forget
      const rows = (await (
        await fetch(
          `${URL_}/rest/v1/usage_event?select=relay,provider,model,status,prompt_tokens,output_tokens,thought_tokens,images,characters,audio_bytes&session_id=eq.${sessionId}&order=at.asc`,
          { headers: auth },
        )
      ).json()) as UsageRow[];
      expect(Array.isArray(rows)).toBe(true);

      // Cross-check: every call this file made must be a row. This is the
      // accounting auditing itself.
      const byRelay: Record<string, number> = {};
      for (const r of rows) byRelay[r.relay] = (byRelay[r.relay] ?? 0) + 1;
      const llmCallsMade = (counted.planner ?? 0) + (counted.artist ?? 0) + (counted.image ?? 0) + (counted.vision ?? 0) + (counted.judge ?? 0);
      expect(byRelay.llm ?? 0, 'every llm call is a usage row').toBe(llmCallsMade);
      expect(byRelay.speech ?? 0, 'every spoken line is a usage row').toBe(counted.speech ?? 0);
      expect(byRelay.hear ?? 0, 'every hear is a usage row').toBe(counted.hear ?? 0);

      // ----------------------------------------------------- 4. the report
      const groups = new Map<string, { calls: number; in: number; out: number; think: number; images: number; chars: number; sec: number; inr: number; unpriced: boolean }>();
      let total = 0;
      let unpriced = 0;
      for (const r of rows) {
        const k = `${r.relay} ${r.model ?? '-'}`;
        const g = groups.get(k) ?? { calls: 0, in: 0, out: 0, think: 0, images: 0, chars: 0, sec: 0, inr: 0, unpriced: false };
        g.calls += 1;
        g.in += r.prompt_tokens ?? 0;
        g.out += r.output_tokens ?? 0;
        g.think += r.thought_tokens ?? 0;
        g.images += r.images ?? 0;
        g.chars += r.characters ?? 0;
        g.sec += (r.audio_bytes ?? 0) / 32000;
        const inr = inrOf(r);
        if (inr === null) {
          g.unpriced = true;
          unpriced += 1;
        } else {
          g.inr += inr;
          total += inr;
        }
        groups.set(k, g);
      }

      const pictures = result.report.visuals;
      const generated = pictures.filter((v) => v.from === 'generated').length;
      const foundOnWeb = pictures.filter((v) => v.from === 'web').length;
      const lines = [
        '',
        `ONE COLD CLASS — ${lesson.title}`,
        `  topic          ${TOPIC_REF}`,
        `  outcomes given ${outcomes.length}   beats ${lesson.beats.length}   asks ${asks.length}   elements ${lesson.elements.length}`,
        `  prepared in    ${(prepMs / 1000).toFixed(1)}s  (plan ${(result.report.planMs / 1000).toFixed(1)}s, visuals ${(result.report.visualsMs / 1000).toFixed(1)}s)`,
        `  pictures       ${pictures.length} visuals: ${foundOnWeb} found on Commons, ${generated} generated, ${pictures.filter((v) => !v.ok).length} failed`,
        `  icons          ${nouns.length} nouns → /api/icons ${iconsStatus ?? 'not needed'}`,
        `  issues         ${result.report.issues.length ? result.report.issues.join(' | ').slice(0, 300) : 'none'}`,
        `  spoken         ${spokenChars} characters over ${lesson.beats.length} beats`,
        `  time on task   ~${(activeMs / 60_000).toFixed(1)} min (estimated for the per-hour figure)`,
        '',
        '  relay  model                        calls      in     out   think  img   chars    sec        ₹',
      ];
      for (const [k, g] of [...groups].sort((a, b) => b[1].inr - a[1].inr)) {
        lines.push(
          `  ${k.padEnd(34)} ${String(g.calls).padStart(5)} ${String(g.in).padStart(7)} ${String(g.out).padStart(7)} ${String(g.think).padStart(7)} ${String(g.images).padStart(4)} ${String(g.chars).padStart(7)} ${g.sec.toFixed(1).padStart(6)}  ${g.unpriced ? 'unpriced' : g.inr.toFixed(3).padStart(8)}`,
        );
      }
      const perHour = total / (activeMs / 3_600_000);
      lines.push(
        '',
        `  COST OF THIS CLASS   ₹${total.toFixed(2)}${unpriced ? `   (a floor — ${unpriced} rows unpriced)` : ''}`,
        `  PER STUDENT-HOUR     ₹${perHour.toFixed(2)}   (at ~${(activeMs / 60_000).toFixed(1)} min on task)`,
        `  of which the PREPARATION (paid once per topic, then cached)  ₹${[...groups].filter(([k]) => k.startsWith('llm')).reduce((s, [, g]) => s + g.inr, 0).toFixed(2)}`,
        `  and the PLAYBACK (paid every time, on the web)               ₹${[...groups].filter(([k]) => !k.startsWith('llm')).reduce((s, [, g]) => s + g.inr, 0).toFixed(2)}`,
        '',
        `  session ${sessionId}`,
        '',
      );
      const report = lines.join('\n');
      console.log(report);

      const out = path.resolve(process.env.MEASURE_OUT ?? 'tools/measure/last-class.json');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(
        out,
        JSON.stringify({ sessionId, topicRef: TOPIC_REF, prepMs, activeMs, counted, rows, totalInr: total, perHourInr: perHour, report: result.report, lessonId: lesson.id, beats: lesson.beats.length, asks: asks.length, phases }, null, 2),
      );
    },
    15 * 60_000,
  );
});

/** Five seconds of nothing, in the exact format the ear sends. */
function silentWav(seconds: number): ArrayBuffer {
  const sampleRate = 16_000;
  const samples = sampleRate * seconds;
  const bytes = samples * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const ascii = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(at + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, bytes, true);
  return buf;
}
