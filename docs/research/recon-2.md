# Talking-avatar plugins for LiveKit Agents JS at 1.7.0 — @livekit/agents-plugin-bey (Beyond Presence), @livekit/agents-plugin-tavus, @livekit/agents-plugin-hedra

## VERIFIED
HEADLINE: @livekit/agents-plugin-hedra@1.7.0 is a tombstone. Its AvatarSession constructor throws unconditionally on every call. Do not plan around it.

PRIMARY-SOURCE VERIFIED (I downloaded the three 1.7.0 tarballs plus @livekit/agents@1.7.0 from registry.npmjs.org into a scratchpad and read the shipped TypeScript src/ and dist/*.d.ts — these packages ship their real source, so this is the authoritative API, not a doc summary):
- All three are at 1.7.0 = latest, published 2026-08-20. All three peer-depend on "@livekit/agents": "1.7.0" EXACT (not caret) and "@livekit/rtc-node": "^0.13.34".
- Hedra: src/avatar.ts is 24 lines; `AvatarSession` is marked `@deprecated` and its constructor body is only `throw new HedraException('The Hedra realtime avatar service has been disabled...')`. The README for 1.7.0 says the same. Confirmed dead.
- Bey + Tavus exact constructor options, option names, env-var fallbacks, defaults, and the start() signature — all read directly from src/avatar.ts and src/api.ts.
- The audio-replacement mechanism: verified end-to-end in @livekit/agents@1.7.0 source. Both plugins set `agentSession.output.audio = new voice.DataStreamAudioOutput(...)`, and room_io.ts:539-540 reads `this.externalAudioOutput = this.agentSession.output.audio ?? undefined; if (this.outputOptions.audioEnabled && !this.externalAudioOutput) { ...create ParticipantAudioOutput... }`. So when an avatar is attached the agent provably never creates its own audio track. Both plugins mint an avatar token carrying `lk.publish_on_behalf` = the agent's identity, and the avatar participant publishes BOTH tracks.
- The ordering constraint is a real coded warning, not folklore: avatar_session.ts warns 'AvatarSession.start() was called after AgentSession.start(); the existing audio output may be replaced by the avatar.'
- Tavus echo mode: verified in source — TavusAPI.createPal() posts `pipeline_mode: 'echo'` with `layers.transport.transport_type: 'livekit'`. Corroborated by LiveKit's Tavus docs page.
- Bey stock avatar id: the JS plugin hardcodes 694c83e2-8895-4a98-bd16-56332ca3f449, and bey's own stock-avatar doc page confirms that UUID is "Nelly". Cross-checked, they agree.
- Pricing tiers for both vendors read off their official pricing pages.

INFERENCE / NOT CONFIRMED — flagging honestly:
- Latency numbers are VENDOR MARKETING CLAIMS, not measured by me. Bey's docs claim "250 ms speech-to-video latency and 1-second end-to-end"; Tavus claims sub-600ms utterance-to-utterance for its FULL pipeline (which is not what you're buying in echo mode). Neither is a like-for-like figure for the added avatar hop. Measure it yourself — the base class emits an `avatar_metrics` event carrying `sessionStartedAt`/`avatarJoinedAt` and `playbackLatencyMs`, so you can instrument this rather than trust either number.
- Bey custom-avatar TURNAROUND TIME AND PRICE ARE NOT PUBLISHED ANYWHERE I could find. Their doc says only "available on demand for priority customers" and "email support@beyondpresence.ai". Treat bey custom avatars as sales-gated with unknown cost/SLA.
- Whether bey's credit meter bills the BYO-agent LiveKit audio-to-video path identically to its "managed agent" minutes is NOT documented publicly. Their FAQ defines credits only as "1 credit = 1 minute of managed agent conversation". This is a genuine gap and it is exactly the number your unit economics depend on — ask bey directly before committing.
- Tavus custom-replica training DURATION in hours is not stated on the page I fetched; only the footage requirement is. The $65/$40 per-extra-replica figures come from a pricing-aggregator summary, not from Tavus's own page — treat as approximate.
- One discrepancy I could not resolve: the bey plugin POSTs to `${apiUrl}/v1/session` (SINGULAR) with body `{avatar_id, livekit_url, livekit_token}`, but bey's own public API reference documents `POST /v1/sessions` (plural) with `{avatar_id, url, token, transport:"livekit"}`. Both the src/ and the built dist/ agree on the singular form, so it is deliberate, but the docs and the shipped client do not match. Smoke-test this before you build on it.

## API
// ============================================================================
// package.json — NOTE the peer dep is pinned EXACTLY, not with a caret.
//   "@livekit/agents": "1.7.0"          <- exact; a mismatch breaks install
//   "@livekit/rtc-node": "^0.13.34"
//   "@livekit/agents-plugin-bey": "1.7.0"
// ============================================================================

// ============================================================================
// 1. BEYOND PRESENCE — @livekit/agents-plugin-bey@1.7.0   [RECOMMENDED]
// ============================================================================
import { voice, type JobContext } from '@livekit/agents';
import * as bey from '@livekit/agents-plugin-bey';

export default async function entry(ctx: JobContext) {
  await ctx.connect();

  const session = new voice.AgentSession({ stt, llm, tts });

  // The constructor THROWS BeyException if BEY_API_KEY is unset — it does not
  // fail lazily at start(). Construct it only at the moment you actually want
  // the avatar (i.e. after "raise hand"), not at worker boot.
  const avatar = new bey.AvatarSession({
    avatarId: '694c83e2-8895-4a98-bd16-56332ca3f449', // "Nelly" — the hardcoded default
    // apiKey:  process.env.BEY_API_KEY,      // optional; falls back to env
    // apiUrl:  process.env.BEY_API_URL,      // optional; defaults https://api.bey.dev
    // avatarParticipantIdentity: 'bey-avatar-agent',  // default
  });

  // MUST be called BEFORE session.start(). Reads LIVEKIT_URL / LIVEKIT_API_KEY /
  // LIVEKIT_API_SECRET from env unless you pass them in the 3rd arg.
  // Side effect: sets session.output.audio = voice.DataStreamAudioOutput(...)
  await avatar.start(session, ctx.room, {
    // livekitUrl: process.env.LIVEKIT_URL,
    // livekitApiKey: process.env.LIVEKIT_API_KEY,
    // livekitApiSecret: process.env.LIVEKIT_API_SECRET,
  });

  // Inherited from voice.AvatarSession. Resolves once the avatar participant has
  // joined AND published its video track. camelCase in JS; default 30_000 ms.
  await avatar.waitForJoin({ timeout: 30_000 });

  await session.start({
    agent,
    room: ctx.room,
    // JS uses inputOptions/outputOptions. (Python's room_input_options /
    // room_output_options do NOT exist here.) audioEnabled:false just silences
    // the "preserving existing output.audio" warning — RoomIO already skips
    // making its own track once output.audio is set.
    outputOptions: { audioEnabled: false },
  });

  // --- handing the room back to the recorded class ---
  // Removes 'bey-avatar-agent' from the room via RoomServiceClient.
  // Already auto-registered as a job shutdown callback by the base class,
  // so call it explicitly only for a mid-session hand-back.
  // await avatar.aclose();
}

// ============================================================================
// 2. TAVUS — @livekit/agents-plugin-tavus@1.7.0
// ============================================================================
import * as tavus from '@livekit/agents-plugin-tavus';

// Constructor throws TavusException if TAVUS_API_KEY is unset (it builds a
// TavusAPI eagerly). Same "construct late" advice as bey.
const avatar = new tavus.AvatarSession({
  // 1.7.0 RENAMED these. faceId/palId are current; replicaId/personaId are
  // deprecated aliases that still work but log a warning.
  faceId: process.env.TAVUS_FACE_ID, // optional -> falls back to TAVUS_FACE_ID
  palId:  process.env.TAVUS_PAL_ID,  // optional -> falls back to TAVUS_PAL_ID,
                                     //             then to stock pal 'pb87e71797da'
  // apiUrl: 'https://tavusapi.com/v2',   // default
});

await avatar.start(session, ctx.room);      // before session.start(), same as bey
await avatar.waitForJoin({ timeout: 30_000 });
await session.start({ agent, room: ctx.room, outputOptions: { audioEnabled: false } });

// Populated after start() — useful for correlating with Tavus-side billing.
console.log(avatar.conversationId);

// Optional: build your own PAL once, offline, then reuse its id forever.
// createPal() hardcodes pipeline_mode:'echo' + transport 'livekit' for you.
const api = new tavus.TavusAPI({ apiKey: process.env.TAVUS_API_KEY });
const palId = await api.createPal({ defaultFaceId: '<your-face-id>' });

// ============================================================================
// 3. HEDRA — @livekit/agents-plugin-hedra@1.7.0   [DEAD — DO NOT USE]
// ============================================================================
// The entire shipped implementation is this:
//
//   /** @deprecated The Hedra realtime avatar service has been disabled. */
//   export class AvatarSession {
//     constructor(..._args: unknown[]) {
//       throw new HedraException(
//         'The Hedra realtime avatar service has been disabled. ' +
//         'Please visit https://docs.livekit.io/agents/integrations/avatar/ ...');
//     }
//   }
//
// There is no code path that works. `new hedra.AvatarSession({})` throws.

## GOTCHAS
- HEDRA IS DEAD AT 1.7.0. `new hedra.AvatarSession(...)` throws HedraException unconditionally — the constructor body is nothing but a throw. It is not degraded or unsupported, it is a deliberate tombstone shipped by LiveKit, and it is marked Deprecated in LiveKit's provider table. It has no free tier because it has no tier at all. Cut it from consideration entirely.
- ORDERING IS LOAD-BEARING: call `avatar.start(session, room)` BEFORE `session.start(...)`. avatar_session.ts explicitly warns 'AvatarSession.start() was called after AgentSession.start(); the existing audio output may be replaced by the avatar.' Get this backwards in your raise-hand handler and you swap the audio sink mid-utterance.
- The avatar REPLACES the agent's audio track — it does not add video alongside it. Proven at room_io.ts:539-540: RoomIO only creates its own ParticipantAudioOutput `if (audioEnabled && !externalAudioOutput)`, and the plugin has already set output.audio. Your frontend must therefore render the participant with identity `bey-avatar-agent` / `tavus-avatar-agent` (kind `agent`, attribute `lk.publish_on_behalf` = your agent's identity), NOT the agent participant — the agent participant now publishes nothing. This is the single most likely thing to break your player.
- NEITHER SERVICE SPEAKS. Both are pure lip-sync: your own STT/LLM/TTS still run and your TTS audio is piped to the avatar over a LiveKit data stream (DataStreamAudioOutput; Tavus at 24000 Hz). Tavus enforces this with `pipeline_mode: 'echo'`. Practically: you keep full control of the Hinglish voice and you keep paying your TTS bill on top of the avatar bill — the avatar minute price is NOT all-in.
- JS OPTION NAMES DIFFER FROM PYTHON. `session.start({ agent, room, inputOptions, outputOptions })` — there is no `roomInputOptions`/`roomOutputOptions` in the JS SDK. Nearly every blog post and LLM answer you'll find is Python and will silently mislead you here.
- `resumeFalseInterruption` IS SILENTLY IGNORED whenever an avatar is attached. DataStreamAudioOutput is constructed with `{ pause: false }`, so agent_session.ts logs 'resumeFalseInterruption is enabled but audio output does not support pause, it will be ignored'. In a noisy Indian classroom or on a shared laptop mic, false interruptions are exactly the failure mode you'd want that feature for, and you cannot have it with an avatar.
- BOTH CONSTRUCTORS THROW ON A MISSING API KEY, at construction time, not at start(). Build the AvatarSession lazily inside the raise-hand path and wrap it, or a missing env var takes down the whole worker instead of just degrading to voice-only.
- FREE-TIER SESSION CAPS WILL BITE THIS EXACT PRODUCT: Beyond Presence free = 3-minute max session, 40 min/month, 1 concurrent, stock avatars only. Tavus free = 5-minute max conversation, 25 min/month, 1 concurrent. A single doubt burst fits; a real tutoring session does not, and 1 concurrent stream means literally one student at a time. Both free tiers are prototype-only.
- CONCURRENCY IS YOUR REAL SCALING UNIT, and it is priced brutally. Concurrent streams = simultaneous students with a hand raised. Bey: 1 free / 10 on €49 / 25 on €149 / 50 on €349. Tavus: 1 free / 3 on $59 / 10 on $397. If 20 students hit 'raise hand' during the same evening batch, Tavus Starter (3 streams) drops 17 of them.
- PER-MINUTE COST DOMINATES YOUR P&L AND TAVUS IS ~3x BEY. Bey overage €0.0875-0.175/min vs Tavus $0.32-0.37/min. At bey Growth (€0.10/min), 30 avatar-minutes per student per month is ~€3/student/month; the same usage on Tavus Starter is ~$11/student/month. For an Indian school price point that difference is the whole business model.
- BEY CUSTOM AVATARS ARE NOT SELF-SERVE. You email a 4-5 minute (2 min absolute minimum), 1080p, green-screen, single-person video to support@beyondpresence.ai, and the doc says the service is 'available on demand for priority customers'. No published price, no published turnaround. Their doc also warns long hair and beards currently give suboptimal results — relevant if you want a recognisably Indian male teacher avatar.
- TAVUS IS THE ONLY SELF-SERVE PATH TO A CUSTOM FACE, and it accepts a SINGLE PHOTO (lower fidelity) or a ~1-2 min video (30s speaking + 30s listening). But custom faces are gated to Starter ($59) and above — you cannot make one on the free plan. Extra replicas beyond quota run roughly $65 (Starter) / $40 (Growth) each.
- TAVUS 1.7.0 JUST RENAMED ITS CORE OPTIONS: replicaId -> faceId, personaId -> palId, and TAVUS_REPLICA_ID -> TAVUS_FACE_ID, TAVUS_PERSONA_ID -> TAVUS_PAL_ID. Old names still resolve but emit deprecation warnings. Any tutorial older than this release uses the dead names.
- BEY'S DEFAULT AVATAR ID DIFFERS BETWEEN THE JS PACKAGE AND LIVEKIT'S DOCS. The JS plugin hardcodes 694c83e2-8895-4a98-bd16-56332ca3f449 ('Nelly'); LiveKit's integration page quotes b9be11b8-89fb-4227-8f86-4a881393cbdb. Pass avatarId explicitly rather than relying on either default.
- BEY ENDPOINT MISMATCH, UNRESOLVED: the shipped client (both src and dist) POSTs `/v1/session` with `{avatar_id, livekit_url, livekit_token}`, while bey's public API reference documents `POST /v1/sessions` with `{avatar_id, url, token, transport}`. Smoke-test the real call early instead of assuming the docs describe what the plugin sends.
- USE THE BUILT-IN METRICS INSTEAD OF TRUSTING VENDOR LATENCY CLAIMS. The base AvatarSession emits an `avatar_metrics` event carrying sessionStartedAt/avatarJoinedAt (join latency) and playbackLatencyMs, and forwards it to the session's MetricsCollected event. That gives you real numbers from Indian networks, which is the only figure that matters here.
- `avatar.aclose()` IS YOUR HAND-BACK PRIMITIVE — it removes the avatar participant from the room via RoomServiceClient. It's auto-registered as a job shutdown callback, but for a mid-session hand-back to the recorded class you must call it yourself. Note that re-creating the avatar afterwards means a fresh vendor session, a fresh join latency, and on bey a fresh billed session.
- Bey's agents auto-timeout after 5 minutes of inactivity to stop credit burn. If a student raises a hand, gets an answer, then goes quiet while thinking, the avatar may drop out from under you — plan the reconnect.

## SOURCES
- registry.npmjs.org tarball @livekit/agents-plugin-bey@1.7.0 — src/avatar.ts, src/index.ts, dist/avatar.d.ts (published 2026-08-20)
- registry.npmjs.org tarball @livekit/agents-plugin-tavus@1.7.0 — src/avatar.ts, src/api.ts, src/index.ts (published 2026-08-20)
- registry.npmjs.org tarball @livekit/agents-plugin-hedra@1.7.0 — src/avatar.ts (the throw-only tombstone) and README.md
- registry.npmjs.org tarball @livekit/agents@1.7.0 — src/voice/avatar/avatar_session.ts, src/voice/avatar/datastream_io.ts, src/voice/room_io/room_io.ts (lines 539-540), src/voice/agent_session.ts (start signature, canPause warnings)
- https://docs.livekit.io/agents/models/avatar/ — avatar architecture, lk.publish_on_behalf, ordering, provider table showing Hedra Deprecated
- https://docs.livekit.io/agents/integrations/avatar/bey/ and https://docs.livekit.io/agents/models/avatar/plugins/tavus/ — official code samples
- https://www.beyondpresence.ai/pricing — Free/Starter/Growth/Scale tiers, minutes, overage, custom-avatar counts, concurrency, session caps
- https://docs.bey.dev/ , https://docs.bey.dev/learn/faqs , https://docs.bey.dev/concepts/avatars/stock.md , https://docs.bey.dev/concepts/avatars/custom.md , https://docs.bey.dev/api-reference/sessions/create-livekit-audio-to-video-session.md
- https://www.tavus.io/pricing — Basic/Starter/Growth tiers, concurrency, max conversation duration
- https://docs.tavus.io/sections/replica/overview — single photo vs 1-2 min video, consent requirements, custom faces gated to paid plans
- https://www.tavus.io/blog/phoenix-4-real-time-human-rendering-with-emotional-intelligence — sub-600ms claim (vendor marketing)