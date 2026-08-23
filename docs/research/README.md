# Research notes, 2026-08-23

Kept because every one of these was expensive to produce and most of it was
verified by running the real thing, not by reading docs. Re-deriving any of it
costs hours; re-deriving it wrongly costs more.

Each note separates what was **verified against a primary source** from what is
inference, and says so explicitly. Trust the first, check the second.

| File | What it settles |
|---|---|
| `recon-0.md` | `@livekit/agents-plugin-google` 1.7 — the Gemini Live realtime model, every constructor option, and why `generateReply` throws on 3.1 |
| `recon-1.md` | `@livekit/agents` 1.7 — worker entry, tools, agent-to-browser messages, Node 24 running TypeScript with no build step |
| `recon-2.md` | Avatar plugins (bey / tavus / hedra) and their real per-minute economics. Hedra's plugin is a tombstone that only throws |
| `recon-3.md` | Self-hosting `livekit-server` on Windows with no Docker — ports, config, the IPv6 trap, Cloud's real free-tier ceiling |
| `recon-4.md` | `livekit-server-sdk` 2.18 and `livekit-client` 2.22 — tokens, dispatch, mic-only publish, agent-joined detection |
| `recon-5.md` | Gemini TTS — all 30 voices, prompt steering, the 8192-token input cap, price, batch, and why SSML does not exist here |
| `avatar-0.md` | Real-time open-source talking heads, with code AND weights licences checked separately |
| `avatar-1.md` | Offline pre-rendered talking heads — the cheap half, since the recorded class needs no real time |
| `avatar-2.md` | Hosted avatar services with a usable free tier, ranked for rupee-scale unit economics |
| `avatar-3.md` | The browser-only stylised 2D path: zero marginal cost, offline, no likeness consent |

The licence findings in `avatar-0.md` and `avatar-1.md` are the part most worth
reading before writing any avatar code. Several of the repos the internet
recommends wear an MIT or Apache badge over non-commercial weights, and one
popular one has no licence file at all.
