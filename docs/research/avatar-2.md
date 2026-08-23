# Hosted live-avatar services with a genuinely usable free / near-free tier, plus the CPU-only and edge (on-device) options — assessed separately for the pre-rendered recorded class and the real-time live doubt.

## VERIFIED
CONFIRMED FROM PRIMARY SOURCES (I fetched these pages directly):

1. **The audio question is settled for every LiveKit-based provider.** LiveKit's avatar docs state the architecture explicitly: "The agent session sends its audio output to the avatar worker instead of to the room, which the avatar worker uses to publish synchronized audio + video tracks to the room," and instruct you to "Start your agent session with audio output disabled (the audio is sent to the avatar session instead)." So every provider on LiveKit's avatar list lip-syncs to OUR audio. The Gemini voice is safe. This was the biggest single risk in the brief and it is cleared.

2. **LiveKit avatar plugin language support** (from the LiveKit plugin index): Python + Node.js — Anam, Beyond Presence, D-ID, LemonSlice, Protoface, Runway, Tavus, TruGen. Python ONLY — Avatario, AvatarTalk, bitHuman, Keyframe, LiveAvatar, Simli, Spatius. Hedra listed as deprecated, confirming your dead-tombstone finding.

3. **bitHuman pricing, from docs.bithuman.ai/guides/pricing:** free 99 credits/month, no card. Essence 1 = 2 credits/min cloud, 1 credit/min self-hosted. Essence 2 = 4 cloud / 2 self-hosted. Top-ups $1 = 100 credits, so ~$0.01/credit. Paid: Creator $20/mo = 1,800 credits, 3 concurrent; Pro $99 = 10,000 credits, 10 concurrent; Business $299 = 50,000 credits, 50 concurrent. Agent creation is a one-time 500 credits (Essence 2) or 2,000 credits (Expression 2). Billing is per live rendered minute INCLUDING silent idle animation.

4. **bitHuman's "self-hosted" is not self-contained — this is the finding that matters.** From docs.bithuman.ai/guides/deploy-self-hosted: the container "demands BITHUMAN_API_SECRET for production," and "a decryption key is fetched from the API during startup to unlock encrypted model weights." Self-hosted GPU sessions "still incur charges... authenticated via once-per-minute billing heartbeat." So it is your hardware, their meter, their DRM, and it stops if their API is unreachable. There is a `BITHUMAN_UNMETERED=1` flag but the docs say local development only, not production.

5. **bitHuman's CPU claim is real but the hardware bill is buried.** Same page: "CPU-based Essence 2 achieves ~22–25 FPS on 16-core desktop." That is roughly one 16-core machine per concurrent avatar. The higher-quality Expression tier needs "Ampere-or-newer NVIDIA GPU (compute capability ≥ 8.0)" or an M3+ Mac, ~3 GB VRAM per session, ~5 GB weight download.

6. **bitHuman licences (from github.com/bithuman-product/bithuman-sdk-public):** repository Apache-2.0, example code MIT, **Python SDK = "Commercial license"**, Swift SDK = bitHuman Terms of Service. The pip wheels ship Cython-compiled `.so` files with client-side licensing material; the source is private. Avatar `.imx` files are generated on their platform from a photo/video you upload and are proprietary and encrypted. Quickstart confirms "Push audio — the avatar will lip-sync to it," so BYO Gemini audio works.

7. **bitHuman has no real browser path.** docs.bithuman.ai/sdk/wasm calls the WASM build "an engine-internal Emscripten beachhead, not a production browser SDK" and says it "does not ship the full client-side render pipeline." docs.bithuman.ai/sdk/javascript says the JS SDK "is not a local avatar engine — the engine runs on the server," is Preview v0.1, and "is not published to npm."

8. **Simli's JS SDK does exactly what you need** (docs.simli.com/api-reference/javascript.md): `npm install simli-client`, `sendAudioData(audioData: Uint8Array)` accepting **PCM16 at 16 kHz**, renders into an `HTMLVideoElement` over WebRTC, session token generated from your backend. Custom avatar (docs.simli.com/api-reference/create-avatar.md): upload **an image of a face**, "This can take a couple of hours."

9. **Spatius pricing page (spatius.ai/pricing), full table verified:** Free = 1,000 credits (~100 min/mo), 2 concurrent, 10-min session cap, **commercial use NOT permitted**, public avatars only. Starter $19/mo = ~2,000 min, 4 concurrent, 30-min sessions, 2 avatar creations/mo, commercial use enabled. Builder $49 = ~5,500 min, 8 concurrent. Growth $149 = ~18,000 min, 22 concurrent. Overage $0.009/min ($0.007 at Scale). Custom avatar creation $25 each. Web, iOS and Android SDKs on all plans.

10. **Protoface pricing page (protoface.com/pricing), verified:** Realtime Free = 50 credits, 1 custom avatar, 1 concurrent stream, **2-minute session maximum**. Realtime Starter $20/mo = 500 credits, 2 custom avatars, 2 concurrent, 10-min sessions, extra credits $0.02. Realtime Launch $99 = 7,500 credits, 100 avatars, 10 concurrent, 20-min sessions, extra credits $0.01. Custom avatar generation = 5 credits, self-serve via API. Page states it "ingests your agent's voice and emits" a face — BYO audio confirmed.

11. **LiteAvatar code licence is MIT — verified at github.com/HumanAIGC/lite-avatar/blob/main/LICENSE.** Claim: "audio2face model for realtime 2D chat avatar that can run in 30fps on only CPU devices without GPU acceleration."

12. **LiteAvatar WEIGHTS licence: NOT DECLARED.** I queried the ModelScope API directly (`modelscope.cn/api/v1/models/HumanAIGC-Engineering/LiteAvatarGallery`) and the **License field is empty and the Tags array is empty**, with 10,607 downloads and no usage terms in the README. This is the exact trap the brief warned about, and I am reporting it as unresolved rather than assuming it inherits MIT from the code. The ASR dependency (Paraformer, ModelScope `iic/speech_paraformer-large...`) is a separate model with its own separate licence that I did not verify.

13. **lite-avatar-WASM (github.com/fusheng-ji/lite-avatar-WASM):** MIT, ONNX Runtime Web, but ~817 MB of models downloaded to the browser, 1–2 GB RAM, and "~5–10 seconds for 150 frames" (150 frames = 6 s of video). Author's own note: "Model performance may not be optimal as the models are not fine-tuned or retrained."

INFERRED OR SECONDARY — TREAT WITH CAUTION:

- **Simli's per-minute price is not published anywhere I could reach.** simli.com/pricing and docs.simli.com/pricing both return 404, and their `llms.txt` documentation index contains no pricing page at all. The numbers in circulation are: Simli's own Trinity-1 launch claim of "less than 1 cent per minute"; a competitor's (Spatius) comparison putting Simli at "~$0.01/min entry, ~$0.009/min scale"; and third-party sites quoting "~$0.05/minute pay-as-you-go" (which I believe is the older Legacy model, not Trinity-1). Free tier is consistently reported as **$10 credit on signup plus a 50 min/month top-up**, but I could not verify this from Simli themselves. **You must confirm Simli's real rate and its concurrency limit before committing.**
- **Simli free-tier commercial rights: UNVERIFIED.** One secondary source states commercial licensing is a paid-plan feature. Simli's ToS was not reachable. Assume you need a paid plan for production.
- **Simli concurrency limits: not documented publicly anywhere.** For your use case this is the binding constraint, not minutes.
- Anam, HeyGen/LiveAvatar, D-ID, Trulience, Akool, Vidnoz, LemonSlice figures are all from secondary comparison articles, not vendor pages. They are directionally reliable and all land far above your budget, so precision does not matter for the decision.
- Avatario, TruGen, AvatarTalk, Keyframe publish **no pricing at all** — sales-led, therefore not usable by a solo founder with no budget. AvatarTalk's site offers only "Talk to Sales."
- Soul Machines and Yepic: no public per-minute pricing found; Soul Machines is enterprise sales-led. Both effectively out of reach.
- Quality judgement on Simli comes from one third-party buyer's evaluation (Docket), not my own testing.

## OPTIONS
Rupee conversions at ~₹88/USD, ~₹95/EUR.

## TIER 1 — the three that actually hit single-digit rupees per session

### 1. Simli (Simli AS, YC-backed)
- **Licence:** Closed commercial SaaS. No open-source component, no weights to license. LiveKit plugin wrapper is open source (Apache-2.0), the service is not.
- **Hardware needed:** None. A browser. This is the only Tier-1 option with a first-class browser SDK — `npm install simli-client`, WebRTC into an `HTMLVideoElement`. No Python worker, no LiveKit server, nothing to host.
- **Latency:** <300 ms video generation, per their own site. Trinity-1 renders at 25 FPS; Legacy at 30 FPS.
- **Quality:** The honest caveat — an independent buyer's evaluation (Docket) rated Simli's "idle behavior artifacts... the most pronounced" of the providers tested, with unnatural eye movement. It is the cheapest and it looks like the cheapest when nobody is speaking. During speech it is fine; between sentences it can read as uncanny.
- **How it is driven:** You push PCM16 @ 16 kHz with `sendAudioData(Uint8Array)`. **This is BYO-audio in the purest form — Simli has no opinion about your voice.** Gemini Live emits 24 kHz PCM16, so you need a 24k→16k downsample in the browser (a ~20-line `AudioContext`/resampler, not a project).
- **Custom face:** Self-serve, **from a single still image**, via app.simli.com/faces. Takes "a couple of hours" to build. Also has a free default-face library you can ship on day one.
- **Commercial use:** Paid plan almost certainly required — UNVERIFIED, confirm before launch.
- **Free tier:** ~$10 signup credit + 50 min/month recurring (secondary source).
- **Cost:** ~$0.01/min claimed by Simli for Trinity-1 → **~₹0.88/min → a 3-minute doubt costs ₹2.6, a 5-minute doubt ₹4.4.** Older Legacy model may be ~$0.05/min; make sure you are on Trinity.
- **Unknown:** concurrency cap. Ask them.

### 2. Spatius
- **Licence:** Closed commercial SaaS.
- **Hardware needed:** None. Web, iOS and Android SDKs on every plan including Starter. LiveKit plugin is Python-only.
- **Latency:** Not published; positions itself as "rendering-only, BYO stack," i.e. it does one job.
- **Quality:** Unverified — I have no independent evaluation. Smallest and newest vendor here, which is a real business-continuity risk for a product you want a stranger to maintain.
- **How it is driven:** Rendering-only by design — you bring your own LLM, STT and TTS. Gemini audio is the intended pattern.
- **Custom face:** Self-serve but **$25 per avatar creation**, with 2/month included on Starter. Input format not published.
- **Commercial use:** **Explicitly forbidden on the free tier.** Enabled from Starter ($19) up.
- **Free tier:** 1,000 credits (~100 min/mo), 2 concurrent, 10-min session cap, public avatars only — good for building, unusable for launch.
- **Cost:** **$19/mo = ~2,000 minutes = $0.0095/min ≈ ₹0.84/min**, 4 concurrent, 30-min session cap. Overage $0.009/min. This is the cheapest verified published rate in the entire market.
- **Best-in-class number:** at $19/mo you get 2,000 doubt-minutes. At a 3-minute average that is **666 doubt sessions for ₹1,670/month — about ₹2.5 per session.**

### 3. Protoface
- **Licence:** Closed commercial SaaS. LiveKit plugin available in **both Python and Node.js** — the only Tier-1 option with a Node path, which matters if you ever move the doubt agent off the browser onto a TypeScript server.
- **Hardware needed:** None.
- **Latency:** Not published.
- **Quality:** Unverified. New entrant (launched its LiveKit plugin recently).
- **How it is driven:** Their own words — it "ingests your agent's voice and emits" a face. BYO audio.
- **Custom face:** Self-serve via API, 5 credits per generation. Input format not published.
- **Commercial use:** Not stated for the free tier; assume paid.
- **Free tier:** 50 credits, 1 custom avatar, **1 concurrent stream, 2-minute session cap.** The 2-minute cap collides directly with your 2–5 minute doubt window, so the free tier cannot even demo the real product.
- **Cost:** Starter $20/mo = 500 credits, 2 concurrent, 10-min sessions, overage $0.02/credit. Launch $99/mo = 7,500 credits, 10 concurrent, 20-min sessions, overage $0.01. **Effective ~$0.04/min at Starter, ~$0.013/min at Launch.** The advertised "$0.01/min" is the scale rate, not the entry rate.

## TIER 2 — the CPU-only / edge options

### 4. bitHuman — the CPU claim is real, the independence is not
- **Licence, code:** Repo Apache-2.0; examples MIT; **the Python SDK itself is under a "Commercial license"** and ships as Cython-compiled closed wheels with the source in a private repo. Swift SDK under bitHuman ToS.
- **Licence, weights:** `.imx` avatar files are **proprietary AND encrypted**. The decryption key is fetched from bitHuman's API at container startup. There is no scenario in which you own or run these weights independently.
- **Hardware:** Essence tier — "any CPU (laptop, server, Raspberry Pi)", but the honest number from their own deploy guide is **~22–25 FPS on a 16-core desktop**. That is roughly one 16-core box per concurrent stream. A 16-vCPU cloud VM is ~$0.005–0.012/min of compute — **so self-hosting costs about as much in machine as the cloud tier costs in credits, and you pay the credits anyway.** Expression tier needs an Ampere+ NVIDIA GPU or an M3+ Mac.
- **Latency:** 25 FPS real-time lip-sync, on-device.
- **Quality:** Essence is the lightweight tier (the one that runs on CPU); Expression is the good-looking tier and it needs a GPU. You cannot have both cheap and pretty here.
- **How it is driven:** Push audio, avatar lip-syncs. BYO Gemini audio confirmed.
- **JS support:** **No.** LiveKit plugin is Python-only. The WASM build is described by bitHuman as "an engine-internal Emscripten beachhead, not a production browser SDK." The `@bithuman/sdk` JS client is Preview v0.1, **not published to npm**, and is a thin client to their server engine anyway. For a React/Vite app this is a dead end today; the supported browser path is an iframe embed of their hosted renderer.
- **Custom face:** Self-serve from a photo or video on bithuman.ai, one-time 500 credits (Essence 2) or 2,000 credits (Expression 2) — i.e. **$5 or $20 per avatar**.
- **Commercial use:** Yes, under their commercial licence, which the API key embodies.
- **Free tier:** 99 credits/month, no card — ~99 min self-hosted Essence 1, or ~50 min cloud. Note billing counts **idle silent animation**, so a paused avatar still burns credits.
- **Cost:** Essence 1 self-hosted 1 credit/min = **$0.01/min ≈ ₹0.88/min** plus your own machine; cloud 2 credits/min = $0.02/min. Creator plan $20/mo = 1,800 credits, **3 concurrent**.
- **Verdict on the specific claim you asked about:** the CPU-only real-time claim is TRUE and the LiveKit plugin is REAL and maintained (unlike Hedra). But "self-hosted" here does not mean free, does not mean offline, and does not mean JavaScript. It is DRM-gated rental of a binary that happens to run on your CPU.

### 5. LiteAvatar (Alibaba HumanAIGC) — genuinely free, genuinely CPU, legally unresolved
- **Licence, code: MIT** — verified in the repo's LICENSE file. Truly permissive.
- **Licence, weights: NOT DECLARED.** I checked the ModelScope API record for `HumanAIGC-Engineering/LiteAvatarGallery` directly: the License field is **empty**. No licence, no tags, no usage terms in the README. This is not "permissive," it is "no grant of rights at all," which for commercial use is arguably worse than an explicit non-commercial licence because you have nothing to point at. The ASR dependency (Paraformer via ModelScope/FunASR) is a separate model with its own separate licence I did not verify.
- **Hardware:** Claims **30 FPS on CPU with no GPU**, and says the 2D face generator "can also be deployed on mobile devices realizing realtime inference." 150+ pre-built avatar characters in the gallery.
- **Latency:** Real-time capable by design; also runs offline batch (`--audio_file /path/to/audio.wav`).
- **Quality:** 2D talking-head, mouth-region animation. Lower fidelity than the paid Gaussian/diffusion services — this is a competent talking photo, not a photoreal human.
- **How it is driven:** You give it a WAV file or an audio stream. Fully BYO — it never generates a voice.
- **Custom face:** Not self-serve. You use gallery avatars, or you build your own avatar data with their tooling.
- **Commercial use:** **Cannot be established.** Code yes; weights unknown. Do not ship this commercially until Alibaba clarifies the gallery licence.
- **Cost:** ₹0 in licence fees. Your only cost is the CPU it runs on — which for the RECORDED lesson can be your own laptop overnight, i.e. genuinely free.
- **Browser variant:** `lite-avatar-WASM` (MIT) runs it in-browser via ONNX Runtime Web, but downloads ~817 MB of models and needs 1–2 GB RAM, generating 6 seconds of video in 5–10 seconds. **Not viable for Indian students on mid-range Android phones.** Useful only as an offline desktop renderer.

## TIER 3 — investigated and rejected on price

| Provider | Per-minute | Free tier | Why rejected |
|---|---|---|---|
| **HeyGen Interactive / LiveAvatar** | $0.095–0.25/min (Lite mode is the BYO-LLM/TTS one at ~$0.10) | **No free API tier** | ~₹9–22/min. 10–25× your budget. Best idle behaviour of any provider tested, but irrelevant at this price. |
| **Anam** | $0.11–0.16/min overage; blended $0.20–0.24 | 30 min/mo | ~₹10–14/min. Their cara-4 single-photo custom avatars are reportedly the best quality available — worth remembering if the product ever earns a bigger budget. Minutes expire monthly. |
| **LemonSlice** | $0.14–0.19/min | No recurring free allowance | ~₹12–17/min. LiveKit Python+Node. |
| **D-ID** | ~$0.56/min streaming ($18 for 32 streaming min) | 14-day trial, **full-screen watermark, personal-use licence only** | ~₹49/min. Worst value here despite the best-known brand. |
| **Trulience** | Starter $199/mo for 1,000 min = $0.20/min | 30 interactive min/mo (60 non-interactive) | 3D avatar rather than talking photo. The $199 floor is the killer — there is no small paid step. Does support BYO providers via your own API keys. |
| **Akool** | $30/mo for ~20 min of 1080p | Watermarked, 720p cap | Batch video-generation credit model, not a real-time-first product. |
| **Vidnoz** | ~$20/mo for ~15 min | 8 credits/day ≈ 16 s of video | Consumer video tool. Not an API product. |
| **Runway real-time avatar** | $0.20/min + $0.02 startup | 125 one-time credits | ~₹18/min. |
| **Avatario, TruGen, AvatarTalk, Keyframe, LiveAvatar, Soul Machines, Yepic** | Not published | Not published | **All sales-led with no public pricing.** A solo founder with no budget cannot transact with any of them. Excluded on that basis alone. |
| **Beyond Presence** (your baseline) | €0.09–0.175/min | 40 min/mo, 3-min sessions, 1 concurrent | ~₹9–17/min → a 3-min doubt costs ₹27–50. |
| **Tavus** (your baseline) | $0.32–0.37/min | 25 min/mo | ~₹28–33/min → a 3-min doubt costs ₹84–99. |

## Hidden cost to budget for
If you route the live doubt through LiveKit Cloud rather than browser-direct: agent-session minutes are **$0.01/min** plus WebRTC media at $0.0004–0.0005/min. That doubles your per-minute cost at these price points. LiveKit's server is Apache-2.0 and self-hostable, and Simli's browser SDK lets you skip LiveKit entirely.

## RECOMMENDATION
## The brief is right: these are two problems, and the recorded one is nearly free

**Problem A — the recorded class.** This does not need a real-time avatar service at all, and it does not need an offline renderer either. The cheapest correct answer is a trick: **use a real-time vendor once, offline, and keep the MP4 forever.** Drive Simli (or Spatius) with your pre-rendered Gemini TTS narration, capture the WebRTC stream to a file, ship the file. A 30-minute lesson costs **30 minutes × ~₹0.88 = about ₹26, one time, for a video every student watches for the life of the product.** There is no per-view cost, no CDN-vs-avatar tradeoff, no licence question, and no second rendering pipeline for a stranger to learn on their first day. Anything more elaborate — standing up LiteAvatar, buying GPU hours, learning a second toolchain — is spending days of your time to save ₹26 per lesson, and it adds a whole subsystem to the handover surface. Do not do it.

The one reason to reach for LiteAvatar on Problem A is if you want the recorded avatar to be a face you are not licensed to rent — but that is a rights problem, not a cost problem, and LiteAvatar's own weights licence is undeclared, so it does not actually solve a rights problem either.

**Problem B — the live doubt.** This is the only place real-time matters, and it is where the money goes.

## Ranking for the live doubt

**1. Simli — start here.** It is the only option that fits your actual stack. `simli-client` is an npm package that takes PCM16 audio and paints a face into a `<video>` element; your React/Vite app talks to it directly, and Gemini Live's audio goes straight in. No Python worker, no LiveKit bill, no server to hand over. Custom face from a single photograph, self-serve. At the claimed Trinity-1 rate a 3-minute doubt is **₹2.6** and a 5-minute doubt is **₹4.4** — inside your single-digit-rupee target with room to spare, and 10–30× cheaper than Beyond Presence or Tavus. Two things to nail down before you commit: **confirm the actual per-minute rate in writing** (they publish nothing, and the 404 on their pricing page is not reassuring), and **ask for the concurrency limit**, which is undocumented and is your real ceiling. Accept the quality trade: an independent evaluation found its idle behaviour the weakest of the majors. Since your avatar only appears when a hand is raised and is almost always speaking, idle artifacts are the defect you can most afford.

**2. Spatius — the price floor, and your negotiating position.** $19/month for ~2,000 minutes with 4 concurrent streams and commercial rights is the cheapest verified published number in this market: **~₹2.5 per 3-minute doubt, 666 doubts a month for ₹1,670 total.** It has a real web SDK. Two cautions: the free tier explicitly forbids commercial use, so you cannot pilot with paying students on it; and it is the smallest vendor here, which is a genuine risk for a product whose whole architecture is built around a stranger picking it up. Use it as the number you quote to Simli, and as your fallback if Simli's real rate turns out to be $0.05/min rather than $0.01.

**3. Protoface — the Node.js insurance policy.** Only option in the cheap tier with a Node LiveKit plugin, which matters the day you move the doubt agent off the browser onto a TypeScript server. But the free tier's **2-minute session cap cannot even demo your 2–5 minute doubt**, and Starter's effective ~$0.04/min is 4× Simli. Keep it on the list, do not lead with it.

**4. bitHuman — technically impressive, wrong shape for you.** The CPU claim is real and the LiveKit plugin is alive, so it answers the question you asked. But it fails three of your constraints at once. It is Python-only with no usable browser path, so it forces a whole server-side component into an app that currently has none — directly against your handover-first rule. "Self-hosted" still phones home every minute for billing and fetches a decryption key to unlock encrypted weights, so it buys you no independence. And the economics do not actually beat the hosted options: 22–25 FPS needs a 16-core machine per stream, and you pay the ₹0.88/min credit rate on top of that machine. The one case where bitHuman genuinely wins is a future where you ship an offline-capable Android app for students with bad connectivity and want the avatar rendering on the device — that is a real and interesting road, but it is not this quarter's problem.

**5. LiteAvatar — free, and I cannot clear it for commercial use.** MIT code, 30 FPS on CPU, 150+ ready avatars, zero licence cost. And the weights have **no declared licence at all** — I checked ModelScope's own API record and the License field is empty. That is not permission; it is silence. For a product you intend to charge Indian parents for, shipping on silently-licensed Alibaba weights is a risk you take on with no upside, because the alternative costs ₹2.6 a session. If you want to pursue it, the action is to open an issue on the lite-avatar repo asking HumanAIGC to state the LiteAvatarGallery licence explicitly — until they answer, treat it as unusable.

**Everything else is out.** HeyGen, Anam and LemonSlice are ₹9–17/min. D-ID is ₹49/min with a personal-use-only free tier. Tavus and Beyond Presence you already priced. And Avatario, TruGen, AvatarTalk, Keyframe, LiveAvatar, Soul Machines and Yepic publish no pricing at all, which means "talk to sales" — a door that is closed to a solo founder with no budget, regardless of how good the product is.

## The one thing that will actually break this
Not minutes. **Concurrency.** Every cheap plan caps you at 1–4 simultaneous streams: Spatius Starter gives 4, Protoface Starter gives 2, bitHuman Creator gives 3, and Simli does not publish theirs. Minutes are cheap and scale linearly; concurrent streams are the wall, and they are what forces the jump from $19–20/month to $99–149/month. Model your cost on **peak simultaneous hands raised**, not on total minutes — because if 5 students in one recorded lesson tap "raise hand" in the same 30 seconds, the fifth one gets an error, not a tutor. Instrument that number from day one, and consider a "you're next in line" queue in the UI so the concurrency ceiling degrades into a short wait rather than a failure.

## SOURCES
- https://docs.livekit.io/agents/models/avatar/ — LiveKit avatar plugin index: full provider list, Python vs Node.js support, and the audio-flow architecture confirming BYO-TTS
- https://docs.livekit.io/agents/models/avatar/plugins/bithuman/ — bitHuman LiveKit plugin, Python-only, .imx model acquisition
- https://docs.livekit.io/agents/models/avatar/plugins/simli/ — Simli LiveKit plugin, face_id, custom faces at app.simli.com/faces
- https://docs.livekit.io/agents/models/avatar/plugins/protoface/ — Protoface LiveKit plugin, Python + Node.js, avatar_id, session duration capping
- https://docs.bithuman.ai/guides/pricing/ — PRIMARY: bitHuman credits, free 99/mo, per-model cloud vs self-hosted rates, plan tiers and concurrency, $1=100 credits
- https://docs.bithuman.ai/guides/deploy-self-hosted — PRIMARY: BITHUMAN_API_SECRET requirement, encrypted weights + decryption key fetched at startup, once-per-minute billing heartbeat, 'CPU-based Essence 2 achieves ~22-25 FPS on 16-core desktop', GPU requirements for Expression
- https://docs.bithuman.ai/sdk/wasm — PRIMARY: WASM build is 'an engine-internal Emscripten beachhead, not a production browser SDK'
- https://docs.bithuman.ai/sdk/javascript — PRIMARY: JS SDK 'is not a local avatar engine — the engine runs on the server', Preview v0.1, not published to npm
- https://docs.bithuman.ai/introduction — 25 FPS real-time lip-sync claim, supported SDK languages
- https://github.com/bithuman-product/bithuman-sdk-public — PRIMARY: licence split (repo Apache-2.0, examples MIT, Python SDK 'Commercial license', Swift SDK ToS); Essence 'any CPU', Expression 'NVIDIA GPU or Mac with M3+'; 'Push audio — the avatar will lip-sync to it'
- https://pypi.org/project/bithuman/ — bitHuman pip package (Cython-compiled closed wheels)
- https://www.bithuman.ai/pricing — bitHuman free tier and 'from 1 credit per minute self-hosted'
- https://docs.simli.com/api-reference/javascript.md — PRIMARY: simli-client npm package, sendAudioData(Uint8Array), PCM16 @ 16 kHz requirement, HTMLVideoElement rendering, backend session-token generation
- https://docs.simli.com/api-reference/create-avatar.md — PRIMARY: custom avatar from a face image, 'can take a couple of hours'
- https://docs.simli.com/llms.txt — Simli documentation index (notably contains NO pricing page)
- https://www.simli.com/ — Simli free plan ($10 signup + 50 min/mo top-up), <300 ms latency claim, Trinity vs Legacy models
- https://www.linkedin.com/posts/simli_for-the-past-year-our-team-at-simli-has-activity-7349167562619781121-rs0z — Simli's own Trinity-1 launch claim of 'less than 1 cent per minute'
- https://www.spatius.ai/pricing — PRIMARY: full Spatius plan table, free tier commercial-use prohibition, concurrency and session caps, $25 custom avatar creation, $0.009/min overage
- https://www.spatius.ai/blog/compare-pricing-leading-ai-avatar-services-2026/ — cross-vendor per-minute comparison (vendor-authored, treat as directional): Simli, LiveAvatar, Anam, Beyond Presence, Tavus, Runway
- https://www.protoface.com/pricing — PRIMARY: Protoface Video and Realtime plan tables, free tier 2-minute session cap and 1 concurrent stream, credit costs, custom avatar at 5 credits
- https://www.protoface.com/blog — Protoface '$0.01/min' headline claim
- https://gofranz.com/blog/real-time-ai-avatars-what-they-actually-cost/ — independent cost analysis of LiveAvatar/HeyGen, Anam, Tavus, Beyond Presence, incl. which support bring-your-own-audio
- https://www.docket.io/blog/heygen-vs-tavus-vs-anam-vs-simli-how-we-chose-dockets-ai-avatar-provider — independent buyer evaluation; source of the Simli idle-artifact quality caveat and HeyGen Lite Mode BYO-LLM/TTS pricing
- https://github.com/HumanAIGC/lite-avatar — LiteAvatar repo, 30 FPS CPU claim, mobile deployment claim
- https://github.com/HumanAIGC/lite-avatar/blob/main/LICENSE — PRIMARY: MIT licence for LiteAvatar CODE
- https://modelscope.cn/api/v1/models/HumanAIGC-Engineering/LiteAvatarGallery — PRIMARY: LiteAvatar WEIGHTS repo API record showing the License field is EMPTY and no usage terms are declared
- https://modelscope.cn/models/iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch — Paraformer ASR dependency used by LiteAvatar (separate, unverified licence)
- https://github.com/fusheng-ji/lite-avatar-WASM — MIT browser/WASM port of LiteAvatar; ~817 MB models, 1-2 GB RAM, 150 frames in 5-10 s, author's caveat that models are not fine-tuned
- https://github.com/HumanAIGC-Engineering/OpenAvatarChat — Apache-2.0 realtime chat stack wrapping LiteAvatar; does not restate component weight licences
- https://selviaai.com/heygen-pricing-explained — HeyGen Interactive Avatar API ~$0.20/min full, ~$0.10/min avatar-only tier, no free API tier
- https://www.g2.com/articles/heygen-api-pricing — HeyGen API pricing breakdown
- https://anam.ai/pricing — Anam plan tiers and overage rates
- https://www.trulience.com/pricing — Trulience free 30 min/mo, Starter $199/mo for 1,000 min, BYO-provider support via your own API keys
- https://lemonslice.com/pricing — LemonSlice plans (~$0.14-0.19/min, no recurring free allowance)
- https://heyfish.ai/d-id-review — D-ID API per-minute pricing, streaming rates, free-trial watermark and personal-use licence
- https://fluxnote.io/guides/d-id-pricing-guide-2026 — D-ID plan breakdown
- https://www.vidmetoo.com/akool-pricing-explained-plans-credits-and-hidden-costs/ — Akool credit model and per-minute equivalents
- https://aiblogfirst.com/akool-free-trial/ — Akool free tier watermark and 720p cap
- https://www.vidnoz.com/pricing.html — Vidnoz credit-based plans
- https://avatartalk.ai/ — AvatarTalk (no published pricing, sales-led)
- https://www.avatario.ai/docs/integrations/livekit — Avatario LiveKit plugin (no published pricing)
- https://livekit.com/pricing — LiveKit Cloud tiers; agent-session minutes $0.01/min plus WebRTC media minutes, relevant as a hidden add-on cost
- https://adtmag.com/articles/2025/08/13/bithuman-launches-cpu-based-avatar-sdk.aspx — bitHuman CPU-based SDK launch coverage (Arm and x86, LiveKit plug-in)