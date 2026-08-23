# @livekit/agents 1.7.0 (Node/TypeScript) — agent worker entry file, CLI launch, function tools, agent→browser messaging, participant/metadata access, and Node 24 direct-TS execution

## VERIFIED
VERIFIED against primary sources — I downloaded the real tarballs (no install into your repo, nothing written to "c:/Users/HP/Ai Tutor") and read the shipped .d.ts AND the shipped .ts source:

- @livekit/agents@1.7.0 — confirmed `latest` on npm. Extracted to C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lk\package. This package ships BOTH dist/*.d.ts and src/*.ts, so every claim below is read off real code, not docs prose.
- @livekit/rtc-node@0.13.34 (the peer dep range is ^0.13.34), livekit-client@2.22.0, livekit-server-sdk@2.18.0, @livekit/protocol@1.50.4 — all extracted and read.

Specifically confirmed by reading declarations:
- `defineAgent`, `AgentDefinition {entry, prewarm, onSimulationEnd}` — dist/generator.d.ts.
- `ServerOptions` / `AgentServer` are the 1.7 names; `WorkerOptions` and `Worker` still exist but are explicitly marked `@deprecated ... alias provided for backward compatibility` — dist/worker.d.ts lines 122-131. This is THE 0.x→1.7 rename to know about.
- `cli.runApp(opts: ServerOptions)` and its own JSDoc example — dist/cli.d.ts.
- CLI subcommands `start` / `dev` / `connect` / `console` / `download-files` and every flag+env binding — read verbatim from src/cli.ts lines 106-300.
- Env var resolution `opts.wsURL || process.env.LIVEKIT_URL` etc. and the exact error strings — src/worker.ts lines 337-359.
- `AgentSession.start({agent, room, inputOptions, outputOptions, record})` — dist/voice/agent_session.d.ts line 432.
- Auto-connect: `if (room && ctx.room === room && !room.isConnected) tasks.push(ctx.connect())` — src/voice/agent_session.ts lines 909-915. So `ctx.connect()` is optional when you pass `room: ctx.room`.
- `tool({name, description, parameters, execute, flags, onDuplicate})` both named and anonymous overloads — dist/llm/tool_context.d.ts lines 309-372. `parameters` accepts a Standard-Schema/Zod schema OR a raw JSONSchema7.
- zod is a PEER dependency (`^3.25.76 || ^4.1.8`), not bundled.
- `ToolExecuteFunction = (args, opts: {ctx: RunContext, toolCallId, abortSignal}) => Promise<Result>` — same file line 92.
- `JobContext.waitForParticipant(identity?)`, `.addParticipantEntrypoint()`, `.connect()`, `.room`, `.job`, `.addShutdownCallback()` — dist/job.d.ts.
- proto `Job` fields id/metadata/room/participant/attributes — @livekit/protocol src/gen/livekit_agent_pb.d.ts.
- `LocalParticipant.publishData / sendText / streamText / performRpc / registerRpcMethod` — rtc-node dist/participant.d.ts.
- Entry file MUST have a **default export** — src/ipc/job_proc_lazy_main.ts line 231 throws "Unable to load agent: Missing or invalid default export in {file}".
- Node 24 + direct .ts: LiveKit's own official starter (livekit-examples/agent-starter-node) has `"engines": {"node": ">=24.0.0"}`, no build script, and literally `"dev": "node src/main.ts dev"` / `"start": "node src/main.ts start"`. No tsx, no bundler.

INFERENCE / NOT FULLY VERIFIED (flagged honestly):
- The two full end-to-end entry files below are MY composition from the verified primitives plus LiveKit's own published examples (agents-js examples/src/basic_agent.ts and docs.livekit.io/agents/start/voice-ai). Each individual call signature is verified; the assembled file has NOT been executed — I could not run it, because you told me not to install into the repo and the packages are not present anywhere on this machine.
- `@livekit/agents-plugin-*` packages (krisp, openai, elevenlabs, silero…) — I did NOT download or verify these. I deliberately used the built-in `inference.*` models instead, which ARE in the 1.7.0 tarball and need no extra plugin package.
- Windows quirk, unverified: src/ipc/job_proc_lazy_main.ts:231 does `import(pathToFileURL(moduleFile).pathname)`, which on Windows produces the specifier `/C:/Users/...`. I did not run this, so I cannot promise the child-process fork loads your entry file cleanly on Windows. Test the worker boot on Windows before you trust it; the fallback is WSL or a Linux container (which is where you'd deploy anyway).
- I did NOT verify that any specific model id string (e.g. 'openai/gpt-4.1-mini') is currently enabled on your LiveKit Inference account.

## API
// =============================================================================
// 0. INSTALL  (versions verified on npm 2026-08-23)
// =============================================================================
//   npm i @livekit/agents@1.7.0 @livekit/rtc-node@^0.13.34 zod@^4
//   npm i livekit-server-sdk@^2.18.0        # token minting in your Next/Node API route
//   npm i livekit-client@^2.22.0            # browser side
//
// @livekit/rtc-node and zod are PEER deps of @livekit/agents — you install them.
// package.json MUST have "type": "module". Your repo already does. Good.


// =============================================================================
// 1. THE WORKER ENTRY FILE — src/agent/main.ts
//    This is the 1.7 shape. See the "0.x vs 1.7" note in gotchas.
// =============================================================================
import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  ServerOptions,          // 1.7 name. `WorkerOptions` is a deprecated alias.
  cli,
  defineAgent,
  inference,              // built-in STT/LLM/TTS/VAD/Avatar — no plugin packages needed
  log,
  tool,
  type JobContext,
  type JobProcess,
} from '@livekit/agents';
import { RoomEvent, type RemoteParticipant } from '@livekit/rtc-node';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Shape you put in the student's participant metadata when you mint their token. */
type HandRaiseContext = {
  lessonId: string;
  beatId: string;
  studentName: string;
  transcriptSoFar?: string;
};

// The file's DEFAULT EXPORT must be the AgentDefinition. The framework forks a
// child process and does `import(<this file>)` then reads `module.default`.
// Verified: src/ipc/job_proc_lazy_main.ts:231.
export default defineAgent({
  // Runs once per warm child process, BEFORE any job lands. Load heavy things here.
  // Whatever you assign to proc.userData is readable later as ctx.proc.userData.
  prewarm: (proc: JobProcess) => {
    proc.userData.bootedAt = Date.now();
  },

  entry: async (ctx: JobContext) => {
    const logger = log();

    // -- (a) CONNECT FIRST -----------------------------------------------
    // Recommended to call early: it cuts the join delay. It is also REQUIRED
    // here because we want to read participant metadata BEFORE building the
    // agent's instructions.
    await ctx.connect();

    // -- (b) FIND THE STUDENT AND READ THEIR METADATA (see section 5) -----
    const student: RemoteParticipant = await ctx.waitForParticipant();

    const meta: HandRaiseContext = safeJson(student.metadata) ?? {
      lessonId: 'unknown',
      beatId: 'unknown',
      studentName: 'student',
    };
    // Attributes are a flat string map — better than metadata for small values
    // you want to mutate live without re-issuing a token.
    const beatFromAttrs = student.attributes['lesson.beat'];

    logger.info({ identity: student.identity, meta, beatFromAttrs }, 'hand raised');

    // -- (c) BUILD THE AGENT (instructions + tools) -----------------------
    // 1.7 prefers the static factory `Agent.create({...})` over `new Agent({...})`.
    // Both exist; `create` additionally accepts lifecycle hooks (onEnter/onExit/
    // onUserTurnCompleted/llmNode/ttsNode/...) inline.
    const agent = Agent.create({
      instructions: [
        `You are a live tutor who just took over a recorded class.`,
        `The student is ${meta.studentName}.`,
        `They raised their hand during lesson "${meta.lessonId}", at beat "${meta.beatId}".`,
        `Answer briefly in simple Hinglish-friendly English. When a diagram would help,`,
        `call showDiagram. When the doubt is resolved, call handBackToLesson.`,
      ].join(' '),

      tools: [showDiagram(ctx), handBackToLesson(ctx)],   // defined in section 3

      onEnter: async ({ session }) => {
        session.generateReply({
          instructions: `Greet ${meta.studentName} by name in one short sentence and ask what's confusing.`,
        });
      },
    });

    // -- (d) BUILD THE SESSION -------------------------------------------
    const session = new AgentSession({
      stt: new inference.STT({ model: 'deepgram/nova-3', language: 'multi' }),
      llm: new inference.LLM({ model: 'openai/gpt-4.1-mini' }),
      tts: new inference.TTS({ model: 'cartesia/sonic-3', voice: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc' }),
      // vad: omitted -> 1.7 auto-provisions inference.VAD({model:'silero'}). Pass null to opt out.
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: { mode: 'adaptive', resumeFalseInterruption: true, falseInterruptionTimeout: 1000 },
        endpointing: { mode: 'dynamic', minDelay: 300, maxDelay: 3000 },
        preemptiveGeneration: { enabled: true },
      },
      maxToolSteps: 3,
      userAwayTimeout: 15,
    });

    session.on(AgentSessionEventTypes.MetricsCollected, (ev) => {
      if (ev.metrics.type !== 'stt_metrics') logger.debug({ m: ev.metrics }, 'metrics');
    });
    session.on(AgentSessionEventTypes.Close, (ev) => logger.info({ ev }, 'session closed'));

    ctx.addShutdownCallback(async () => {
      logger.info({ usage: session.usage }, 'session usage summary');
    });

    // -- (e) OPTIONAL: talking avatar publishing video into THIS room ------
    // inference.AvatarSession ships inside @livekit/agents 1.7 — no extra package.
    // It joins the room as a second participant and publishes the video track.
    //
    // const avatar = new inference.AvatarSession({
    //   model: 'lemonslice/<avatar_id>',
    //   avatarParticipantIdentity: 'tutor-avatar',
    // });
    // await avatar.start(session, ctx.room);
    // When an avatar is attached, do NOT also publish agent audio to the room —
    // the avatar worker republishes the audio in lipsync with the video.

    // -- (f) START ---------------------------------------------------------
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        audioEnabled: true,
        textEnabled: true,
        participantIdentity: student.identity, // link explicitly, not "first participant"
        closeOnDisconnect: true,
        deleteRoomOnClose: false,              // false: the recorded class keeps the room
      },
      outputOptions: {
        transcriptionEnabled: true,
        audioEnabled: true,
      },
    });
  },
});

function safeJson<T>(s: string | undefined): T | undefined {
  if (!s) return undefined;
  try { return JSON.parse(s) as T; } catch { return undefined; }
}

// This line makes the file BOTH the agent module and its own CLI launcher.
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url), // path to THIS file; framework re-imports it in the child
    agentName: 'ai-tutor',                 // set -> explicit dispatch only (see gotchas)
    // wsURL / apiKey / apiSecret omitted -> read from env, see section 2
  }),
);


// =============================================================================
// 2. LAUNCHING THE WORKER + ENVIRONMENT VARIABLES
// =============================================================================
//
// package.json:
//   {
//     "type": "module",
//     "engines": { "node": ">=24.0.0" },
//     "scripts": {
//       "agent:dev":   "node src/agent/main.ts dev",
//       "agent:start": "node src/agent/main.ts start"
//     }
//   }
// (This is verbatim the pattern from LiveKit's own agent-starter-node.)
//
// SUBCOMMANDS — verified from src/cli.ts:
//   dev              development mode. logLevel default 'debug'. Sets LIVEKIT_DEV_MODE=1.
//                    NOTE: marked "Deprecated: use `lk agent dev` instead" in 1.7 help text.
//                    It still works — it is not removed.
//   start            production mode. logLevel default 'info'. production=true.
//   connect --room <name> [--participant-identity <id>]
//                    one-shot: join one specific room. Great for debugging a single lesson room.
//   console --connect-addr <host:port>   in-process run against a local broker
//   download-files   pre-fetch plugin model files (prefer: `npx livekit-agents download-files`)
//
// GLOBAL FLAGS (each bound to an env var, flag wins over env):
//   --url <string>          <- LIVEKIT_URL
//   --api-key <string>      <- LIVEKIT_API_KEY
//   --api-secret <string>   <- LIVEKIT_API_SECRET
//   --worker-token <string> <- LIVEKIT_WORKER_TOKEN   (internal, hidden)
//   --log-level <trace|debug|info|warn|error|fatal>  <- LOG_LEVEL
//
// THE THREE THAT ARE MANDATORY (src/worker.ts:337-351 — exact error strings):
//   LIVEKIT_URL          "URL is required: Set LIVEKIT_URL, run with --url, or pass wsURL in ServerOptions"
//   LIVEKIT_API_KEY      "API Key is required: Set LIVEKIT_API_KEY, run with --api-key, or pass apiKey in ServerOptions"
//   LIVEKIT_API_SECRET   "API Secret is required: Set LIVEKIT_API_SECRET, run with --api-secret, or pass apiSecret in ServerOptions"
// -> throws MissingCredentialsError otherwise. Your key/secret never leave the server. Correct call.
//
// OTHER ENV VARS THE 1.7 SOURCE ACTUALLY READS (full grep of src/):
//   LIVEKIT_AGENT_NAME             default for ServerOptions.agentName
//   LIVEKIT_AGENT_NAME_OVERRIDE    hard override, wins over both
//   LIVEKIT_INFERENCE_API_KEY      LiveKit Inference gateway creds; falls back to LIVEKIT_API_KEY
//   LIVEKIT_INFERENCE_API_SECRET   falls back to LIVEKIT_API_SECRET
//   LIVEKIT_INFERENCE_URL          override gateway base URL
//   LIVEKIT_REMOTE_EOT_URL         remote end-of-turn detector endpoint
//   LIVEKIT_DEV_MODE               set to '1' automatically by `dev` and `connect`
//   LIVEKIT_AGENT_ID, LIVEKIT_AGENT_DEPLOYMENT   set by LiveKit Cloud deploys
//   OTEL_RESOURCE_ATTRIBUTES       OpenTelemetry (1.7 exports traces/logs by default)
//   NUM_CPUS                       load calculation override
//   LK_DRAIN_PLAYOUT_TIMEOUT_MS, LK_KEYTERMS_DEBUG   niche tuning
// NOTE: the framework does NOT call dotenv for you. Load .env.local yourself at the
// top of main.ts:  import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });


// =============================================================================
// 3. FUNCTION TOOLS  — schema library is ZOD (or raw JSON Schema)
// =============================================================================
import { tool, ToolFlag, type RunContext } from '@livekit/agents';
import { z } from 'zod';

// The tool that pulls an earlier diagram back onto the canvas.
// It does a side effect (push to browser) AND returns a string for the model.
function showDiagram(ctx: JobContext) {
  return tool({
    name: 'showDiagram',
    description:
      'Display a diagram from the current lesson on the student\'s canvas. ' +
      'Use when a visual from earlier in the class would answer the doubt.',

    // `parameters` accepts a Zod object schema (args are type-inferred from it)
    // OR a raw JSONSchema7 object. Omit it entirely for a zero-arg tool.
    parameters: z.object({
      diagramId: z.string().describe('The id of the diagram, e.g. "photosynthesis-cycle"'),
      caption: z.string().optional().describe('One-line caption to show under it'),
    }),

    // args are the PARSED, TYPED arguments. opts carries ctx/toolCallId/abortSignal.
    // The RETURN VALUE is serialized and fed back to the model as the tool result.
    execute: async ({ diagramId, caption }, { ctx: runCtx, toolCallId, abortSignal }) => {
      // runCtx: RunContext -> .session, .userData, .functionCall, .speechHandle,
      //                       .waitForPlayout(), .update(msg), .filler(...)
      await pushToClient(ctx, { type: 'show_diagram', diagramId, caption });
      return `Diagram ${diagramId} is now on the student's canvas.`;
    },

    // optional:
    flags: ToolFlag.CANCELLABLE,   // bitmask; NONE | IGNORE_ON_ENTER | CANCELLABLE
    onDuplicate: 'replace',        // 'allow' (default) | 'reject' | 'replace' | 'confirm'
  });
}

function handBackToLesson(ctx: JobContext) {
  return tool({
    name: 'handBackToLesson',
    description: 'Call when the doubt is fully resolved and the recorded class should resume.',
    parameters: z.object({
      resumeAtBeatId: z.string().describe('Beat id to resume the recording from'),
    }),
    execute: async ({ resumeAtBeatId }, { ctx: runCtx }) => {
      // Let the spoken sentence finish before yanking the room back.
      await runCtx.waitForPlayout();
      await pushToClient(ctx, { type: 'resume_lesson', beatId: resumeAtBeatId });
      ctx.shutdown('doubt resolved');   // ends the job, runs shutdown callbacks
      return 'Handed back to the recorded lesson.';
    },
  });
}

// Tools are attached either on the Agent (`Agent.create({ tools: [...] })`) or on
// the session (`new AgentSession({ tools: [...] })`). Both accept an ARRAY of tools
// or an OBJECT MAP, where the key supplies the name:
//   tools: { showDiagram: tool({ description, parameters, execute }) }  // no `name` field
// For tools sharing a resource (DB pool, MCP client), wrap them in
//   Toolset.create({ id, tools, setup, aclose })


// =============================================================================
// 4. AGENT -> BROWSER STRUCTURED MESSAGE (three options; pick per use case)
// =============================================================================

// ---- AGENT SIDE (@livekit/rtc-node 0.13.34) --------------------------------

// (A) DATA PACKET — fire-and-forget, best for "put this diagram on the canvas".
async function pushToClient(ctx: JobContext, msg: Record<string, unknown>) {
  await ctx.room.localParticipant!.publishData(
    new TextEncoder().encode(JSON.stringify(msg)),
    {
      reliable: true,
      topic: 'tutor-control',
      // !! snake_case on the AGENT side. See gotchas.
      destination_identities: [],   // [] = broadcast to everyone in the room
    },
  );
}

// (B) TEXT STREAM — for anything long or chunked (streamed explanation text).
await ctx.room.localParticipant!.sendText(JSON.stringify(msg), {
  topic: 'tutor-control',
  destinationIdentities: ['student-42'],   // camelCase here. Yes, really.
  attributes: { lessonId: 'l-12' },
});
// or incrementally:
const w = await ctx.room.localParticipant!.streamText({ topic: 'tutor-notes' });
await w.write('partial…'); await w.close();

// (C) RPC — when the agent needs an ANSWER back from the browser.
//     e.g. "which diagrams are currently on screen?"
const reply: string = await ctx.room.localParticipant!.performRpc({
  destinationIdentity: 'student-42',
  method: 'getCanvasState',
  payload: JSON.stringify({ lessonId: 'l-12' }),
  responseTimeout: 10_000,   // ms, default 10000
});

// And the reverse — browser calls the agent (this is your "raise hand" trigger
// if the agent is already in the room):
ctx.room.localParticipant!.registerRpcMethod(
  'raiseHand',
  async ({ requestId, callerIdentity, payload, responseTimeout }) => {
    const { beatId } = JSON.parse(payload);
    // ... reconfigure the session for this beat ...
    return JSON.stringify({ ok: true });   // MUST return a string
  },
);


// ---- BROWSER SIDE (livekit-client 2.22.0) ----------------------------------
import { Room, RoomEvent, type RpcInvocationData } from 'livekit-client';

const room = new Room();
await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, tokenFromYourServer);

// matches (A) publishData
room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
  if (topic !== 'tutor-control') return;
  const msg = JSON.parse(new TextDecoder().decode(payload));
  switch (msg.type) {
    case 'show_diagram':  canvas.showDiagram(msg.diagramId, msg.caption); break;
    case 'resume_lesson': player.resumeAt(msg.beatId); break;
  }
});

// matches (B) sendText / streamText
room.registerTextStreamHandler('tutor-control', async (reader, participantInfo) => {
  const text = await reader.readAll();          // whole payload
  handle(JSON.parse(text));
  // or stream it:  for await (const chunk of reader) { ... }
});

// matches (C) performRpc from the agent
// NOTE: on livekit-client 2.22 use room.registerRpcMethod —
// localParticipant.registerRpcMethod is @deprecated.
room.registerRpcMethod('getCanvasState', async (data: RpcInvocationData) => {
  return JSON.stringify({ visible: canvas.visibleDiagramIds() });   // must return string
});

// and to raise the hand:
await room.localParticipant.performRpc({
  destinationIdentity: 'ai-tutor',
  method: 'raiseHand',
  payload: JSON.stringify({ beatId: player.currentBeatId }),
});


// =============================================================================
// 5. DETECTING THE PARTICIPANT + READING METADATA (lesson id + beat id)
// =============================================================================

// ---- SERVER: mint the student's token with the context baked in -------------
import { AccessToken } from 'livekit-server-sdk';

const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
  identity: 'student-42',
  name: 'Aarav',
  // (i) participant metadata: one opaque string, read as participant.metadata
  metadata: JSON.stringify({ lessonId: 'l-12', beatId: 'b-07', studentName: 'Aarav' }),
  // (ii) participant attributes: flat string map, read as participant.attributes.
  //      Preferred for values you want to CHANGE live without a new token.
  attributes: { 'lesson.id': 'l-12', 'lesson.beat': 'b-07' },
});
at.addGrant({ roomJoin: true, room: 'lesson-l-12-aarav', canPublish: true, canSubscribe: true });
const token = await at.toJwt();

// ---- AGENT: three ways to get the participant ------------------------------

// (1) Block until anyone joins, or until a SPECIFIC identity joins.
const p1 = await ctx.waitForParticipant();               // first non-agent participant
const p2 = await ctx.waitForParticipant('student-42');   // that exact identity

// (2) Register a callback that fires for EVERY participant that joins.
//     Throws FunctionExistsError if called twice.
ctx.addParticipantEntrypoint(async (job, participant) => {
  console.log('joined:', participant.identity, participant.metadata, participant.attributes);
});

// (3) Raw room events (also gives you live metadata/attribute updates).
ctx.room.on(RoomEvent.ParticipantConnected, (p) => { /* p: RemoteParticipant */ });
ctx.room.on(RoomEvent.ParticipantMetadataChanged, (metadata, participant) => { /* string | undefined */ });
ctx.room.on(RoomEvent.ParticipantAttributesChanged, (changed, participant) => { /* Record<string,string> */ });

// ---- AGENT: every place the lesson/beat can arrive -------------------------
// live objects (@livekit/rtc-node):
student.identity;      // string
student.name;          // string | undefined
student.metadata;      // string  -> JSON.parse it
student.attributes;    // Record<string, string>
ctx.room.name;         // string | undefined
ctx.room.metadata;     // string | undefined   <- ROOM metadata, set via RoomService

// job snapshot (@livekit/protocol, available immediately, no room round-trip):
ctx.job.id;                      // string
ctx.job.metadata;                // string — DISPATCH metadata (see below). Best channel.
ctx.job.room?.metadata;          // room metadata at job-creation time
ctx.job.participant?.identity;   // ParticipantInfo | undefined
ctx.job.participant?.metadata;   // participant metadata at job-creation time
ctx.job.attributes;              // Record<string,string>
ctx.proc.userData;               // whatever prewarm() stashed

// ---- BEST CHANNEL FOR "which lesson/beat did they raise a hand on" ---------
// Explicit dispatch. Because ServerOptions.agentName is set, the worker only gets
// jobs you explicitly dispatch — and dispatch carries its own metadata string,
// which lands as ctx.job.metadata. Dispatch on the "raise hand" click:
import { AgentDispatchClient } from 'livekit-server-sdk';

const dispatch = new AgentDispatchClient(
  process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!,
);
await dispatch.createDispatch('lesson-l-12-aarav', 'ai-tutor', {
  metadata: JSON.stringify({ lessonId: 'l-12', beatId: 'b-07', raisedAt: Date.now() }),
});
// then in entry():  const { lessonId, beatId } = JSON.parse(ctx.job.metadata);
// This is cleaner than participant metadata because the beat CHANGES between
// hand-raises, and dispatch metadata is per-invocation rather than per-token.


// =============================================================================
// 6. NODE 24 + TYPESCRIPT WITH NO BUILD STEP  -> YES.
// =============================================================================
//   node src/agent/main.ts dev
//   node src/agent/main.ts start
//
// No tsx. No bundler. No tsc emit. LiveKit's own official starter template
// (livekit-examples/agent-starter-node) pins "engines": { "node": ">=24.0.0" },
// has NO build script, and its scripts are exactly the two lines above.
//
// WHY IT WORKS: Node 24 has type stripping ON BY DEFAULT (unflagged since 22.18 /
// 23.6). Node erases the type annotations and runs the file. No type CHECKING
// happens at runtime — keep a separate `tsc --noEmit` in CI. Your repo already
// has a `typecheck` script; point it at the agent too.
//
// THE ONE CONSTRAINT: your agent file and everything it imports must be
// ERASABLE-ONLY TypeScript. Banned without a flag:
//     enum   (use `const X = {...} as const`)
//     namespace with a runtime body
//     constructor parameter properties  (constructor(private x: string) {})
//     experimentalDecorators with emitDecoratorMetadata
// If you need enums, add --experimental-transform-types — but see the child-process
// gotcha below before you do.
//
// tsconfig for this to work cleanly:
//   { "compilerOptions": {
//       "module": "nodenext", "moduleResolution": "nodenext",
//       "target": "es2023", "allowImportingTsExtensions": true,
//       "rewriteRelativeImportExtensions": true, "verbatimModuleSyntax": true,
//       "erasableSyntaxOnly": true,          // <- makes tsc enforce the constraint for you
//       "noEmit": true } }
//
// IMPORT EXTENSIONS: with nodenext + allowImportingTsExtensions you write
//   import { createTutorAgent } from './tutor-agent.ts';   // .ts, not .js, not extensionless
//
// PRODUCTION: `node src/agent/main.ts start`. Type stripping costs a few ms of
// startup once per process — irrelevant for a long-lived worker.

## GOTCHAS
- THE 0.x -> 1.7 RENAME, the one that will bite you first: `WorkerOptions` is now `ServerOptions` and `Worker` is now `AgentServer`. The old names are still exported as `@deprecated` aliases (dist/worker.d.ts:122-131) so old code compiles and runs — which means every 0.x blog post and LLM-generated snippet you find will LOOK correct and will not error. Write `ServerOptions`. Anything you read that says `new WorkerOptions(...)` is pre-1.x-era code and probably wrong in other ways too (most importantly it will use the removed `multimodal`/`pipeline` agent classes instead of `AgentSession`).
- Your entry file MUST have a DEFAULT EXPORT that is the object returned by `defineAgent`. The framework forks a child process and does `import(<agent path>)`, then reads `module.default`. A named export throws at job time, not at startup: 'Unable to load agent: Missing or invalid default export in {file}' (src/ipc/job_proc_lazy_main.ts:231-238). You get a clean boot and a failure only when the first student raises their hand.
- `publishData` uses SNAKE_CASE `destination_identities` on the agent side (@livekit/rtc-node DataPublishOptions), but CAMELCASE `destinationIdentities` on the browser side (livekit-client) AND in `sendText`/`streamText` on both sides. Get it wrong on the agent and TypeScript accepts nothing... actually worse: the wrong key is silently ignored as an excess property in some call shapes, so your targeted message quietly broadcasts to the whole room. For a classroom with one student that is harmless; the day you put two students in a room it is a privacy bug. I verified both declaration files directly.
- Setting `agentName` in ServerOptions FLIPS THE DISPATCH MODEL. With `agentName` unset, the worker auto-joins every new room in the project. The moment you set it, automatic dispatch is off and the worker receives NOTHING until you either name the agent in the end-user's token roomConfig or call `AgentDispatchClient.createDispatch(...)`. This is the behavior you want for 'raise hand' (don't burn an LLM session for every student who just watches), but if you set the name and forget the dispatch call, the worker sits there logging 'registered worker' forever and looks healthy while doing nothing.
- `session.start({ room: ctx.room })` AUTO-CONNECTS the room if it isn't connected yet (src/voice/agent_session.ts:909-915) — which is why LiveKit's own basic_agent.ts example never calls `ctx.connect()`. But if you need participant metadata to BUILD the agent's instructions (you do — lesson id and beat id), you must `await ctx.connect()` and then `await ctx.waitForParticipant()` BEFORE constructing the Agent. Relying on auto-connect means the room isn't up yet when you try to read metadata, and `ctx.waitForParticipant()` would be your only sync point.
- zod is a PEER dependency (`^3.25.76 || ^4.1.8`), not a bundled one — `npm i zod` yourself or tool definitions fail to resolve. Both zod 3 and zod 4 are accepted, which is unusual and worth pinning deliberately. `parameters` also accepts a raw JSONSchema7 object if you'd rather not add zod; omit `parameters` entirely for a zero-argument tool and `execute` receives `{}`.
- Node 24's default type stripping is ERASABLE SYNTAX ONLY. `enum`, `namespace` with a runtime body, and constructor parameter properties all throw at load. Set `"erasableSyntaxOnly": true` in tsconfig so `tsc --noEmit` catches this in CI instead of at 2am in production. If you genuinely need `--experimental-transform-types`, note that the framework forks child processes for every job — `child_process.fork` inherits `process.execArgv` by default so the flag does propagate, but this is the fragile path. Staying erasable-only is the handover-friendly choice.
- WINDOWS RISK, unverified by me: the child-process loader does `import(pathToFileURL(moduleFile).pathname)` (src/ipc/job_proc_lazy_main.ts:231), which on Windows yields the specifier `/C:/Users/...`. I could not execute this — the packages aren't installed and you asked me not to install. Boot the worker on Windows once before you build anything on top of it. If it fails, the fix is WSL or a Linux container, which is where this deploys anyway.
- The `dev` subcommand still works but 1.7 marks it 'Deprecated: use `lk agent dev` instead' in its own help text. LiveKit is steering everyone to the `lk` CLI. `node src/agent/main.ts dev` is fine today; just don't be surprised by the deprecation notice in your logs, and don't let it send you hunting for a bug that isn't there.
- 1.7 exports OpenTelemetry traces and logs BY DEFAULT (@opentelemetry/* are direct dependencies, and `record` defaults to all-categories-on: audio, traces, logs, transcript). For a student-facing product recording minors' voices, decide this deliberately rather than by default — pass `record: { audio: false, transcript: false }` to `session.start()` if you don't want session audio and chat history uploaded.
- The built-in `inference.*` models (STT/LLM/TTS/VAD/TurnDetector/AvatarSession) ship INSIDE @livekit/agents 1.7 and route through LiveKit's inference gateway using your LIVEKIT_API_KEY — no per-provider plugin package and no OpenAI/Deepgram key in your env. That is the shortest path to your 'API key stays server-side' requirement. The tradeoff is that you're billed through LiveKit and limited to the models they front. `inference.AvatarSession` is the same story for the talking avatar: it joins the room as a second participant and publishes video, no separate avatar service wiring.
- When you attach an avatar via `inference.AvatarSession`, do NOT also publish the agent's audio into the room. The avatar worker republishes the audio in lipsync with the video; publishing both gives you double audio, slightly out of phase. This is not enforced by types.

## SOURCES
- npm registry: `npm view @livekit/agents@1.7.0` — confirmed 1.7.0 is dist-tag `latest`; peerDependencies `@livekit/rtc-node ^0.13.34`, `zod ^3.25.76 || ^4.1.8`; bin `livekit-agents`; no `engines` field
- @livekit/agents@1.7.0 tarball, extracted (read-only, outside your repo) to C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lk\package
- …\scratchpad\lk\package\dist\generator.d.ts — defineAgent / AgentDefinition
- …\scratchpad\lk\package\dist\worker.d.ts — ServerOptions / AgentServer, and the @deprecated WorkerOptions / Worker aliases (lines 122-131)
- …\scratchpad\lk\package\dist\cli.d.ts and src\cli.ts (lines 106-300) — runApp, all subcommands, all flag-to-env bindings
- …\scratchpad\lk\package\src\worker.ts (lines 268-359) — LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_AGENT_NAME resolution and exact MissingCredentialsError strings
- …\scratchpad\lk\package\dist\job.d.ts — JobContext.connect / waitForParticipant / addParticipantEntrypoint / addShutdownCallback / shutdown, JobProcess, JobRequest, AutoSubscribe
- …\scratchpad\lk\package\dist\voice\agent_session.d.ts (AgentSessionOptions line 139, start() line 432) and src\voice\agent_session.ts lines 909-915 (room auto-connect)
- …\scratchpad\lk\package\dist\voice\agent.d.ts + dist\voice\agent_v2.d.ts — Agent.create, AgentOptions, AgentHooks
- …\scratchpad\lk\package\dist\llm\tool_context.d.ts (lines 309-372) — the two tool() overloads, ToolExecuteFunction, ToolOptions, ToolFlag, DuplicateMode, Toolset
- …\scratchpad\lk\package\dist\voice\run_context.d.ts — RunContext.session / userData / waitForPlayout / update / filler
- …\scratchpad\lk\package\dist\voice\room_io\room_io.d.ts — RoomInputOptions / RoomOutputOptions incl. participantIdentity, closeOnDisconnect, deleteRoomOnClose
- …\scratchpad\lk\package\dist\voice\events.d.ts — AgentSessionEventTypes enum, CloseReason
- …\scratchpad\lk\package\dist\inference\index.d.ts + avatar.d.ts — inference.STT/LLM/TTS/VAD/TurnDetector/AvatarSession
- …\scratchpad\lk\package\src\ipc\job_proc_executor.ts (lines 72-81) and src\ipc\job_proc_lazy_main.ts (lines 222-245) — child fork, execArgv inheritance, and the required default export
- @livekit/rtc-node@0.13.34 tarball → dist\participant.d.ts (publishData/sendText/streamText/performRpc/registerRpcMethod, DataPublishOptions with snake_case destination_identities), dist\room.d.ts (RoomEvent, participantConnected/MetadataChanged/AttributesChanged), dist\rpc.d.ts (PerformRpcParams, RpcInvocationData, RpcError)
- livekit-client@2.22.0 tarball → dist\src\room\Room.d.ts (registerRpcMethod at Room level; LocalParticipant.registerRpcMethod is @deprecated), dist\src\room\types.d.ts (camelCase destinationIdentities), dist\src\room\data-stream\incoming\StreamReader.d.ts (TextStreamHandler, TextStreamReader.readAll)
- livekit-server-sdk@2.18.0 tarball → dist\AccessToken.d.ts — metadata, attributes, roomConfig, addGrant, toJwt
- @livekit/protocol@1.50.4 tarball → src\gen\livekit_agent_pb.d.ts (Job.metadata/room/participant/attributes), livekit_models_pb.d.ts (ParticipantInfo), livekit_agent_dispatch_pb.d.ts (RoomAgentDispatch)
- https://raw.githubusercontent.com/livekit/agents-js/main/examples/src/basic_agent.ts — LiveKit's own canonical 1.x entry file
- https://docs.livekit.io/agents/start/voice-ai/ — official Node/TS quickstart
- https://raw.githubusercontent.com/livekit-examples/agent-starter-node/main/package.json — engines node >=24.0.0, no build script, "dev": "node src/main.ts dev", "start": "node src/main.ts start"
- https://raw.githubusercontent.com/livekit-examples/agent-starter-node/main/.env.example — LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
- https://nodejs.org/api/typescript.html — type stripping default in Node 24, erasable-syntax-only constraint, --experimental-transform-types for enums