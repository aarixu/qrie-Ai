# livekit-server-sdk 2.18.0 (Node) + livekit-client 2.22.0 (browser) — join tokens, explicit agent dispatch, mic-only publish, agent audio/video subscribe, data + text-stream messages, connection/agent-ready events, bundle cost and dynamic import.

## VERIFIED
VERIFIED BY EXECUTION + SHIPPED .d.ts, not from memory.

Method: downloaded the npm tarballs for livekit-server-sdk@2.18.0 and livekit-client@2.22.0 into a scratchpad (repo and its node_modules untouched), read the shipped .d.ts, then actually RAN both packages in Node to confirm behaviour.

Both versions are the current npm `latest` (registry.npmjs.org dist-tags, checked today).

Confirmed by running real code, not by reading docs:
- `toJwt()` returns a Promise — asserted `t instanceof Promise === true`. Minted a real JWT and decoded the payload; claim shape below is a verbatim decode.
- Default ttl = 21600s (6h) — measured as `exp - nbf` on a token minted with no ttl.
- `at.roomConfig = new RoomConfiguration({agents:[new RoomAgentDispatch(...)]})` — minted and decoded; the `roomConfig.agents[]` claim is verbatim from that decode.
- `ParticipantKind.AGENT === 4`, `ConnectionState` values, `RoomEvent.Connected === "connected"`, `Track.Source.Microphone === "microphone"` — all read off the live module object.
- livekit-client's ESM entry imports cleanly in bare Node with no DOM (its webrtc-adapter bootstrap is `window`-guarded), so a dynamic import is safe in an SSR/Next.js file.
- `setMicrophoneEnabled(false)` → read the compiled `setTrackEnabled` branch: it calls `track.mute()`. Only ScreenShare unpublishes. Publication survives.
- Bundle size measured on the shipped files AND cross-checked against bundlephobia (two independent numbers that agree).

GAPS — not confirmed, do not treat as settled:
1. The AGENT-SIDE code is out of scope of these two packages. How your worker reads `participant.metadata` / `participant.attributes` and how it registers `agentName` depends on which agents SDK you run (@livekit/agents for Node, livekit-agents for Python). I read @livekit/agents' `constants.d.ts` for the topic names below, but I did not verify the worker registration API.
2. `RoomAgentDispatch.attributes` (a `map<string,string>` field, protocol 1.48.0) looks like a newer way to pass structured data to a dispatched agent alongside `metadata`. I did not verify how/whether the agent reads it. Use `metadata` (a JSON string) — that path I did verify end-to-end into the token claim.
3. I did NOT run a browser test. Every livekit-client claim is from its shipped .d.ts or its compiled source, which is strong, but no real WebRTC session was established.
4. `JobRestartPolicy` defaulted to `JRP_ON_FAILURE` in my decoded token, and the .d.ts marks restartPolicy "cloud only". Unverified on self-hosted.

## API
══════════════════════════════════════════════════════
1. SERVER — MINT A JOIN TOKEN (livekit-server-sdk 2.18.0)
══════════════════════════════════════════════════════

import { AccessToken } from 'livekit-server-sdk';

const at = new AccessToken(
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
  {
    identity: 'student-42',        // REQUIRED for join tokens -> becomes JWT `sub`
    name: 'Aarav',                 // -> Participant.name in the browser
    ttl: '10m',                    // number (seconds) OR zeit/ms string. DEFAULT IS 6h.
    metadata: JSON.stringify({     // MUST be a string. -> participant.metadata
      lessonId: 'lesson-7',
      pausedAtMs: 184000,
      grade: 8,
    }),
    attributes: { grade: '8', board: 'cbse' },  // Record<string,string> only
  },
);

at.addGrant({
  room: 'class-lesson7-student42',
  roomJoin: true,
  canPublish: true,        // student publishes mic
  canSubscribe: true,      // student hears the agent
  canPublishData: true,    // student can send data packets
  // canPublishSources: [TrackSource.MICROPHONE],  // stricter than canPublish; see gotchas
});

const jwt = await at.toJwt();   // ← ASYNC in 2.x. Promise<string>.

Verbatim decoded payload of exactly that token:

{
  "metadata": "{\"lessonId\":\"l-7\",\"timestampMs\":184000}",
  "attributes": { "grade": "8" },
  "name": "Aarav",
  "video": { "room": "class-l7-student42", "roomJoin": true,
             "canPublish": true, "canSubscribe": true, "canPublishData": true },
  "iss": "devkey", "exp": 1787483603, "nbf": 1787483003, "sub": "student-42"
}

Setters also exist post-construction: at.name, at.metadata, at.attributes,
at.kind, at.roomPreset, at.roomConfig.

Full VideoGrant surface (from grants.d.ts): roomCreate, roomJoin, roomList,
roomRecord, roomAdmin, room, ingressAdmin, canPublish, canPublishSources,
canSubscribe, canPublishData, canUpdateOwnMetadata, hidden, recorder, agent,
canSubscribeMetrics, canManageAgentSession, destinationRoom.

The agent reads your `metadata` off the participant as `participant.metadata`
(a string — JSON.parse it) and `attributes` as `participant.attributes`.


══════════════════════════════════════════════════════
2. SERVER — EXPLICIT AGENT DISPATCH vs AUTOMATIC
══════════════════════════════════════════════════════

THE RULE (from LiveKit docs + AgentDispatchClient.d.ts): it is one or the other.
- Worker registered WITHOUT an agentName  -> automatic: joins EVERY new room, no metadata.
- Worker registered WITH an agentName     -> automatic dispatch is OFF entirely.
  It joins only when you explicitly dispatch it.

For your app you want an agentName. The student's recorded class should not
have an agent burning tokens in the room until they raise a hand.

--- Option A: dispatch on demand (fires on "raise hand") ---

import { AgentDispatchClient } from 'livekit-server-sdk';

const dispatch = new AgentDispatchClient(
  process.env.LIVEKIT_URL,      // https://<project>.livekit.cloud
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
);

const d = await dispatch.createDispatch('class-lesson7-student42', 'doubt-agent', {
  metadata: JSON.stringify({ lessonId: 'lesson-7', pausedAtMs: 184000 }),
  // restartPolicy: JobRestartPolicy.JRP_ON_FAILURE,  // cloud only
  // deployment: 'staging',                            // empty = production
});

await dispatch.listDispatch(roomName);            // AgentDispatch[]
await dispatch.getDispatch(d.id, roomName);
await dispatch.deleteDispatch(d.id, roomName);    // hand back / dismiss the agent

Or via the one-stop facade:
  import { LiveKitAPI } from 'livekit-server-sdk';
  const api = new LiveKitAPI({ apiKey, secret });   // host/creds fall back to env
  await api.agentDispatch.createDispatch(roomName, agentName, { metadata });
  // api.room / api.egress / api.ingress / api.sip / api.connector also hang off this

--- Option B: dispatch embedded in the join token ---

import { AccessToken, RoomConfiguration, RoomAgentDispatch } from 'livekit-server-sdk';

at.roomConfig = new RoomConfiguration({
  agents: [ new RoomAgentDispatch({
    agentName: 'doubt-agent',
    metadata: JSON.stringify({ lessonId: 'lesson-7' }),
  })],
});

Verbatim decoded `roomConfig` claim from that token:
  "agents": [{ "agentName": "doubt-agent",
               "metadata": "{\"lessonId\":\"l-7\"}",
               "restartPolicy": "JRP_ON_FAILURE",
               "deployment": "", "attributes": {} }]

Option B fires only when the room is FIRST CREATED. For a raise-hand flow where
the student is already sitting in the room watching the recording, Option A is
the correct one. Option B suits "agent present from the first second".


══════════════════════════════════════════════════════
3. CLIENT — CONNECT, MIC ONLY, MUTE WITHOUT TEARDOWN
══════════════════════════════════════════════════════

import { Room, RoomEvent, Track, ConnectionState } from 'livekit-client';

const room = new Room({
  adaptiveStream: true,
  dynacast: true,
  audioCaptureDefaults: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  // publishDefaults: { stopMicTrackOnMute: false },  // default false; see gotchas
});

await room.connect(url, jwt);              // (url, token, opts?) => Promise<void>
                                           // opts.autoSubscribe defaults TRUE

// Mic only — never call setCameraEnabled, so no camera is ever requested.
await room.localParticipant.setMicrophoneEnabled(true);

// MUTE / UNMUTE — publication stays alive, no renegotiation, no re-prompt.
await room.localParticipant.setMicrophoneEnabled(false);  // -> calls track.mute()
await room.localParticipant.setMicrophoneEnabled(true);   // -> calls track.unmute()

// Equivalent lower-level form:
const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
await pub?.mute();
await pub?.unmute();
pub?.isMuted;

await room.disconnect();   // disconnect(stopTracks = true)

Speed-up: call `room.prepareConnection(url, token)` on page load (warms DNS/TLS)
so the raise-hand connect is fast.


══════════════════════════════════════════════════════
4. CLIENT — AGENT AUDIO OUT, AND VIDEO ONTO A CANVAS
══════════════════════════════════════════════════════

room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind === Track.Kind.Audio) {
    const el = track.attach();          // creates a DETACHED <audio autoplay>
    el.id = `audio-${track.sid}`;
    document.body.appendChild(el);      // ← you MUST append it yourself
    // track.setVolume(1.0); track.setSinkId(deviceId);  // RemoteAudioTrack extras
  }

  if (track.kind === Track.Kind.Video) {
    const videoEl = document.getElementById('canvas-video');
    track.attach(videoEl);              // attaches to YOUR existing <video>
  }
});

room.on(RoomEvent.TrackUnsubscribed, (track) => {
  track.detach().forEach((el) => el.remove());   // detach() returns the elements
});

Signatures: attach(): HTMLMediaElement | attach(el: HTMLMediaElement):
HTMLMediaElement | detach(): HTMLMediaElement[] | detach(el): HTMLMediaElement.

autoSubscribe is true by default, so TrackSubscribed just fires. For manual
control pass `{ autoSubscribe: false }` to connect() and then:
  publication.setSubscribed(true);   // RemoteTrackPublication
  publication.setEnabled(false);     // keep subscription, stop the bytes


══════════════════════════════════════════════════════
5. CLIENT — STRUCTURED MESSAGES (both mechanisms)
══════════════════════════════════════════════════════

--- (a) Byte data packets ---

room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
  // payload: Uint8Array, participant?: RemoteParticipant,
  // kind?: DataPacket_Kind (RELIABLE=0 | LOSSY=1), topic?: string
  if (topic !== 'canvas') return;
  const msg = JSON.parse(new TextDecoder().decode(payload));
  if (msg.type === 'show_diagram') showDiagram(msg.assetId);
});

// sending back:
await room.localParticipant.publishData(
  new TextEncoder().encode(JSON.stringify({ type: 'raise_hand', atMs: 184000 })),
  { reliable: true, topic: 'canvas', destinationIdentities: ['doubt-agent'] },
);

--- (b) Text streams (topic-scoped, chunked) ---

room.registerTextStreamHandler('lk.transcription', async (reader, info) => {
  // reader: TextStreamReader, info: { identity: string }
  const trackId  = reader.info.attributes['lk.transcribed_track_id'];
  const isFinal  = reader.info.attributes['lk.transcription_final'] === 'true';
  const segment  = reader.info.attributes['lk.segment_id'];

  const text = await reader.readAll();            // Promise<string>
  // or stream it as it arrives:
  // for await (const chunk of reader) { render(chunk); }   // yields cumulative string
  render(info.identity, text, isFinal);
});

room.registerByteStreamHandler('diagram', async (reader, info) => {
  const chunks = await reader.readAll();          // Promise<Uint8Array[]>
  const blob = new Blob(chunks, { type: reader.info.mimeType });
  canvas.src = URL.createObjectURL(blob);
  // reader.info also has: id, name, topic, timestamp, size?, attributes
});

room.unregisterTextStreamHandler(topic);
room.unregisterByteStreamHandler(topic);

// sending: await room.localParticipant.sendText(str, { topic, destinationIdentities });
// Readers support reader.onProgress = (p) => {} and .withAbortSignal(signal).

--- (c) RPC — best fit for "pull that diagram back onto the canvas" ---
Request/response with a return value, rather than fire-and-forget:

room.localParticipant.registerRpcMethod('show_diagram', async (data) => {
  // data: RpcInvocationData { callerIdentity, payload, responseTimeout, requestId }
  const { assetId } = JSON.parse(data.payload);
  await renderOnCanvas(assetId);
  return JSON.stringify({ ok: true });     // must resolve to a string
});

Reserved topic/attribute names, verbatim from @livekit/agents constants.d.ts:
  TOPIC_TRANSCRIPTION = "lk.transcription"
  TOPIC_CHAT          = "lk.chat"
  TOPIC_CLIENT_EVENTS = "lk.agent.events"
  ATTRIBUTE_AGENT_STATE = "lk.agent.state"
  ATTRIBUTE_AGENT_NAME  = "lk.agent.name"
  ATTRIBUTE_TRANSCRIPTION_TRACK_ID = "lk.transcribed_track_id"
  ATTRIBUTE_TRANSCRIPTION_FINAL    = "lk.transcription_final"
  ATTRIBUTE_TRANSCRIPTION_SEGMENT_ID = "lk.segment_id"
Use your own topic names ('canvas', 'diagram') to avoid colliding with these.


══════════════════════════════════════════════════════
6. CLIENT — CONNECTION EVENTS + "IS THE AGENT ACTUALLY HERE?"
══════════════════════════════════════════════════════

There is NO RoomEvent.Connecting. Connecting exists only as a ConnectionState.

room.on(RoomEvent.ConnectionStateChanged, (state) => {
  // ConnectionState: "disconnected" | "connecting" | "connected"
  //                | "reconnecting" | "signalReconnecting"
});
room.on(RoomEvent.Connected,        () => {});
room.on(RoomEvent.Reconnecting,     () => {});   // media path dropped
room.on(RoomEvent.SignalReconnecting, () => {}); // signal only, usually invisible
room.on(RoomEvent.Reconnected,      () => {});
room.on(RoomEvent.Disconnected,     (reason?: DisconnectReason) => {});
room.state;   // current ConnectionState

--- Detecting the AGENT participant ---

import { ParticipantKind } from 'livekit-client';   // ParticipantKind.AGENT === 4

const isAgent = (p) => p.kind === ParticipantKind.AGENT;

function watchForAgent(room, onReady) {
  const check = (p) => {
    if (!isAgent(p)) return;
    // stronger signal than "joined": the agent says it is ready
    const state = p.attributes['lk.agent.state'];   // idle|initializing|listening|thinking|speaking
    if (state === 'listening' || state === 'speaking') onReady(p);
  };

  // 1. participants ALREADY in the room — ParticipantConnected will NOT fire for these
  room.remoteParticipants.forEach(check);

  // 2. participants who join after us
  room.on(RoomEvent.ParticipantConnected, check);

  // 3. the agent flips its state a moment after joining
  room.on(RoomEvent.ParticipantAttributesChanged, (changed, p) => check(p));
}

Recommended UI gate: stop saying "connecting" on `lk.agent.state === 'listening'`,
and drive your speaking indicator off the same attribute ('speaking'/'thinking').
If you only need "agent has voice", gate on RoomEvent.TrackSubscribed where
participant.kind === ParticipantKind.AGENT && track.kind === Track.Kind.Audio.

AgentState union (attribute-typings.d.ts):
  'idle' | 'initializing' | 'listening' | 'thinking' | 'speaking'


══════════════════════════════════════════════════════
7. BUNDLE SIZE + DYNAMIC IMPORT
══════════════════════════════════════════════════════

Measured on the shipped dist of livekit-client@2.22.0:
  livekit-client.umd.js  (already minified)  566,749 B raw | 142,167 B gzip | 117,825 B brotli
  livekit-client.esm.mjs (NOT minified)    1,292,244 B raw | 278,016 B gzip
Bundlephobia for the same version: 529,542 B minified, 135,991 B gzip.

Realistic cost after your bundler minifies the ESM: ~130–145 KB gzip,
~118 KB brotli. Treat it as ~135 KB gzip. That is large — roughly the whole
rest of a lean React page — which is exactly why the lazy load is worth it.

Tree-shaking will NOT help: package.json has no `sideEffects` field
(bundlephobia hasSideEffects: true) and the entry runs a webrtc-adapter
bootstrap at module scope. You get the whole bundle or none of it.

YES, dynamic import works, and it is the right call here:

let roomMod = null;
async function raiseHand() {
  setStatus('connecting');
  if (!roomMod) roomMod = await import('livekit-client');   // ~135 KB gzip, once
  const { Room, RoomEvent, Track, ParticipantKind } = roomMod;
  const room = new Room({ /* ... */ });
  await room.connect(url, jwt);
  await room.localParticipant.setMicrophoneEnabled(true);
  await room.startAudio();     // the raise-hand click IS the user gesture — spend it
}

A student who never raises a hand downloads 0 bytes of it.

Verified: importing the ESM entry in bare Node with no DOM succeeds — its
adapter bootstrap is written `adapterFactory({ window: typeof window ===
'undefined' ? undefined : window })`. So a top-level `import` in a Next.js file
will not crash SSR at import time. Constructing a Room still needs a browser.

Vite: no config needed. Next.js: `next/dynamic` with `{ ssr: false }` on the
doubt-session component, or the `await import()` above inside the click handler.

Optional prefetch, so the click feels instant without costing passive students:
warm it on hover/focus of the raise-hand button rather than on page load.

Package entry points: main=./dist/livekit-client.umd.js,
module=./dist/livekit-client.esm.mjs, types=dist/src/index.d.ts.
Runtime deps: @livekit/protocol 1.50.4, @livekit/mutex 1.1.1, webrtc-adapter
9.0.6, sdp-transform, loglevel, jose ^6.1.0, events, tslib, typed-emitter.

## GOTCHAS
- toJwt() is ASYNC in 2.x — `toJwt(): Promise<string>`, asserted `t instanceof Promise === true` at runtime. It was synchronous in 1.x, so every stale snippet you find will be wrong. Forgetting the await ships the literal string "[object Promise]" to the browser and you get an opaque auth failure at connect() instead of an error at mint time.
- Default ttl is 6 HOURS. Measured `exp - nbf === 21600` on a token minted with no ttl. A student join token that lives 6 hours is a 6-hour replayable room key. Always set ttl explicitly — '10m' or '30m' for a lesson session.
- `identity` goes in the AccessToken constructor options (or `at.identity`), NOT in the video grant. It lands as the JWT `sub`. Putting it in addGrant() silently produces a token with no identity, which the server rejects for join. Identity must be unique per participant — a second connection with the same identity kicks the first one out (DisconnectReason DUPLICATE_IDENTITY), which will bite you on React StrictMode double-mount and on hot reload.
- Token `metadata` must be a STRING. `at.metadata = {lessonId: 'l-7'}` does not throw at mint time — it stringifies into a useless claim. JSON.stringify it yourself, and JSON.parse it on the agent side. `attributes` is the newer alternative but is strictly Record<string,string>: numbers must be stringified ('8', not 8).
- Explicit dispatch and automatic dispatch are mutually exclusive, decided by ONE thing: whether the worker registered an `agentName`. Set it and automatic dispatch turns off completely. Omit it and the agent joins every single room the moment it is created — which for you means an LLM agent sitting in the room burning tokens through the entire pre-recorded class while nobody has raised a hand. Set agentName.
- Token-embedded dispatch (`at.roomConfig` with RoomAgentDispatch) fires only when the room is FIRST CREATED, not when a participant joins an existing room. For a raise-hand flow where the student is already in the room watching the recording, this silently does nothing. Use AgentDispatchClient.createDispatch() at raise-hand time instead. If you do use roomConfig, room names must be unique per session.
- Import RoomConfiguration and RoomAgentDispatch from 'livekit-server-sdk' (it re-exports them), NOT from '@livekit/protocol'. server-sdk 2.18.0 pins @livekit/protocol 1.48.0 while livekit-client 2.22.0 pins 1.50.4 — with both in one workspace npm can hoist two copies, and protobuf message classes from the wrong copy fail an instanceof check inside the SDK and serialize to an empty claim. Same trap for TrackSource if you use canPublishSources.
- There is NO RoomEvent.Connecting. The events are Connected, Reconnecting, SignalReconnecting, Reconnected, Disconnected, ConnectionStateChanged. "Connecting" exists only as ConnectionState.Connecting delivered through ConnectionStateChanged. Listening for a Connecting event gives you a spinner that never starts.
- RoomEvent.ParticipantConnected does NOT fire for participants already in the room when you connect — the .d.ts says so explicitly. If the agent was dispatched before the student's connect() resolves (a live race in your flow, since you dispatch server-side and connect client-side), your handler never runs and the UI says "connecting" forever. You must ALSO iterate room.remoteParticipants after connect. This is the single most likely bug in this feature.
- Browser autoplay policy: the agent's audio can be silently blocked. Check `room.canPlaybackAudio`, listen to RoomEvent.AudioPlaybackStatusChanged, and call `await room.startAudio()` from inside a user gesture. Your flow is lucky — the raise-hand click IS a gesture — so call startAudio() in that handler. But note the recorded-class player may have already consumed the page's gesture in a different context; test the cold path where the student's very first click is raise-hand.
- track.attach() with no arguments creates a DETACHED element via document.createElement — it does not add it to the page. Confirmed in the compiled source. For agent audio you must document.body.appendChild(el) yourself or nothing plays. For video, pass your existing element: track.attach(videoEl).
- setMicrophoneEnabled(false) mutes, it does not unpublish — confirmed by reading the compiled setTrackEnabled branch (only ScreenShare unpublishes; everything else calls track.mute()). Good, that is what you want. But `stopMicTrackOnMute` defaults to FALSE, so the browser's mic-in-use indicator STAYS LIT while muted. Students and parents will read that as the app listening while muted. Setting publishDefaults.stopMicTrackOnMute = true clears the indicator but re-acquires the device on unmute — adding latency, and on Bluetooth headsets it audibly switches profile (HFP/A2DP) mid-lesson. Pick deliberately; the default is the safer one for responsiveness.
- Never call setCameraEnabled. Mic-only is achieved by simply not asking for the camera. If you want it enforced rather than merely unused, set canPublishSources: [TrackSource.MICROPHONE] in the grant — but note canPublishSources SUPERSEDES canPublish entirely, so anything not listed becomes unpublishable, and if you leave BOTH canPublish and canSubscribe unset the SDK enables both by default.
- livekit-client cannot be tree-shaken: no `sideEffects` field in package.json and a webrtc-adapter bootstrap runs at module scope. Importing one symbol pulls all ~135 KB gzip. Dynamic import is therefore the only lever, and it works — verified the ESM entry imports cleanly in bare Node with no DOM. Do not add a top-level `import { Room } from 'livekit-client'` anywhere in the recorded-class player's module graph, or every student pays for it.
- The lk.* topic and attribute namespace is reserved by the agents framework — lk.transcription, lk.chat, lk.agent.state, lk.agent.events, lk.transcribed_track_id and friends. Name your own data topics ('canvas', 'diagram') outside that prefix or you will fight the framework's own handlers.
- RoomEvent.TranscriptionReceived is marked @beta in the .d.ts. The durable path for agent transcripts is the 'lk.transcription' TEXT STREAM, not the transcription event. Build the doubt-sheet transcript on registerTextStreamHandler.

## SOURCES
- Shipped type declarations, livekit-server-sdk@2.18.0 tarball (npm `latest`): dist/AccessToken.d.ts (toJwt(): Promise<string>, AccessTokenOptions), dist/grants.d.ts (full VideoGrant/ClaimGrants), dist/AgentDispatchClient.d.ts (createDispatch/listDispatch/getDispatch/deleteDispatch, CreateDispatchOptions), dist/LiveKitAPI.d.ts, dist/index.d.ts (confirms RoomConfiguration + RoomAgentDispatch are re-exported)
- Shipped type declarations, livekit-client@2.22.0 tarball (npm `latest`): dist/src/index.d.ts, dist/src/room/Room.d.ts (connect/disconnect/startAudio/canPlaybackAudio/register*StreamHandler/registerRpcMethod, full RoomEventCallbacks), dist/src/room/events.d.ts (RoomEvent enum + doc comment stating ParticipantConnected does not fire for existing participants), dist/src/room/participant/LocalParticipant.d.ts, dist/src/room/participant/Participant.d.ts, dist/src/room/track/Track.d.ts (attach/detach overloads, Track.Kind/Source), dist/src/room/track/LocalTrack.d.ts + LocalTrackPublication.d.ts (mute/unmute), dist/src/room/track/RemoteTrackPublication.d.ts + RemoteAudioTrack.d.ts, dist/src/room/track/options.d.ts (AudioCaptureOptions, stopMicTrackOnMute defaults to false), dist/src/room/data-stream/incoming/StreamReader.d.ts (TextStreamReader/ByteStreamReader/handler signatures), dist/src/room/types.d.ts, dist/src/room/attribute-typings.d.ts (AgentState union)
- RUNTIME EXECUTION (strongest evidence, my own): minted real tokens with livekit-server-sdk 2.18.0 wired against @livekit/protocol 1.48.0 + jose 5.9.6 in an isolated scratchpad — asserted toJwt() returns a Promise, decoded the JWT payload for both the plain join token and the roomConfig/RoomAgentDispatch token, and measured default ttl as exp-nbf = 21600s. Separately imported livekit-client 2.22.0's ESM entry in bare Node and read ParticipantKind.AGENT===4, ConnectionState values, RoomEvent.Connected, Track.Source.Microphone, DataPacket_Kind and version==='2.22.0' off the live module.
- Compiled source read directly, livekit-client 2.22.0 dist/livekit-client.esm.mjs: setTrackEnabled (proves setMicrophoneEnabled(false) calls track.mute() and only ScreenShare unpublishes), attach() (proves document.createElement with no DOM insertion), attachToElement (autoplay/playsInline/srcObject handling), roomConnectOptionDefaults (autoSubscribe: true, peerConnectionTimeout 15000, websocketTimeout 15000, maxRetries 1), adapterFactory call site (window-guarded, hence SSR-import-safe)
- @livekit/agents constants.d.ts — verbatim reserved topic/attribute names: TOPIC_TRANSCRIPTION 'lk.transcription', TOPIC_CHAT 'lk.chat', ATTRIBUTE_AGENT_STATE 'lk.agent.state', ATTRIBUTE_TRANSCRIPTION_FINAL/TRACK_ID/SEGMENT_ID
- @livekit/protocol 1.48.0 src/gen/livekit_models_pb.d.ts (ParticipantInfo_Kind: STANDARD 0, INGRESS 1, EGRESS 2, SIP 3, AGENT 4, CONNECTOR 7) and livekit_agent_dispatch_pb.d.ts (RoomAgentDispatch fields agentName/metadata/restartPolicy/deployment/attributes)
- registry.npmjs.org metadata for livekit-server-sdk and livekit-client — confirmed 2.18.0 and 2.22.0 are both the current dist-tags.latest
- https://docs.livekit.io/agents/worker/agent-dispatch/ — automatic vs explicit dispatch, the agent_name rule, createDispatch and roomConfig code samples
- https://docs.livekit.io/agents/build/text/ — 'lk.transcription' topic and the registerTextStreamHandler frontend sample
- https://docs.livekit.io/home/server/generating-tokens/ — canonical Node AccessToken sample confirming await at.toJwt()
- https://docs.livekit.io/home/client/tracks/publish/ — setMicrophoneEnabled, mute-vs-unpublish distinction
- https://bundlephobia.com/api/size?package=livekit-client@2.22.0 — 529,542 B minified, 135,991 B gzip, hasSideEffects true (independent cross-check of my own dist measurements)