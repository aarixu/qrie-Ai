#!/usr/bin/env node
/**
 * GEMINI LIVE, MEASURED — the facts driver A of the live-tutor lab (the whole
 * class inside one Live session, the conductor as a tool the model calls after
 * every student turn) is built on, taken from the real API instead of from the
 * docs, which disagree with each other on exactly the points that matter
 * (async function calling on 3.8, whether a model can be made to speak first).
 * The findings, with the numbers, are in SPIKE.md beside this file.
 *
 * What one run settles, in short sessions with text in (clientContent) and
 * voice out:
 *   1. EPHEMERAL TOKEN — which REST version mints one and in what body shape,
 *      which websocket version accepts it, whether a token locked to a model
 *      still lets the page send its own systemInstruction and tools, whether
 *      the lock holds when the page asks for something else, and whether a
 *      one-use token opens a second connection (a resumption needs one).
 *   2. PER LIVE MODEL — does she speak first when a [CONDUCTOR] turn tells her
 *      to; after a student turn, does she call `next_move` BEFORE any audio;
 *      what she classified; how long each step took; what she said after the
 *      tool's answer. Each model is run with no `behavior` on the declaration
 *      and again with `behavior: 'BLOCKING'`.
 *   3. HINGLISH — what script the output transcription comes back in when the
 *      instruction asks for Roman script (3.8 with BLOCKING, 3.1 without).
 *   4. Every usageMetadata, sessionResumptionUpdate and goAway frame, whole.
 *
 * Each tool response is sent `--tool-delay` ms (default 1500) after the call
 * arrives, on purpose: audio that arrives inside that gap is audio the model
 * did not wait for, which is the whole question for a blocking conductor.
 * `--tool-delay 0` measures a turn the way a conductor in the page would run
 * it.
 *
 * `--models` is free and needs no flag: it lists the models this key can open
 * a Live session on. Everything else opens billed sessions and needs --spend.
 * The run keeps a running cost estimate from the usageMetadata frames at the
 * published paid-tier rates, summing every frame as if it were a per-turn
 * delta (an overcount if the server reports running totals), and starts no new
 * turn — nor any new session that would take one — once that estimate passes
 * US$0.40.
 *
 *   node tools/live-sim/probe-live.mjs --models [--env <path to .env.local>]
 *   node tools/live-sim/probe-live.mjs --spend [--only token,3.8,3.1] [--tool-delay <ms>] [--out <dir>] [--env <path>]
 *
 * With --out it writes the report and every frame of every session as JSON
 * there; without it, it prints the report.
 *
 * GEMINI_API_KEY is read from the repo root's .env.local (or --env: a git
 * worktree has none of its own) and never printed or written. Nor is a minted
 * token or a resumption handle: the logs carry their length instead, and
 * everything printed or written passes through a redactor that replaces any
 * of the three seen so far. Audio is logged as its byte count, never its
 * bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEnvLocal } from '../prewarm/lib/envLocal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);

const HOST = 'generativelanguage.googleapis.com';
const WS_BASE = `wss://${HOST}/ws/google.ai.generativelanguage`;
/** The two live model ids the lab chooses between, newest first. */
const MODELS = ['gemini-3.8-live', 'gemini-3.1-flash-live-preview'];
/** Her voice: persona TUTOR.speechVoiceName (packages/persona/src/traits.ts). */
const VOICE = 'Sulafat';
const CAP_USD = 0.4;
/**
 * Paid-tier US$ per 1M tokens, one row for 3.8 Live, 3.8 Live Extended
 * Thinking and 3.1 Flash Live Preview (ai.google.dev/gemini-api/docs/pricing,
 * read 2026-09-30).
 */
const RATES = { textIn: 0.75, audioIn: 3, textOut: 4.5, audioOut: 12 };
/** Output audio is 24 kHz, 16-bit mono PCM: 48 bytes per millisecond. */
const OUT_BYTES_PER_MS = 48;
const TOOL_DELAY_MS = Number(flag('tool-delay') ?? 1500);

const envFile = path.resolve(flag('env') ?? path.join(HERE, '../../.env.local'));
const KEY = readEnvLocal(envFile).GEMINI_API_KEY;
if (!KEY) {
  console.error(`No GEMINI_API_KEY in ${envFile}. From a git worktree, pass --env <main checkout>/.env.local.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Secrets never leave this process: everything printed or written goes through
// redact(), which replaces the key, every minted token and every resumption
// handle seen so far.
// ---------------------------------------------------------------------------
const secrets = new Set([KEY]);
const redact = (s) => {
  let out = String(s);
  for (const v of secrets) if (v) out = out.split(v).join('<redacted>');
  return out;
};
const show = (x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2));
const say = (...xs) => console.log(redact(xs.map(show).join(' ')));
// A thrown error can carry a socket URL, and the raw-key URL holds the key.
const die = (e) => {
  console.error(redact(e instanceof Error ? e.stack : e));
  process.exit(1);
};
process.on('uncaughtException', die);
process.on('unhandledRejection', die);

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------
async function rest(method, url, body) {
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { unparsed: text.slice(0, 400) };
  }
  return { status: res.status, ms: Math.round(performance.now() - t0), json };
}

/** Every model this key lists with bidiGenerateContent among its methods. */
async function liveModels() {
  const found = [];
  let pageToken = '';
  do {
    const q = `pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const r = await rest('GET', `https://${HOST}/v1beta/models?${q}`);
    if (r.status !== 200) throw new Error(`models list: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    for (const m of r.json.models ?? []) {
      if ((m.supportedGenerationMethods ?? []).includes('bidiGenerateContent')) {
        found.push({
          name: m.name,
          displayName: m.displayName,
          version: m.version,
          inputTokenLimit: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit,
          methods: m.supportedGenerationMethods,
        });
      }
    }
    pageToken = r.json.nextPageToken ?? '';
  } while (pageToken);
  return found;
}

// ---------------------------------------------------------------------------
// The class: one held question, the conductor tool, the setup frame
// ---------------------------------------------------------------------------
const OPENER = 'When you sprint for a bus, why do you breathe so hard?';
const BEGIN = `[CONDUCTOR] Begin the class now: greet the student in one short sentence, then ask: ${OPENER}`;
const BEGIN_HI = `[CONDUCTOR] Begin the class now, in Hinglish: greet the student in one short sentence, then ask: ${OPENER}`;
const INTRODUCE = '[CONDUCTOR] Say your name to the student in one short sentence, and nothing else.';
const STUDENT_WRONG = 'I think breathing gives us energy directly.';
const STUDENT_DONT_KNOW = "Hmm, I don't know.";
const STUDENT_HINGLISH = 'mujhe lagta hai saans lene se energy milti hai';

const CLASSES = [
  'right', 'partly', 'wrong', 'dontKnow', 'question', 'hintRequest',
  'explainRequest', 'offTopic', 'unclear', 'chat', 'stop',
];

/** The moves the fake conductor answers with; the say_this is English, as a plan is. */
const MOVES = {
  probeWhy: {
    move: 'probeWhy',
    say_this: 'Ask why they think breathing itself gives energy — do not explain yet.',
    max_sentences: 2,
  },
  hint: {
    move: 'hint',
    say_this: 'Give one hint as a question: ask what the muscles do with the oxygen once it reaches them. Do not give the answer.',
    max_sentences: 2,
  },
  notAStudentTurn: {
    move: 'none',
    say_this: 'That was the class software, not the student. Do exactly what the [CONDUCTOR] message said.',
    max_sentences: 2,
  },
};

function brief(lang) {
  return [
    'You are Meera, a warm, patient science tutor for a Class 10 student in India. This is a live voice class on one topic: Respiration (CBSE Class 10 Science, Life Processes).',
    'You are Socratic: you ask before you tell, you never give away the answer to the question you are holding, and every turn is one or two short sentences.',
    '',
    'HOW THIS CLASS IS RUN',
    '- A user message that begins with [CONDUCTOR] comes from the class software, not from the student. Do exactly what it says. Never read the tag aloud and never mention the software.',
    '- Every other user message is the STUDENT speaking to you.',
    '- After EVERY student message you MUST call the function next_move FIRST, before you say a single word. Classify the student\'s turn in `class`, copy their words into `student_words`, and set `misconception_id` when a wrong answer matches one of the known misconceptions below.',
    '- Say nothing until next_move answers. Then say ONLY what its `say_this` tells you to, in at most `max_sentences` sentences, in your own warm words. Add no explanation of your own, and never answer the held question yourself.',
    '',
    `THE QUESTION NOW HELD: "${OPENER}"`,
    'Known misconceptions for it:',
    '- breathing-is-respiration: thinks breathing itself makes energy, or that breathing and respiration are the same thing.',
    '- oxygen-is-energy: thinks oxygen is itself the energy the body uses.',
    ...(lang === 'hi-en'
      ? [
          '',
          'LANGUAGE',
          'Speak Hinglish: everyday Hindi mixed with English, the way urban Indian students talk. Keep science words in English. Anything you write, write in Roman script (English letters) only — never Devanagari.',
        ]
      : []),
  ].join('\n');
}

function nextMoveDeclaration(behavior) {
  return {
    name: 'next_move',
    description:
      'Call this FIRST after every student turn, before saying anything. It reports how you read the turn; its response tells you exactly what to say next.',
    parameters: {
      type: 'OBJECT',
      properties: {
        class: {
          type: 'STRING',
          enum: CLASSES,
          description: "What the student's turn was, read against the held question.",
        },
        misconception_id: {
          type: 'STRING',
          description: 'For class "wrong": the id of the known misconception it matches, if any.',
        },
        student_words: { type: 'STRING', description: 'What the student said, word for word.' },
      },
      required: ['class'],
    },
    ...(behavior ? { behavior } : {}),
  };
}

/** The setup frame under test. Everything the lab would send, nothing it would not. */
function setupFrame(model, { behavior, lang = 'en' } = {}) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
      systemInstruction: { parts: [{ text: brief(lang) }] },
      tools: [{ functionDeclarations: [nextMoveDeclaration(behavior)] }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: {},
      contextWindowCompression: { slidingWindow: {} },
    },
  };
}

const userTurn = (text) => ({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });

// ---------------------------------------------------------------------------
// Frames: a scrubbed copy of each (audio as a byte count, handles as a
// length), plus the few fields the measurements read.
// ---------------------------------------------------------------------------
function scrub(msg) {
  return JSON.parse(
    JSON.stringify(msg, (k, v) => {
      if (k === 'data' && typeof v === 'string') return `<base64 audio, ${Math.floor((v.length * 3) / 4)} bytes>`;
      if (k === 'newHandle' && typeof v === 'string') {
        secrets.add(v);
        return `<handle, ${v.length} chars>`;
      }
      if (k === 'text' && typeof v === 'string' && v.length > 4000) return `${v.slice(0, 200)}… <${v.length} chars>`;
      return v;
    }),
  );
}

function readFrame(msg) {
  const e = { keys: Object.keys(msg) };
  const sc = msg.serverContent;
  if (sc && typeof sc === 'object') {
    e.serverContentKeys = Object.keys(sc);
    let chunks = 0;
    let bytes = 0;
    for (const p of sc.modelTurn?.parts ?? []) {
      if (typeof p?.inlineData?.data === 'string') {
        chunks++;
        bytes += Math.floor((p.inlineData.data.length * 3) / 4);
        e.mimeType = p.inlineData.mimeType;
      }
      if (typeof p?.text === 'string') e.partText = (e.partText ?? '') + p.text;
    }
    if (chunks) Object.assign(e, { audioChunks: chunks, audioBytes: bytes });
    if (sc.inputTranscription) e.inT = sc.inputTranscription.text ?? '';
    if (sc.outputTranscription) e.outT = sc.outputTranscription.text ?? '';
    if (sc.turnComplete) e.turnComplete = true;
    if (sc.interrupted) e.interrupted = true;
  }
  if (msg.toolCall) e.toolCall = msg.toolCall;
  return e;
}

// ---------------------------------------------------------------------------
// A session: open, send setup, wait for setupComplete (or the error close).
// ---------------------------------------------------------------------------
function openSession(label, url, setup, { setupTimeoutMs = 15_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const at = () => Math.round(performance.now() - t0);
    const s = { label, at, log: [], waiters: [], openMs: null, setupMs: null, closed: null, error: null };
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(s);
    };
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    s.ws = ws;
    s.send = (obj) => {
      ws.send(JSON.stringify(obj));
      s.log.push({ t: at(), dir: 'out', frame: scrub(obj) });
    };
    const timer = setTimeout(() => {
      s.error = `no setupComplete within ${setupTimeoutMs} ms`;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      settle();
    }, setupTimeoutMs);
    ws.onopen = () => {
      s.openMs = at();
      s.send(setup);
    };
    ws.onmessage = (ev) => {
      const text = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        s.log.push({ t: at(), dir: 'in', unparsed: text.slice(0, 300) });
        return;
      }
      const entry = { t: at(), dir: 'in', ...readFrame(msg), frame: scrub(msg) };
      // A frame that parses to no keys at all: keep what actually came, to say what it is.
      if (entry.keys.length === 0) entry.raw = { type: typeof ev.data, length: text.length, text: text.slice(0, 80) };
      s.log.push(entry);
      if (msg.usageMetadata) allUsage.push(msg.usageMetadata);
      if ('setupComplete' in msg && s.setupMs === null) {
        s.setupMs = at();
        settle();
      }
      for (const w of [...s.waiters]) w(entry);
    };
    ws.onerror = (ev) => {
      s.error ??= `socket error: ${ev?.message ?? ev?.error?.message ?? 'no message'}`;
    };
    ws.onclose = (ev) => {
      s.closed = { t: at(), code: ev.code, reason: ev.reason };
      for (const w of [...s.waiters]) w(null);
      settle();
    };
  });
}

async function closeSession(s) {
  // A moment for trailing frames (usage, a resumption handle), then close.
  await new Promise((r) => setTimeout(r, 800));
  if (s.closed) return;
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    s.ws.addEventListener('close', () => {
      clearTimeout(t);
      resolve();
    });
    s.ws.close(1000, 'probe done');
  });
}

// ---------------------------------------------------------------------------
// One turn: send, answer every tool call after TOOL_DELAY_MS, and time it.
//
// The turn ends at the first turnComplete that comes after audio that came
// after the last tool response (or, with no tool call, a turnComplete followed
// by 2 s with no tool call), after 6 s with no frame and no answer
// outstanding, when the socket closes, or at 40 s. All times are ms from the
// send.
// ---------------------------------------------------------------------------
function runTurn(s, name, frame, reply) {
  return new Promise((resolve) => {
    const start = s.at();
    const rel = () => s.at() - start;
    const r = {
      name,
      sent: frame.clientContent?.turns?.[0]?.parts?.[0]?.text ?? '(frame)',
      firstFrameMs: null,
      firstAudioMs: null,
      firstRealAudioMs: null,
      audioChunks: 0,
      audioMs: 0,
      toolCalls: [],
      toolResponses: [],
      audioBeforeFirstToolCall: 0,
      audioWhileToolPending: 0,
      firstAudioAfterToolResponseMs: null,
      tutorTextBeforeToolResponse: '',
      tutorText: '',
      textParts: '',
      inputTranscriptions: [],
      turnCompletes: [],
      generationCompletes: [],
      emptyFrames: 0,
      interrupted: false,
      endedBy: null,
      ms: null,
    };
    let pending = 0;
    let lastReplyAt = null;
    let idleTimer = null;
    let graceTimer = null;
    let finished = false;
    const finish = (why) => {
      if (finished) return;
      finished = true;
      clearTimeout(idleTimer);
      clearTimeout(graceTimer);
      clearTimeout(maxTimer);
      s.waiters.splice(s.waiters.indexOf(onFrame), 1);
      r.endedBy = why;
      r.ms = rel();
      r.audioMs = Math.round(r.audioMs);
      resolve(r);
    };
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => (pending === 0 ? finish('6 s idle') : armIdle()), 6000);
    };
    const onFrame = (e) => {
      if (e === null) return finish('socket closed');
      const t = e.t - start;
      r.firstFrameMs ??= t;
      if (e.audioChunks) {
        r.audioChunks += e.audioChunks;
        r.audioMs += e.audioBytes / OUT_BYTES_PER_MS;
        r.firstAudioMs ??= t;
        // 3.8 and 3.1 both open some replies with a 3-byte chunk; 480 bytes is 10 ms of her voice.
        if (e.audioBytes >= 480) r.firstRealAudioMs ??= t;
        if (r.toolCalls.length === 0) r.audioBeforeFirstToolCall += e.audioChunks;
        else if (pending > 0) r.audioWhileToolPending += e.audioChunks;
        else if (lastReplyAt !== null) r.firstAudioAfterToolResponseMs ??= t - lastReplyAt;
      }
      if (typeof e.partText === 'string') r.textParts += e.partText;
      if (typeof e.outT === 'string') {
        r.tutorText += e.outT;
        if (lastReplyAt === null) r.tutorTextBeforeToolResponse += e.outT;
      }
      if (typeof e.inT === 'string') r.inputTranscriptions.push(e.inT);
      if (e.interrupted) r.interrupted = true;
      if (e.keys.length === 0) r.emptyFrames++;
      if (e.serverContentKeys?.includes('generationComplete')) r.generationCompletes.push(t);
      for (const call of e.toolCall?.functionCalls ?? []) {
        clearTimeout(graceTimer);
        r.toolCalls.push({ atMs: t, name: call.name, id: call.id, args: call.args });
        pending++;
        setTimeout(() => {
          if (finished) return;
          const response = reply(call);
          lastReplyAt = rel();
          s.send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response }] } });
          r.toolResponses.push({ atMs: lastReplyAt, response });
          pending--;
          armIdle();
        }, TOOL_DELAY_MS);
      }
      if (e.turnComplete) {
        r.turnCompletes.push(t);
        if (pending === 0) {
          if (r.toolCalls.length === 0) {
            clearTimeout(graceTimer);
            graceTimer = setTimeout(() => finish('turnComplete'), 2000);
          } else if (lastReplyAt !== null && t > lastReplyAt && r.firstAudioAfterToolResponseMs !== null) {
            // Only a turnComplete that follows her voice after the response
            // ends the turn: on 3.8 without `behavior`, the call's own
            // turnComplete can arrive just AFTER a fast response (measured
            // 2 ms later), with the reply's audio still to come.
            finish('turnComplete after tool response');
          }
        }
      }
      armIdle();
    };
    s.waiters.push(onFrame);
    const maxTimer = setTimeout(() => finish('40 s cap'), 40_000);
    s.send(frame);
    armIdle();
  });
}

// ---------------------------------------------------------------------------
// Money: an estimate from the usage frames, checked before anything new.
// ---------------------------------------------------------------------------
const allUsage = [];
function usd(u) {
  const by = (list, modality) =>
    (list ?? []).filter((d) => d.modality === modality).reduce((n, d) => n + (d.tokenCount ?? 0), 0);
  const inDetails = u.promptTokensDetails ?? [];
  const outDetails = u.responseTokensDetails ?? [];
  const audioIn = by(inDetails, 'AUDIO');
  // Prompt tokens no modality accounts for are priced as text in.
  const textIn = Math.max(0, (u.promptTokenCount ?? 0) - audioIn);
  // Response tokens without a breakdown (a frame that only called a tool has
  // none) are priced as audio out, the dearest rate; the part a breakdown
  // leaves over is priced as text out.
  const audioOut = outDetails.length ? by(outDetails, 'AUDIO') : u.responseTokenCount ?? 0;
  const textOut = outDetails.length ? Math.max(0, (u.responseTokenCount ?? 0) - audioOut) : 0;
  // Thinking priced as text out, as tools/sql/model_price.sql does for the
  // text models; UNVERIFIED for Live. It is not inside responseTokenCount.
  const thoughts = u.thoughtsTokenCount ?? 0;
  const toolUse = u.toolUsePromptTokenCount ?? 0;
  return (
    (textIn * RATES.textIn + audioIn * RATES.audioIn + textOut * RATES.textOut + audioOut * RATES.audioOut +
      thoughts * RATES.textOut + toolUse * RATES.textIn) /
    1e6
  );
}
const spent = () => allUsage.reduce((n, u) => n + usd(u), 0);
const overCap = () => spent() > CAP_USD;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
function sessionFacts(s) {
  const inFrames = s.log.filter((e) => e.dir === 'in');
  return {
    usage: inFrames.filter((e) => e.frame.usageMetadata).map((e) => ({ t: e.t, usageMetadata: e.frame.usageMetadata })),
    sessionResumptionUpdates: inFrames
      .filter((e) => e.frame.sessionResumptionUpdate)
      .map((e) => ({ t: e.t, sessionResumptionUpdate: e.frame.sessionResumptionUpdate })),
    goAway: inFrames.filter((e) => e.frame.goAway).map((e) => ({ t: e.t, goAway: e.frame.goAway })),
    toolCallCancellations: inFrames.filter((e) => e.frame.toolCallCancellation).map((e) => e.frame.toolCallCancellation),
    inputTranscriptionFrames: inFrames.filter((e) => e.inT !== undefined).length,
    topLevelKeysSeen: [...new Set(inFrames.flatMap((e) => e.keys))],
    serverContentKeysSeen: [...new Set(inFrames.flatMap((e) => e.serverContentKeys ?? []))],
    audioMimeTypes: [...new Set(inFrames.map((e) => e.mimeType).filter(Boolean))],
    setupCompleteFrame: inFrames.find((e) => e.frame.setupComplete !== undefined)?.frame ?? null,
  };
}

const script = (text) => ({
  devanagari: (text.match(/\p{Script=Devanagari}/gu) ?? []).length,
  latinLetters: (text.match(/[A-Za-z]/g) ?? []).length,
});

async function withSession(label, url, setup, body) {
  if (overCap()) return { label, skipped: `estimated spend $${spent().toFixed(4)} is over the $${CAP_USD} cap` };
  say(`\n=== ${label} ===`);
  const s = await openSession(label, url, setup);
  const out = {
    label,
    connectMs: s.openMs,
    setupCompleteMs: s.setupMs,
    error: s.error,
    closedBeforeSetup: s.setupMs === null ? s.closed : null,
    turns: [],
  };
  if (s.setupMs !== null) {
    try {
      await body(s, out);
    } finally {
      await closeSession(s);
    }
  }
  out.closed = s.closed;
  Object.assign(out, sessionFacts(s));
  sessions.push({ label, log: s.log });
  say(summarise(out));
  return out;
}

async function turnInto(s, out, name, frame, reply) {
  if (overCap()) {
    out.turns.push({ name, skipped: 'over the spend cap' });
    return null;
  }
  const r = await runTurn(s, name, frame, reply);
  out.turns.push(r);
  return r;
}

function summarise(out) {
  const lines = [`${out.label}: connect ${out.connectMs} ms, setupComplete ${out.setupCompleteMs ?? 'NEVER'} ms`];
  if (out.error) lines.push(`  error: ${out.error}`);
  if (out.closedBeforeSetup) lines.push(`  closed before setup: ${JSON.stringify(out.closedBeforeSetup)}`);
  for (const t of out.turns) {
    if (t.skipped) {
      lines.push(`  [${t.name}] skipped: ${t.skipped}`);
      continue;
    }
    lines.push(
      `  [${t.name}] firstAudio ${t.firstAudioMs ?? '-'} ms (>=10 ms of voice: ${t.firstRealAudioMs ?? '-'} ms), audio ${t.audioMs} ms in ${t.audioChunks} chunks, ended by ${t.endedBy} at ${t.ms} ms`,
    );
    for (const c of t.toolCalls) lines.push(`    toolCall @${c.atMs} ms ${c.name} ${JSON.stringify(c.args)}`);
    if (t.toolCalls.length) {
      lines.push(
        `    audio chunks before first toolCall: ${t.audioBeforeFirstToolCall}; while a response was pending: ${t.audioWhileToolPending}; first audio after toolResponse: ${t.firstAudioAfterToolResponseMs ?? '-'} ms`,
      );
    }
    if (t.tutorTextBeforeToolResponse && t.toolCalls.length)
      lines.push(`    said BEFORE the tool response: ${JSON.stringify(t.tutorTextBeforeToolResponse)}`);
    lines.push(`    said: ${JSON.stringify(t.tutorText)}`);
    if (t.textParts) lines.push(`    text parts: ${JSON.stringify(t.textParts)}`);
    lines.push(`    generationComplete @${t.generationCompletes.join(',') || '-'} ms; turnComplete @${t.turnCompletes.join(',') || '-'} ms`);
  }
  return lines.join('\n');
}

const sessions = [];

async function tokenProbe(model) {
  const result = { model, mints: [], connects: [] };
  const times = () => {
    const now = Date.now();
    return {
      uses: 1,
      expireTime: new Date(now + 10 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
    };
  };
  const constraint = { model: `models/${model}`, generationConfig: { responseModalities: ['AUDIO'] } };
  const bodies = {
    // The shape @google/genai sends when lockAdditionalFields is left out: no fieldMask.
    setupNoMask: () => ({ ...times(), bidiGenerateContentSetup: constraint }),
    // The shape it sends for lockAdditionalFields: [] — a fieldMask naming the
    // constrained fields. The exact string its getFieldMasks builds is UNVERIFIED.
    setupWithMask: () => ({
      ...times(),
      bidiGenerateContentSetup: constraint,
      fieldMask: 'model,generationConfig.responseModalities',
    }),
    // The REST sample on the ephemeral-tokens page, verbatim in shape.
    liveConnectConstraints: () => ({
      ...times(),
      liveConnectConstraints: {
        model: `models/${model}`,
        config: { sessionResumption: {}, responseModalities: ['AUDIO'] },
      },
    }),
  };
  const mint = async (version, bodyName) => {
    const body = bodies[bodyName]();
    const r = await rest('POST', `https://${HOST}/${version}/auth_tokens`, body);
    const token = typeof r.json?.name === 'string' ? r.json.name : null;
    if (token) secrets.add(token);
    const shape = token
      ? { ...r.json, name: `<token: ${token.length} chars, starts "${token.slice(0, token.indexOf('/') + 1)}">` }
      : r.json;
    result.mints.push({ version, bodyName, status: r.status, ms: r.ms, requestBody: body, response: shape });
    say(`mint ${version} ${bodyName}: HTTP ${r.status} in ${r.ms} ms`, shape);
    return token;
  };

  // Both REST versions are tried whatever the first one does; the first that
  // mints is the one the rest of the probe uses.
  let restVersion = null;
  for (const v of ['v1beta', 'v1alpha']) {
    if ((await mint(v, 'setupNoMask')) && restVersion === null) restVersion = v;
  }
  if (!restVersion) return result;

  // Which websocket version takes a token: a bare setup, closed at
  // setupComplete, both versions tried, each with a fresh token.
  let wsVersion = null;
  for (const v of ['v1beta', 'v1alpha']) {
    const token = await mint(restVersion, 'setupNoMask');
    if (!token) continue;
    const url = `${WS_BASE}.${v}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
    const s = await openSession(`token ws ${v}`, url, { setup: { model: `models/${model}` } });
    if (s.setupMs !== null) await closeSession(s);
    result.connects.push({
      wsVersion: v,
      url: `${WS_BASE}.${v}.GenerativeService.BidiGenerateContentConstrained?access_token=<token>`,
      connectMs: s.openMs,
      setupCompleteMs: s.setupMs,
      error: s.error,
      closed: s.closed,
    });
    say(`token ws ${v}: setupComplete ${s.setupMs ?? 'NEVER'} ms`, s.closed ?? '', s.error ?? '');
    if (s.setupMs === null || wsVersion !== null) continue;
    wsVersion = v;
    // Same token again: does a one-use token open a second session?
    const again = await openSession(`token reuse ${v}`, url, { setup: { model: `models/${model}` } });
    result.reuse = { setupCompleteMs: again.setupMs, error: again.error, closed: again.closed };
    say('same one-use token, second connection:', result.reuse);
    if (again.setupMs !== null) await closeSession(again);
  }
  if (!wsVersion) return result;

  // Does the lock hold? A token locked to AUDIO, a page asking for TEXT.
  {
    const token = await mint(restVersion, 'setupWithMask');
    if (token) {
      const url = `${WS_BASE}.${wsVersion}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
      const asksText = setupFrame(model);
      asksText.setup.generationConfig = { responseModalities: ['TEXT'] };
      const out = await withSession(`token setupWithMask, page asks for TEXT (${model})`, url, asksText, async (s, o) => {
        await turnInto(s, o, 'hello', userTurn('[CONDUCTOR] Say hello in five words.'), () => MOVES.notAStudentTurn);
      });
      const t = out.turns[0];
      result.lockCheck = {
        setupCompleteMs: out.setupCompleteMs,
        closed: out.closed,
        error: out.error,
        audioChunks: t?.audioChunks ?? null,
        textParts: t?.textParts ?? null,
      };
    }
  }

  // Does the page's own systemInstruction and tools survive each lock shape?
  result.ownSetup = [];
  for (const bodyName of ['setupNoMask', 'setupWithMask', 'liveConnectConstraints']) {
    const token = await mint(restVersion, bodyName);
    if (!token) {
      result.ownSetup.push({ bodyName, minted: false });
      continue;
    }
    const url = `${WS_BASE}.${wsVersion}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
    const out = await withSession(`token ${bodyName} + own setup (${model})`, url, setupFrame(model), async (s, o) => {
      await turnInto(s, o, 'introduce', userTurn(INTRODUCE), () => MOVES.notAStudentTurn);
      await turnInto(s, o, 'student', userTurn(STUDENT_WRONG), () => MOVES.probeWhy);
    });
    const [intro, student] = out.turns;
    result.ownSetup.push({
      bodyName,
      minted: true,
      setupCompleteMs: out.setupCompleteMs,
      error: out.error,
      closed: out.closed,
      introSaid: intro?.tutorText,
      systemInstructionHonoured: typeof intro?.tutorText === 'string' ? /meera/i.test(intro.tutorText) : null,
      toolCalled: student ? student.toolCalls.length > 0 : null,
      toolArgs: student?.toolCalls?.[0]?.args,
    });
  }
  return result;
}

async function classProbe(model, behavior) {
  const url = `${WS_BASE}.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(KEY)}`;
  return withSession(`class ${model} behavior=${behavior ?? '(none)'}`, url, setupFrame(model, { behavior }), async (s, o) => {
    const a = await turnInto(s, o, 'a: conductor begins', userTurn(BEGIN), () => MOVES.notAStudentTurn);
    if (a) o.spokeFirst = a.audioChunks > 0;
    await turnInto(s, o, 'b: student wrong', userTurn(STUDENT_WRONG), () => MOVES.probeWhy);
    await turnInto(s, o, 'b2: student dontKnow', userTurn(STUDENT_DONT_KNOW), () => MOVES.hint);
  });
}

async function hinglishProbe(model, behavior) {
  const url = `${WS_BASE}.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(KEY)}`;
  const out = await withSession(
    `hinglish ${model} behavior=${behavior ?? '(none)'}`,
    url,
    setupFrame(model, { behavior, lang: 'hi-en' }),
    async (s, o) => {
      await turnInto(s, o, 'c1: conductor begins (Hinglish)', userTurn(BEGIN_HI), () => MOVES.notAStudentTurn);
      await turnInto(s, o, 'c2: student Hinglish', userTurn(STUDENT_HINGLISH), () => MOVES.probeWhy);
    },
  );
  out.scripts = out.turns.map((t) => ({ name: t.name, ...(t.tutorText !== undefined ? script(t.tutorText) : {}) }));
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const listed = await liveModels();
  say('Live-capable models this key lists (supportedGenerationMethods has bidiGenerateContent):');
  for (const m of listed) say(`  ${m.name}  (${m.displayName}; in ${m.inputTokenLimit}, out ${m.outputTokenLimit})`);
  const available = MODELS.filter((id) => listed.some((m) => m.name === `models/${id}`));
  say(`Of ${MODELS.join(', ')}: listed = ${available.join(', ') || 'none'}`);
  if (has('models')) return;

  if (!has('spend')) {
    console.error('Opens billed Gemini Live sessions (well under US$0.50 in all). Pass --spend, or --models for the free list.');
    process.exitCode = 2;
    return;
  }
  const only = (flag('only') ?? 'token,3.8,3.1').split(',');
  const report = { date: new Date().toISOString(), toolDelayMs: TOOL_DELAY_MS, listed, available, token: null, classes: [], hinglish: [] };

  if (only.includes('token') && available.length) report.token = await tokenProbe(available[0]);
  for (const model of available) {
    const tag = model.startsWith('gemini-3.8') ? '3.8' : model.startsWith('gemini-3.1') ? '3.1' : model;
    if (!only.includes(tag)) continue;
    report.classes.push(await classProbe(model, undefined));
    report.classes.push(await classProbe(model, 'BLOCKING'));
    report.hinglish.push(await hinglishProbe(model, tag === '3.8' ? 'BLOCKING' : undefined));
  }
  report.estimatedUsd = Number(spent().toFixed(4));
  report.exampleSetupFrame = scrub(setupFrame(available[0] ?? MODELS[0], { behavior: 'BLOCKING' }));

  say(`\nEstimated spend (usage frames at published rates, summed as deltas): $${report.estimatedUsd}`);
  const outDir = flag('out');
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = report.date.replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, `live-probe-${stamp}.json`), redact(JSON.stringify(report, null, 2)));
    fs.writeFileSync(path.join(outDir, `live-probe-${stamp}.frames.json`), redact(JSON.stringify(sessions, null, 2)));
    say(`Wrote ${outDir}/live-probe-${stamp}{,.frames}.json`);
  } else {
    say(JSON.stringify(report, null, 2));
  }
}

main().catch(die);
