# @livekit/agents-plugin-google 1.7.0 — google.realtime.RealtimeModel (Gemini Live bidirectional audio) for the LiveKit Node agent

## VERIFIED
VERIFIED against primary source. The package was not installed anywhere on this machine, so I pulled the published tarball from the npm registry into the scratchpad (read-only, nothing in "C:/Users/HP/Ai Tutor" was touched, no npm command was run) and read the shipped .d.ts AND the compiled .js:

- npm registry confirms `dist-tags.latest = 1.7.0`. Deps: `@google/genai ^2.13.0`, `google-auth-library ^10.6.2`, `openai ^6.8.1`. Peers: `@livekit/agents 1.7.0` (exact), `@livekit/rtc-node ^0.13.34`.
- Read: C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\dist\realtime\realtime_api.d.ts and realtime_api.js (the constructor body, buildConnectConfig, handleServerContent, handleToolCall, generateReply, interrupt, close), dist\realtime\api_proto.d.ts, dist\tools.d.ts, dist\utils.js, dist\index.d.ts, dist\beta\index.d.ts, README.md.
- Cross-read @google/genai 2.18.0 (`genai.d.ts`, `node/index.mjs`) for the exact shapes of AudioTranscriptionConfig / RealtimeInputConfig / AutomaticActivityDetection and for the API-key + vertexai env resolution.
- Cross-read @livekit/agents 1.7.0 `dist/llm/realtime.d.ts` (RealtimeCapabilities, InputTranscriptionCompleted, GenerationCreatedEvent) and `dist/voice/events.d.ts` (user_input_transcribed, conversation_item_added).

Every default I state (voice "Puck", modalities [AUDIO], transcription-on, turn detection true, per-backend default model) was read out of the compiled constructor, not inferred.

INFERENCE / NOT CONFIRMED, flagged honestly:
1. `gemini-2.5-flash-native-audio-latest` — I could NOT confirm this id exists as a Google alias. It is definitively NOT in the plugin's `LiveAPIModels` union, and a web search found no Google doc for it. The plugin will still send it verbatim (see gotcha 1), so if your key really serves it, it will work; I just cannot verify the id itself.
2. I did not run any of this code. No live connection was made to Gemini.
3. The AgentSession-level wiring (`voice.AgentSession({ llm: realtimeModel })`) is read from the agents 1.7.0 type surface, not executed.
4. The LiveKit docs page shows the DEPRECATED `google.beta.realtime.RealtimeModel` path; the shipped 1.7.0 `beta/index.d.ts` marks that `@deprecated` in favour of top-level `google.realtime`. I used the shipped code, not the docs page, as the source of truth.

## API
// package.json — @livekit/agents must be EXACTLY 1.7.0 (exact peer dep)
//   "@livekit/agents": "1.7.0"
//   "@livekit/agents-plugin-google": "1.7.0"
//   "@livekit/rtc-node": "^0.13.34"
//   "@google/genai": "^2.13.0"      // add explicitly: you need its enums, plugin re-exports only 2

import { llm, voice, type JobContext } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
// The plugin re-exports ONLY Behavior + FunctionResponseScheduling from realtime/index.
// Modality, ActivityHandling, StartSensitivity, EndSensitivity come from @google/genai directly.
import {
  Modality,
  ActivityHandling,
  StartSensitivity,
  EndSensitivity,
  MediaResolution,
  Behavior,
  FunctionResponseScheduling,
} from '@google/genai';
import { z } from 'zod';

// ───────────────────────── 1. CONSTRUCTOR: every option, with real defaults ──
const realtimeModel = new google.realtime.RealtimeModel({
  // --- the six you asked about ---
  model: 'gemini-2.5-flash-native-audio-preview-12-2025', // default when vertexai:false
                                                          // default when vertexai:true  = 'gemini-live-2.5-flash-native-audio'
  voice: 'Puck',              // default 'Puck'. Type: Voice | string (30 prebuilt names)
  temperature: 0.8,           // NO default — omitted from the connect config entirely if undefined
  instructions: 'You are a Class 9 physics tutor...', // → config.systemInstruction.parts[0].text
  apiKey: process.env.GOOGLE_API_KEY, // default: process.env.GOOGLE_API_KEY
  language: 'en-IN',          // BCP-47 → speechConfig.languageCode (OUTPUT speech language)
  modalities: [Modality.AUDIO], // default [Modality.AUDIO]. See gotcha 3 — do NOT add TEXT.

  // --- transcription (BOTH DEFAULT TO ON, i.e. `{}`) ---
  inputAudioTranscription:  { languageCodes: ['en-IN', 'hi-IN'] }, // pass null to DISABLE
  outputAudioTranscription: {},                                    // pass null to DISABLE
  // AudioTranscriptionConfig = { languageCodes?, customVocabulary?, wordTimestamp?, diarization? }

  // --- turn detection / barge-in ---
  realtimeInputConfig: {
    automaticActivityDetection: {
      disabled: false,                                     // default: server VAD ON
      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
      endOfSpeechSensitivity:   EndSensitivity.END_SENSITIVITY_HIGH,
      prefixPaddingMs: 200,
      silenceDurationMs: 600,
    },
    activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS, // default = barge-in ON
    // turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
  },

  // --- everything else the constructor accepts ---
  vertexai: false,            // default false
  project: undefined,         // default process.env.GOOGLE_CLOUD_PROJECT   (vertex only)
  location: undefined,        // default process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1'
  candidateCount: 1,          // default 1
  maxOutputTokens: undefined,
  topP: undefined,
  topK: undefined,
  presencePenalty: undefined, // accepted but NOT forwarded to the Live connect config in 1.7.0
  frequencyPenalty: undefined,// same — accepted, not forwarded
  imageEncodeOptions: { format: 'JPEG', quality: 75, resizeOptions: { width: 1024, height: 1024, strategy: 'scale_aspect_fit' } },
  enableAffectiveDialog: undefined,   // setting this forces apiVersion 'v1alpha'
  proactivity: undefined,             // setting this forces apiVersion 'v1alpha'
  contextWindowCompression: { triggerTokens: '25600', slidingWindow: {} },
  apiVersion: undefined,
  connOptions: undefined,     // default DEFAULT_API_CONNECT_OPTIONS from @livekit/agents
  httpOptions: undefined,
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  thinkingConfig: { thinkingBudget: 0 },  // 2.5 → thinkingBudget; 3.1 → thinkingLevel
  geminiTools: undefined,     // Omit<types.Tool,'functionDeclarations'> — GoogleSearch etc.
  toolBehavior: Behavior.BLOCKING,                       // Gemini default BLOCKING; not on Vertex
  toolResponseScheduling: FunctionResponseScheduling.WHEN_IDLE, // default WHEN_IDLE; not on Vertex
});

// ───────────────────────── 2. FUNCTION CALLING — fully supported ────────────
// Tools are converted to Gemini functionDeclarations by toToolsConfig() in dist/utils.js
// and put on config.tools. capabilities.autoToolReplyGeneration === true, so after your
// handler returns, the framework sends the functionResponse and the MODEL resumes speaking
// on its own — you do NOT call generateReply() (which matters, see gotcha 2).
class Tutor extends voice.Agent {
  constructor() {
    super({
      instructions: 'You are a Class 9 physics tutor.',
      tools: {
        showDiagram: llm.tool({
          description: 'Pull an earlier diagram back onto the classroom canvas.',
          parameters: z.object({ diagramId: z.string() }),
          execute: async ({ diagramId }, { ctx }) => {
            await ctx.room.localParticipant?.performRpc({
              destinationIdentity: 'student',
              method: 'canvas.showDiagram',
              payload: JSON.stringify({ diagramId }),
            });
            return `Diagram ${diagramId} is now on screen.`;
          },
        }),
      },
    });
  }
}

// ───────────────────────── 3. WIRING + EVENTS (captions both sides) ─────────
export default defineAgent({
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({ llm: realtimeModel });

    // STUDENT side — input transcription. Fires repeatedly with isFinal:false,
    // then once with isFinal:true (+ turnStartedAt) when the turn closes.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      // ev: { type:'user_input_transcribed', transcript, isFinal, itemId, createdAt, language }
      renderCaption('student', ev.transcript, ev.isFinal);
    });

    // TUTOR side — there is NO output-transcription event. Output transcription is
    // merged into the generation's textStream and lands in the chat context at turn end.
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      // ev.item.role === 'assistant' → the full spoken text for that turn
      renderCaption('tutor', ev.item.textContent ?? '', true);
    });

    await session.start({ agent: new Tutor(), room: ctx.room });
  },
});

// ───────────────────────── 4. RAW SESSION EVENTS (if you skip AgentSession) ─
const rt = realtimeModel.session();           // → google.realtime.RealtimeSession
rt.on('input_speech_started', () => {});      // {}
rt.on('input_speech_stopped', (e) => {});     // { userTranscriptionEnabled: false }  <- always false here
rt.on('input_audio_transcription_completed', (e) => {});
   // { itemId, transcript, isFinal, turnStartedAt? }  — cumulative transcript, not a delta
rt.on('generation_created', async (e) => {    // GenerationCreatedEvent
  for await (const msg of e.messageStream) {  // MessageGeneration
    msg.textStream;   // ReadableStream<string|TimedString> — AGENT text (output transcription)
    msg.audioStream;  // ReadableStream<AudioFrame> @ 24 kHz mono
    // TURN FINISHED = these streams CLOSE (server sent serverContent.turnComplete)
  }
  for await (const fc of e.functionStream) {} // llm.FunctionCall { callId, name, args }
});
rt.on('metrics_collected', (m) => {});
rt.on('error', (e) => {});                    // { timestamp, label:'google_realtime', error, recoverable }
                                              // bad model id arrives HERE as APIStatusError, not a throw

// ───────────────────────── 5. TURN END + CLEAN SHUTDOWN ─────────────────────
// End of turn: the server sends serverContent.turnComplete; the plugin calls
// markCurrentGenerationDone(), which closes textChannel/audioChannel/functionChannel/
// messageChannel and appends the user + assistant messages to chatCtx. There is no
// dedicated "turn_complete" event — stream closure IS the signal.
await rt.close();          // closes the genai live socket, rejects pending futures. USE THIS.
await realtimeModel.close(); // NOTE: literally `async close() {}` — a no-op. Closing the
                             // RealtimeModel does NOT close the socket.
// Under AgentSession, `await session.close()` / ctx.shutdown() drives rt.close() for you.

// Manual (client-driven) turn control — only active when automaticActivityDetection.disabled
rt.manualActivityDetection; // getter → boolean
rt.startUserActivity();     // sends realtime_input { activityStart:{} }
await rt.interrupt();       // barge-in from the agent side; respects NO_INTERRUPTION
await rt.commitAudio();     // NO-OP in this plugin
await rt.clearAudio();      // NO-OP in this plugin
await rt.truncate({...});   // NO-OP — logs "truncate is not supported by the Google Realtime API."

## GOTCHAS
- MODEL IDS — the plugin passes ANY string straight through, unvalidated. The declared union is `LiveAPIModels = 'gemini-live-2.5-flash-native-audio' | 'gemini-live-2.5-flash-preview-native-audio-09-2025' | 'gemini-live-2.5-flash-preview-native-audio' | 'gemini-3.1-flash-live-preview' | 'gemini-2.5-flash-native-audio-preview-12-2025' | 'gemini-2.0-flash-exp'`, but the option type is `LiveAPIModels | string`, which TypeScript collapses to plain `string` — so you get NO compile error and NO autocomplete narrowing for anything. `options.model || defaultModel` goes verbatim into `client.live.connect({ model })`. Your `gemini-3.1-flash-live-preview` IS in the union. Your `gemini-2.5-flash-native-audio-latest` is NOT, and I could not find it in Google's docs either — it will still be sent as-is, and if the server rejects it you find out via a websocket onclose surfacing as an `APIStatusError` on the `error` event (the plugin even appends "message may be truncated - check model name and API permissions"), never as a constructor throw.
- THE BIG ONE FOR YOUR TUTOR: `generateReply()` THROWS on gemini-3.1. The constructor computes `mutableSession = !model.includes('3.1')`, and `generateReply()` starts with `if (!capabilities.midSessionChatCtxUpdate) throw new Error(\`generateReply is not compatible with '${model}'\`)`. The shipped README says this breaks "explicit post-tool continuation, greetings, reconnect replies, and other server-triggered follow-up turns" and recommends "prefer a Gemini 2.5 native-audio live model for now." Since your 'raise hand' hand-off almost certainly opens with an agent-initiated greeting, pick `gemini-2.5-flash-native-audio-preview-12-2025`. Any id containing the substring '3.1' also silently disables `updateInstructions()`, `updateChatCtx()` and mid-session tool updates (you get a `logger.warn`, not an error) — which kills the 'bridge back into the recorded lesson by swapping the system prompt' pattern.
- MODALITIES — do not set `[Modality.TEXT, Modality.AUDIO]`. Google's Live API guide states "The native audio models only support AUDIO response modality" and points you at output transcription to get text. The plugin already does exactly that: output transcription text is written into the same `textStream` as model text. Setting `modalities: [Modality.TEXT]` flips `capabilities.audioOutput` to false and the plugin immediately closes the audio channel — no voice at all.
- TRANSCRIPTION IS ON BY DEFAULT HERE, unlike raw Gemini. The constructor reads `options.inputAudioTranscription === undefined ? {} : options.inputAudioTranscription` (same for output), so omitting them enables both. Google's own docs say both are off unless you send them in setup — the plugin flips that. To turn one OFF you must pass literal `null`, not `false` and not `undefined`.
- ASYMMETRIC TRANSCRIPT EVENTS — this bites caption UIs. INPUT (student) gets a real event: `input_audio_transcription_completed` with `{itemId, transcript, isFinal, turnStartedAt?}`, and `transcript` is CUMULATIVE (the plugin appends into `gen.inputTranscription` and re-emits the whole string), so render it as a replace, not an append. OUTPUT (tutor) gets NO event at all — `handleServerContent` writes `serverContent.outputTranscription.text` straight into `gen.textChannel` as deltas. Caption the tutor from the generation's `textStream`, or from the AgentSession's `conversation_item_added`. Also note the final input transcript arrives only at `turnComplete` — seconds after the student stopped talking — which is why `turnStartedAt` exists; use it to place the caption on the timeline.
- TURN DETECTION DEFAULT IS SERVER-SIDE VAD WITH BARGE-IN ON. `serverTurnDetection` starts `true` and only flips false if you set `realtimeInputConfig.automaticActivityDetection.disabled = true`. `activityHandling` defaults to `START_OF_ACTIVITY_INTERRUPTS`. If you set `ActivityHandling.NO_INTERRUPTION`, the plugin's own `interrupt()` becomes a silent early-return — your agent can no longer cut itself off either. If you disable server VAD you MUST drive `startUserActivity()` yourself (or attach a LiveKit `TurnDetector` via `turnHandling`), otherwise the model never takes a turn.
- `truncate()` IS A NO-OP AND `messageTruncation: false`. After a barge-in, the chat context keeps the ENTIRE text the model generated, not the portion the student actually heard. Over a long doubt session the tutor's memory drifts from what was really said in the room. `commitAudio()` and `clearAudio()` are also empty functions.
- `pushVideo()` IS AN EMPTY FUNCTION in 1.7.0 — `pushVideo(_) {}`. Despite `imageEncodeOptions` / `DEFAULT_IMAGE_ENCODE_OPTIONS` / `mediaResolution` being accepted options, no video or image frame is ever forwarded to Gemini. Concretely: your tutor CANNOT see the canvas or the diagram it just pulled up. It can only call the tool and then talk about it from the tool's return string — so make that return string descriptive. (Separately: a talking-avatar publishing video INTO the room is an @livekit/agents avatar plugin concern, unaffected by this.)
- AUTH — the realtime path reads ONLY `process.env.GOOGLE_API_KEY` (`options.apiKey || process.env.GOOGLE_API_KEY`). The README also advertises `GOOGLE_GENAI_API_KEY`, which is wrong for this path; what actually works as a fallback is `GEMINI_API_KEY`, and only because the plugin passes `apiKey: undefined` down to `new GoogleGenAI(...)`, whose `getApiKeyFromEnv()` tries `GOOGLE_API_KEY` then `GEMINI_API_KEY`. A missing key does NOT throw — you get a `console.warn('API key should be set when using the Gemini API.')` and then a websocket failure.
- VERTEX AI works (`vertexai: true` + `project` + `location`, default location 'us-central1', ADC via google-auth-library). But there is a silent-switch trap: when `vertexai` is false the plugin builds `clientOptions` as `{ apiKey, httpOptions }` with NO `vertexai` field, and `@google/genai`'s `resolveCloudFlag()` then falls back to the `GOOGLE_GENAI_USE_VERTEXAI` / `GOOGLE_GENAI_USE_ENTERPRISE` env vars. So if either is set to 'true' anywhere in your deploy environment, your AI-Studio-key session silently becomes a Vertex session. Also on Vertex: `toolBehavior` is unsupported, `toolResponseScheduling` is unsupported (the JSDoc says you are responsible for not passing it), and the plugin drops the function-call `id` (`id: vertexai ? undefined : callId`).
- IMPORT PATH — use `google.realtime.RealtimeModel`. The LiveKit docs page still shows `google.beta.realtime.RealtimeModel`; in 1.7.0 `dist/beta/index.d.ts` marks that re-export `@deprecated Use the top-level realtime export instead`. It still works, but it is not the current path. There are no subpath exports — `package.json.exports` has only `.`, so everything comes off the root import.
- `presencePenalty` and `frequencyPenalty` are accepted by the constructor and stored on `_options`, but `buildConnectConfig()` never copies them into the Gemini config. They are dead options in 1.7.0. (`temperature`, `maxOutputTokens`, `topP`, `topK` ARE forwarded, each guarded by an `!== undefined` check.)
- AUDIO FORMAT is fixed: input 16 kHz mono (the plugin auto-resamples anything else via `AudioResampler`), output 24 kHz mono. Setting `enableAffectiveDialog` or `proactivity` silently forces `apiVersion: 'v1alpha'` unless you set `apiVersion` yourself.
- RECONNECTS ARE AUTOMATIC AND STATEFUL-ISH: the plugin stores `sessionResumptionUpdate.newHandle` and replays it on reconnect, and a server `goAway` sets `sessionShouldClose` to trigger a restart. On a 3.1 model it uses a `historyConfig` splice hack (`forwardHistoryConfigToSetup`) to reseed history, because 3.1 closes the socket on a plain prefill containing `model` turns — and that hack monkey-patches `client.live.webSocketFactory`, logging `"unable to reach the Gemini Live socket factory"` if the internal genai shape changes. Pin `@google/genai` rather than letting `^2.13.0` float far.

## SOURCES
- npm registry metadata (primary): https://registry.npmjs.org/@livekit/agents-plugin-google — confirms dist-tags.latest = 1.7.0, deps and exact peer @livekit/agents 1.7.0
- SHIPPED 1.7.0 TARBALL (primary, extracted read-only to scratchpad): C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\dist\realtime\realtime_api.d.ts — full RealtimeModel/RealtimeSession type surface and every constructor option
- C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\dist\realtime\realtime_api.js — compiled implementation; source of every default (voice 'Puck', modalities [AUDIO], transcription `{}`, serverTurnDetection true, per-backend default model, `mutableSession = !model.includes('3.1')`), plus buildConnectConfig, handleServerContent, handleToolCall, generateReply's throw, interrupt, close, and the pushVideo/commitAudio/clearAudio/truncate no-ops
- C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\dist\realtime\api_proto.d.ts — the exact LiveAPIModels union and the 30-name Voice union
- C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\dist\tools.d.ts and dist\utils.js (toToolsConfig / toFunctionDeclarations) — confirms realtime function calling and the provider-tool classes
- C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\README.md — the explicit warning that generateReply() is not compatible with gemini-3.1-flash-live-preview, and the thinkingConfig model split
- C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkg\package\dist\beta\index.d.ts — marks google.beta.realtime @deprecated in favour of google.realtime
- @google/genai 2.18.0 tarball (primary): scratchpad\genai\package\dist\genai.d.ts — AudioTranscriptionConfig, RealtimeInputConfig, AutomaticActivityDetection, ActivityHandling/StartSensitivity/EndSensitivity/Behavior/FunctionResponseScheduling/Modality/MediaResolution/ThinkingConfig; and dist\node\index.mjs — GoogleGenAI constructor, getApiKeyFromEnv() (GOOGLE_API_KEY then GEMINI_API_KEY) and resolveCloudFlag() (GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_GENAI_USE_ENTERPRISE)
- @livekit/agents 1.7.0 tarball (primary): scratchpad\lka\package\dist\llm\realtime.d.ts — RealtimeCapabilities, InputTranscriptionCompleted, GenerationCreatedEvent/MessageGeneration; and dist\voice\events.d.ts — user_input_transcribed / conversation_item_added event shapes
- https://docs.livekit.io/agents/integrations/realtime/gemini/ — official docs; corroborates default model, voice 'Puck', GOOGLE_API_KEY, and the automaticActivityDetection.disabled + TurnDetector pattern (but shows the deprecated google.beta.realtime import path)
- https://ai.google.dev/gemini-api/docs/live-guide — Google primary: "The native audio models only support AUDIO response modality", "By default, the model automatically performs VAD on a continuous audio input stream", "When VAD detects an interruption, the ongoing generation is canceled and discarded", and that input/output audio transcription must be explicitly enabled in setup
- https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-native-audio-preview-12-2025 — model page for the default id; no Google page found for 'gemini-2.5-flash-native-audio-latest'