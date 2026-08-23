# LiveKit server v1.13.5 self-hosted locally on Windows 11, no Docker — startup, ports, config, browser + agent wiring, and the Cloud trade-off

## VERIFIED
VERIFIED BY ACTUALLY RUNNING IT. I downloaded livekit_1.13.5_windows_amd64.zip from the GitHub release and extracted it to the scratchpad (nothing written to the repo, no npm/node_modules touched). The working binary is at C:\Users\HP\AppData\Local\Temp\claude\c--Users-HP-Ai-Tutor\797e7caa-c3ef-4621-9bed-7be70f80434d\scratchpad\lkbin\livekit-server.exe

Confirmed by execution on this Windows 11 box:
- Zip contains exactly two entries: LICENSE and livekit-server.exe (54 MB) at the archive root. No installer, no bundled config.
- `livekit-server.exe --version` prints "livekit-server version 1.13.5".
- `livekit-server.exe ports --dev` prints: TCP 7880 (HTTP service), TCP 7881 (ICE/TCP), UDP 7882 (ICE/UDP). Note it prints the UDP line as the literal "%!s(int=7882)" — a cosmetic Go format bug in 1.13.5, the port really is 7882.
- `livekit-server.exe ports --keys "devkey: <32-char>"` (no --dev) prints: TCP 7880, TCP 7881, UDP 50000-60000.
- `--dev` logs "no keys provided, using placeholder keys {API Key: devkey, API Secret: secret}".
- `livekit-server.exe generate-keys` emits an APIxxxx key + 43-char secret.

Confirmed by reading source at the v1.13.5 tag (primary):
- cmd/server/main.go L108-111: --dev usage string is "sets log-level to debug, console formatter, and /debug/pprof. insecure for production".
- cmd/server/main.go L209-242: dev keys are injected ONLY when len(conf.Keys)==0, and in that same branch BindAddresses defaults to ["127.0.0.1","::1"].
- mediatransportutil/pkg/rtcconfig/config.go Validate(): if no ports set, development=true gives single UDP mux port 7882, else ICE range 50000-60000.
- pkg/service/server.go L231-243: BindAddresses controls ONLY the HTTP/signal TCP listener (and prom/debug). Media sockets bind separately.
- rtcconfig/webrtc_config.go L184: ICE/TCP listener is net.ListenTCP with no IP -> all interfaces. UDP mux likewise, filtered only by ips/interfaces config.
- webrtc_config.go L219: loopback ICE candidates are emitted only if enable_loopback_candidate is true.
- webrtc_config.go L225-235: when node_ip is auto-generated and use_external_ip is false, LiveKit adds public STUN servers (global.stun.twilio.com:3478, stun.l.google.com:19302) to the SFU's own config.
- pkg/config/config.go L722-728: a secret shorter than 32 chars only LOGS an error outside dev mode; it does not abort startup.
- livekit/agents worker.py L333-335 and L1095-1101: worker reads LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET and connects to {ws_url}/agent, rewriting http->ws.

Confirmed from shipped .d.ts on the npm CDN: livekit-client 2.22.0 Room.connect is (url, token, opts?) => Promise<void>; livekit-server-sdk 2.18.0 AccessToken.toJwt() returns Promise<string>.

Cloud free-tier numbers cross-checked against two LiveKit-owned pages (livekit.com/pricing and docs.livekit.io/deploy/admin/quotas-and-limits) which agree.

NOT VERIFIED — stated as inference, flagged in gotchas:
- I did NOT start the server and complete a browser WebRTC handshake. The claim that localhost works without TURN follows from the code paths (host candidate on the LAN IP, both peers on the same machine) and is how LiveKit's own docs position local dev, but I did not observe an ICE connection.
- The fully-offline recipe (rtc.node_ip: 127.0.0.1 + enable_loopback_candidate: true) is my reading of the NAT1To1 rewrite branch, untested.
- I did not observe the Windows Firewall prompt; I am inferring it from the media sockets binding to all interfaces.

## API
// ============================================================
// 1. START THE SERVER  (PowerShell, no Docker)
// ============================================================
//   Expand-Archive .\livekit_1.13.5_windows_amd64.zip -DestinationPath C:\livekit
//   C:\livekit\livekit-server.exe --dev
//
// Binary name: livekit-server.exe  (sits at the zip root next to LICENSE)
// Dev credentials injected by --dev:  API key "devkey", API secret "secret"
// IMPORTANT: --dev only injects those keys if NO keys are configured.
// Pass --config with a `keys:` block and the dev keys are NOT used.
//
// Sanity check before you ever bind a socket (does not open ports):
//   C:\livekit\livekit-server.exe ports --dev
//   -> TCP 7880 HTTP service | TCP 7881 ICE/TCP | UDP 7882 ICE/UDP
//
// Generate real keys for the non-dev config:
//   C:\livekit\livekit-server.exe generate-keys

// ============================================================
// 2. PORTS  (empirically confirmed with `ports`)
// ============================================================
// --dev (single UDP mux port — this is what you want locally):
//   TCP  7880   HTTP + WebSocket signalling   <- browser and agent both hit this
//   TCP  7881   ICE/TCP fallback
//   UDP  7882   ICE/UDP mux (ALL media on one port)
// Production defaults (no --dev, no explicit ports):
//   TCP  7880, TCP 7881, UDP 50000-60000   <- 10,001 ports, do NOT use locally
// No TURN by default (turn.enabled: false). Not needed same-machine.

// ============================================================
// 3. livekit.yaml — minimal but production-shaped
//    run with:  livekit-server.exe --config C:\livekit\livekit.yaml
//    (omit --dev entirely; this file turns the dev defaults off)
// ============================================================
/*
# TCP port for the REST API + the client signalling WebSocket.
# In production this sits behind a TLS-terminating proxy; locally it is plain ws.
port: 7880

# Which local addresses the SIGNAL server listens on. This does NOT affect media
# sockets. Both entries matter on Windows: "localhost" resolves to ::1 first,
# so an IPv4-only bind makes ws://localhost:7880 fail while ws://127.0.0.1:7880 works.
bind_addresses:
  - 127.0.0.1
  - "::1"

rtc:
  # One UDP port for all media instead of a 10k range: one firewall rule, one prompt.
  # port_range_start/end MUST be absent for udp_port to take effect.
  udp_port: 7882
  # ICE/TCP fallback for networks that block UDP. Cannot sit behind TLS.
  tcp_port: 7881
  # STUN-based public IP discovery. false for a laptop: there is no NAT to punch,
  # and true adds a startup round-trip to Twilio/Google that fails offline.
  use_external_ip: false
  # Pin the advertised IP. Setting this explicitly ALSO suppresses the automatic
  # public STUN servers LiveKit otherwise injects into the SFU. Set to your LAN IP,
  # or 127.0.0.1 for a fully offline box (then also set enable_loopback_candidate).
  # node_ip: 192.168.1.20
  # Required if node_ip is a loopback address — loopback ICE candidates are
  # suppressed unless this is on.
  # enable_loopback_candidate: true

# THE key/secret pairs. Presence of this block is what switches OFF the dev
# defaults: --dev will not overwrite keys that already exist.
# Generate with `livekit-server.exe generate-keys`. Secrets under 32 chars only
# log an error outside dev mode — they do NOT stop the server, so nothing warns
# you loudly if you ship a weak one.
keys:
  APIxxxxxxxxxxxx: this-is-not-a-real-secret-it-was-rotated-ok

logging:
  level: info      # --dev forces debug + console formatter; this is the sane default
  pion_level: error

room:
  auto_create: true      # agent + student join by name without a CreateRoom call
  empty_timeout: 300     # seconds to hold a room open before anyone joins
  departure_timeout: 20  # seconds to hold it after everyone leaves

# Alternative to inlining keys — keep them out of the yaml entirely.
# The file must not be world-readable or the server refuses to start.
# key_file: C:\livekit\keys.yaml
*/

// ============================================================
// 4. SERVER-SIDE TOKEN MINT — the API secret never reaches the browser
//    npm i livekit-server-sdk@2.18.0   (Node >= 18; you have 24)
// ============================================================
import { AccessToken, type VideoGrant } from 'livekit-server-sdk';

export async function mintStudentToken(room: string, identity: string) {
  // Both args fall back to LIVEKIT_API_KEY / LIVEKIT_API_SECRET env vars.
  const at = new AccessToken('devkey', 'secret', {
    identity,                 // required for join tokens
    name: 'Student',
    ttl: '2h',                // seconds, or a zeit/ms span string
  });

  const grant: VideoGrant = {
    roomJoin: true,
    room,
    canPublish: true,         // mic, so the tutor can hear the doubt
    canSubscribe: true,       // avatar video + tutor audio
    canPublishData: true,     // your "pull diagram X back onto the canvas" messages
  };
  at.addGrant(grant);

  return await at.toJwt();    // NOTE: async in v2. Was sync in v1 — common breakage.
}

// ============================================================
// 5. BROWSER CLIENT — npm i livekit-client@2.22.0
// ============================================================
import { Room, RoomEvent, type RoomConnectOptions } from 'livekit-client';

const LIVEKIT_WS_URL = 'ws://127.0.0.1:7880';
// ^ ws:// not wss:// — the local server has no TLS.
//   Prefer 127.0.0.1 over localhost: deterministic on Windows' IPv6-first resolver.
//   Cloud is 'wss://<subdomain>.livekit.cloud' — same client code, swap the string.

const room = new Room({ adaptiveStream: true, dynacast: true });

room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
  if (participant.isAgent) track.attach(document.getElementById('tutor')!);
});

const opts: RoomConnectOptions = { autoSubscribe: true };
await room.connect(LIVEKIT_WS_URL, tokenFromYourServer, opts);
// signature: connect(url: string, token: string, opts?: RoomConnectOptions) => Promise<void>

// Optional: warms TLS/DNS before the student clicks "raise hand"
// await room.prepareConnection(LIVEKIT_WS_URL, tokenFromYourServer);

// ============================================================
// 6. AGENT WORKER — same server, same port 7880
// ============================================================
// .env.local for the agent process:
//   LIVEKIT_URL=ws://127.0.0.1:7880
//   LIVEKIT_API_KEY=devkey
//   LIVEKIT_API_SECRET=secret
//
// The worker opens ws://127.0.0.1:7880/agent to register, then the server
// dispatches jobs to it. No second port, no inbound rule. Browser and worker
// are just two clients of the same 7880 listener.

// ============================================================
// 7. CLOUD — identical code path, three env vars differ
// ============================================================
//   LIVEKIT_URL=wss://<subdomain>.livekit.cloud
//   LIVEKIT_API_KEY / LIVEKIT_API_SECRET  from the project Settings page
// No binary, no ports, no firewall, global TURN included. Everything above
// (AccessToken, room.connect, the agent worker) is byte-identical.

## GOTCHAS
- --dev does NOT force the dev key. It injects devkey/secret only when zero keys are configured (main.go: `if len(conf.Keys) == 0`). The moment you pass --config with a `keys:` block, --dev keeps the debug logging and pprof but your real keys win. That is also the clean answer to 'how do I switch off the development defaults': define keys in the config and drop --dev. There is no separate --production flag.
- Dev mode and production mode use COMPLETELY DIFFERENT UDP strategies, and nobody documents this loudly. `--dev` gives you a single UDP mux port 7882. Without --dev you get the 50000-60000 range — 10,001 UDP ports. On Windows that is a miserable firewall rule and a slow ICE gather. Always set `rtc.udp_port: 7882` explicitly in your config file so behaviour is identical with and without --dev. I confirmed both by running `livekit-server.exe ports`.
- In 1.13.5 `livekit-server.exe ports --dev` prints the UDP line as the literal string `%!s(int=7882)` instead of `7882`. It is a cosmetic Go format-verb bug in their PortRange marshaller, not a misconfiguration. Do not go hunting for it.
- bind_addresses / --bind controls ONLY the TCP signalling listener on 7880 (verified in pkg/service/server.go). The media sockets — UDP 7882 and TCP 7881 — bind to ALL interfaces regardless. So `--dev` binding to 127.0.0.1 does not spare you the Windows Firewall prompt; expect a Defender dialog for livekit-server.exe on first run covering both TCP and UDP. Tick 'Private networks' and leave 'Public networks' unticked. If you dismissed the prompt once, no later prompt appears and media silently fails while signalling still connects — a block rule got written. Check with `Get-NetFirewallRule -DisplayName '*livekit*'` and delete the bad rule rather than adding an allow rule on top.
- IPv6 is a real Windows trap here. `--dev` with no config binds BOTH 127.0.0.1 and ::1, so ws://localhost:7880 happens to work. But the second you pass `--bind 0.0.0.0` (the flag the docs suggest for LAN access) you get IPv4 only — and Windows resolves `localhost` to ::1 first, so the browser fails with an opaque connection error while `curl http://127.0.0.1:7880` succeeds. --bind is a repeatable flag: use `--bind 0.0.0.0 --bind ::` or just always use ws://127.0.0.1:7880 in the client.
- Loopback ICE candidates are OFF by default (webrtc_config.go only calls SetIncludeLoopbackCandidate when enable_loopback_candidate is true). What actually happens same-machine is that LiveKit picks your LAN IP (e.g. 192.168.1.x) as the host candidate and the browser connects to it over the loopback path. That works and needs no TURN. But it means the server needs a routable local interface: on a fully offline laptop with Wi-Fi off, IP discovery falls back to 127.0.0.1 and, because loopback candidates are suppressed, media can fail to establish. UNTESTED FIX: set `rtc.node_ip: 127.0.0.1` plus `enable_loopback_candidate: true`. Verify it before you rely on demoing offline.
- Leaving `use_external_ip` at the config-sample's `true` on a laptop makes the server phone global.stun.twilio.com and stun.l.google.com at STARTUP, retrying 3x with 500ms sleeps before failing. Worse: even with use_external_ip false, LiveKit injects those same public STUN servers into the SFU whenever node_ip was auto-determined (webrtc_config.go L225-235). Setting node_ip explicitly is what suppresses that. For an air-gapped or flaky-network dev box this is the difference between instant and multi-second connects.
- An API secret shorter than 32 characters does not stop the server — ValidateKeys only calls logger.Errorw and returns nil (config.go L722-728). It scrolls past in the boot noise. Use `livekit-server.exe generate-keys`, which emits a 43-char secret, rather than typing one.
- The Windows zip contains ONLY livekit-server.exe and LICENSE. No config-sample.yaml ships with it — you must pull config-sample.yaml from the repo separately. And the server does NOT auto-discover a livekit.yaml in the working directory; without --config or LIVEKIT_CONFIG it uses pure in-code defaults, which is why `--dev` alone appears to work with no file at all.
- Strict config parsing is ON by default: a typo'd or unknown YAML key aborts startup rather than being ignored. There is a hidden `--disable-strict-config` flag. This is good behaviour but the error can be cryptic — suspect a stray key before you suspect a bug.
- Browser and agent worker absolutely share the same local server and the same port 7880 — the worker registers at ws://127.0.0.1:7880/agent (agents worker.py L1095-1101, which also rewrites an http:// scheme to ws:// for you, so LIVEKIT_URL=http://127.0.0.1:7880 silently works too). No extra port, no inbound rule for the worker. But the worker needs `agent: true` in its grant, and if the worker starts BEFORE the server it exits rather than retrying — start livekit-server first.
- AccessToken.toJwt() is async in livekit-server-sdk v2 (returns Promise<string>). It was synchronous in v1. Every stale tutorial and LLM-remembered snippet gets this wrong, and the failure mode is a token string that reads '[object Promise]' and a 401 from the server.
- Cloud free tier ('Build') caps are HARD caps, not overage billing — requests fail once you cross them, and allowances reset on the 1st of the month with no rollover. The two that will bite an AI tutor first: 1,000 agent session minutes/month (about 16 hours of live tutoring TOTAL across all students) and only 5 concurrent agent sessions with 1 deployed agent. Also 5,000 WebRTC participant minutes, 50 GB downstream, $2.50 inference credit (~50 minutes), 100 concurrent connections, 60 transcode minutes.
- The honest self-host-vs-cloud trade: self-hosting is genuinely easy for LOCAL DEV on this machine — one exe, three ports, ten minutes, and you keep the API secret server-side either way (that is a property of minting tokens on your server, not of self-hosting, so it is NOT a reason to self-host). What self-hosting actually buys a solo founder is unmetered local iteration: no agent-minute burn while you replay the same doubt-handoff 200 times, and offline demos. What it costs in PRODUCTION is the part people underestimate: the instant a student is not on your LAN you need a public IP, TLS on 7880, a TURN server on 443 for students behind school/corporate firewalls (LiveKit's embedded TURN needs real certs), and Redis the moment you need more than one node. That is the real work, and Cloud does all of it. Recommended shape: self-host locally for development, Cloud for anything a real student touches, and because the client code is byte-identical apart from the URL and keys, switching is a .env change — so this is not a decision you have to get right now.
- Do not chase the Cloud free tier's 100-concurrent-connection number as your capacity limit. For a voice tutor the binding constraint is 5 concurrent agent sessions and 1,000 agent minutes. Five simultaneous students is the free tier's real ceiling for this product.

## SOURCES
- https://github.com/livekit/livekit/releases/download/v1.13.5/livekit_1.13.5_windows_amd64.zip (downloaded, extracted, and executed on this machine: --version, ports --dev, ports, generate-keys)
- https://api.github.com/repos/livekit/livekit/releases/latest (v1.13.5, published 2026-07-31, asset list)
- https://raw.githubusercontent.com/livekit/livekit/v1.13.5/cmd/server/main.go (--dev flag definition L108-111; dev-key + bind-address injection L209-242; CLI flags incl. --bind, --config, --config-body/LIVEKIT_CONFIG, --key-file, --keys, --node-ip, --udp-port)
- https://raw.githubusercontent.com/livekit/livekit/v1.13.5/cmd/server/commands.go (printPorts implementation, L49-88)
- https://raw.githubusercontent.com/livekit/livekit/v1.13.5/pkg/config/config.go (DefaultConfig L453+, ValidateKeys L695-729 incl. the 32-char secret warning)
- https://raw.githubusercontent.com/livekit/livekit/v1.13.5/pkg/service/server.go (BindAddresses applies only to the TCP signal/prom/debug listeners, L228-282)
- https://raw.githubusercontent.com/livekit/livekit/v1.13.5/config-sample.yaml (full 372-line annotated reference config)
- https://raw.githubusercontent.com/livekit/mediatransportutil/master/pkg/rtcconfig/config.go (RTCConfig.Validate: development -> UDP mux 7882, else ICE range 50000-60000; DefaultStunServers)
- https://raw.githubusercontent.com/livekit/mediatransportutil/master/pkg/rtcconfig/webrtc_config.go (UDP mux + TCP listener binding, NAT1To1 rewrite, loopback-candidate gate, automatic STUN injection)
- https://raw.githubusercontent.com/livekit/mediatransportutil/master/pkg/rtcconfig/ip.go (determineIP / GetLocalIPAddresses loopback fallback)
- https://raw.githubusercontent.com/livekit/livekit/master/.goreleaser.yaml (binary: livekit-server; windows archives are zip)
- https://raw.githubusercontent.com/livekit/agents/main/livekit-agents/livekit/agents/worker.py (LIVEKIT_URL/KEY/SECRET at L333-335; registration at {ws_url}/agent, L1095-1101)
- https://unpkg.com/livekit-client@2.22.0/dist/src/room/Room.d.ts (connect signature, L178)
- https://unpkg.com/livekit-server-sdk@2.18.0/dist/AccessToken.d.ts and dist/grants.d.ts (AccessToken constructor/options, toJwt(): Promise<string>, VideoGrant fields)
- https://docs.livekit.io/transport/self-hosting/local/ (official local-run page: livekit-server --dev, devkey/secret, --bind 0.0.0.0)
- https://docs.livekit.io/transport/self-hosting/ports-firewall/ (official port table: 7880, 7881, 7882 mux, 50000-60000, TURN 3478/5349)
- https://livekit.com/pricing (Build tier: 1,000 agent minutes, 5 concurrent agent sessions, 1 deployment, $2.50 inference credit, 5,000 WebRTC minutes, 100 concurrent connections, 50 GB downstream)
- https://docs.livekit.io/deploy/admin/quotas-and-limits/ (same figures plus 60 transcode minutes, 100k observability events, hard-cap wording)