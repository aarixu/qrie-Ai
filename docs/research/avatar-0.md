# REAL-TIME open-source talking-head / lip-sync models for a LIVE doubt session (the "raise hand" half of the AI tutor). Licence rigour on code vs. weights; real hardware for real-time, not batch.

## VERIFIED
CONFIRMED FROM PRIMARY SOURCES (repo LICENSE files, GitHub licence API, raw READMEs, HF model-card metadata, arXiv papers):

- MuseTalk: README raw text — code MIT; "The trained model are available for any purpose, even commercially"; 30fps+ on Tesla V100; 256x256 face region; realtime_inference.py needs `preparation=True` per avatar and reads `audio_path`/`audio_clips` (files). HF model-card YAML front matter reads `license: creativeml-openrail-m` — a direct conflict with the README's "any purpose" wording. I read the CreativeML OpenRAIL-M text itself: it DOES permit commercial use, including SaaS hosting, subject to Attachment A use-based restrictions. So "commercially usable" is correct, but the weights are NOT unencumbered — the restrictions must flow down to your users.
- LatentSync: GitHub LICENSE file = Apache-2.0 (read raw, no added clauses). HF ByteDance/LatentSync-1.5 AND LatentSync-1.6 model cards both = `openrail++`. Code and weights genuinely differ. README: 8 GB VRAM (1.5), 18 GB (1.6); video+audio file in, video file out.
- Ditto-TalkingHead: GitHub Apache-2.0. HF `digital-avatar/ditto-talkinghead` ships its own LICENSE file — I read it, it is plain Apache-2.0, no appended clauses. Paper (arXiv 2411.19509) Table 4: online streaming RTF 0.895, first-frame delay 385 ms, on "12-core Intel Xeon Platinum 8369B + 1 NVIDIA A100 + 100G memory"; 0.4-second audio stream units. Shipped TensorRT engines are named `ditto_trt_Ampere_Plus`.
- LivePortrait: LICENSE file is MIT AND carries an explicit note: "The models of InsightFace are for non-commercial research purposes only... If you want to use the LivePortrait project for commercial purposes, you should remove and replace InsightFace's detection models." HF weights card = MIT. It is VIDEO-driven, not audio-driven.
- SadTalker: README — "The license has been updated to Apache 2.0, and we've removed the non-commercial restriction."
- Wav2Lip: README verbatim — "This repository can only be used for personal/research/non-commercial purposes"; models trained on LRS2 mean "any form of commercial use is strictly prohibited"; commercial requests go to rudrabha@synclabs.so / prajwal@synclabs.so. CONFIRMED TRAP.
- V-Express: README verbatim — "The code of V-Express is released for both academic and commercial usage. However, both manual-downloading and auto-downloading models from V-Express are for non-commercial research purposes." CONFIRMED TRAP — code and weights diverge.
- Sonic: CC BY-NC-SA-4.0, README states "our license is non-commercial. If commercialization is required, please use Tencent Cloud Video Creation Large Model." CONFIRMED TRAP.
- FLOAT: README verbatim — "Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International"; "You may not use this work for commercial purposes and may use it only for research purposes." CONFIRMED TRAP.
- EchoMimic v1 / v2 / v3: all three GitHub repos = Apache-2.0 via GitHub licence API. BUT the HF weight repos BadToBest/EchoMimic and BadToBest/EchoMimicV2 both return "empty or missing yaml metadata in repo card" — there is NO licence tag on the weights. v2 README says only "This project is intended for academic research."
- Hallo: code MIT (API); HF fudan-generative-ai/hallo = `mit`. Hallo2: code MIT; HF = `mit`; BUT its high-resolution module is "a modified version of CodeFormer" and the README requires you to "comply with the S-Lab License 1.0" — S-Lab 1.0 is non-commercial. Hallo3: code MIT, but README states the weights are "a fine-tuned derivative version based on the CogVideo-5B I2V model" and "the use, distribution, and modification of this model must comply with the license terms of CogVideo-5B"; tested on H100.
- AniPortrait: Apache-2.0 (API).
- JoyVASA: code MIT (API); HF jdh-algo/JoyVASA = `mit`. But it is built on LivePortrait, so the InsightFace non-commercial caveat above applies to the pipeline.
- Real3D-Portrait: code MIT (API). Checkpoints are on Google Drive / BaiduYun with NO stated licence.
- bithuman: NOT open source. bithuman-product/bithuman-sdk-public README states the Python SDK is under a "commercial license"; the wheels ship Cython-compiled .so with the runtime source private. Example code only is MIT. Requires `BITHUMAN_API_SECRET`. 25 FPS. Essence model = "Any CPU (laptop, server, Raspberry Pi)"; Expression = "NVIDIA GPU or Mac with M3+". Streams via `push_audio` (resampled to 16 kHz internally). Python wheels target Linux x86_64/aarch64 and macOS Apple Silicon — no Windows wheels listed. LiveKit plugin is live and documented; Hedra is the only one marked deprecated in LiveKit's provider table.
- SoulX-FlashHead (the headline find, Feb 2026): GitHub Apache-2.0 (API) AND HF Soul-AILab/SoulX-FlashHead-1_3B model card = `apache-2.0`. Built on Wan2.1-T2V-1.3B, whose HF card is also `apache-2.0` — the licence chain is clean end-to-end. README verbatim: "Model_Lite: get 96 FPS, or 3-concurrent real-time(25+ FPS) streaming on single RTX4090"; "Model_Pro... 10.8 FPS on single RTX4090, or real-time(25+ FPS) on two RTX5090". Paper (arXiv 2602.07449v2): 512x512 output, streaming audio fragments of "approximately 1.32 seconds" with an 8-second audio context window.
- LiveTalking (the WebRTC harness): Apache-2.0. README gives real numbers: wav2lip256 = 120 FPS on RTX 3080Ti; MuseTalk = 72 FPS on RTX 4090; minimum RTX 3060 for wav2lip, RTX 3080Ti for MuseTalk; both `inferfps` and `finalfps` must be >=25 to count as real-time. Supports WebRTC/RTMP/virtual camera.
- lite-avatar (LiteAvatar): code MIT (API). "can run in 30fps on only CPU devices without GPU acceleration". Needs a pre-built avatar from LiteAvatarGallery; sample script takes `--audio_file`.
- OpenAvatarChat: Apache-2.0 (API). Backends: LiteAvatar, LAM Audio2Expression, MuseTalk, SoulX-FlashHead. "~2.2s average response time". WebRTC via a forked gradio-webrtc.
- NVIDIA Audio2Face-3D: open-sourced Sept 2025 but under the "NVIDIA Open Model License", NOT Apache/MIT. >60 FPS, supports real-time streams. Outputs 3D blendshapes, not photoreal video.
- met4citizen/TalkingHead: MIT (API). Browser JS, real-time lip-sync on Ready Player Me 3D avatars, runs on the student's device.
- Hallo-Live (arXiv 2604.23632, 26 Apr 2026): 0.94 s latency and 20.38 FPS on TWO NVIDIA H200 GPUs. No code or weights release stated.
- Cheap GPU rental: RunPod RTX 4090 $0.34/hr community cloud, A100 80GB $1.39/hr. Vast.ai RTX 4090 from $0.13/hr, median $0.44/hr.
- bitHuman pricing (docs.bithuman.ai/guides/pricing): Free 99 credits/mo; Creator $20/mo = 1,800 credits; Pro $99/mo = 10,000 credits. Serving: Essence 1 = 1 credit/min self-hosted, 2 cloud; Essence 2 = 2 self-hosted, 4 cloud. Agent creation one-time 250 credits (Essence 1). Top-up "$1 = 100 credits".

COULD NOT ESTABLISH (stated plainly rather than assumed):
- EchoMimic v1/v2 WEIGHTS licence — no licence metadata on the HF repos at all. Do not assume it follows the Apache-2.0 code.
- Real3D-Portrait WEIGHTS licence — checkpoints on Drive/Baidu with nothing attached.
- Ultralight-Digital-Human: GitHub licence API returns `license: null` and the repo root file listing contains NO LICENSE file (verified both ways), despite an Apache-2.0 badge in the README. No licence file = all rights reserved = legally unusable. Actively pushed as of 2026-07-22, 2.6k stars — so this is a live trap, not a dead repo.
- SoulX-FlashHead VRAM: neither the repo nor the paper states it. A secondary blog claims ~6.4 GB for Lite; treat as unverified.
- Whether SoulX-FlashHead's streaming Gradio demo accepts a live microphone stream vs. chunked file — not documented in the repo.
- LiveTalking has a README clause requiring a LiveTalking watermark on videos published to B站/视频号/抖音, which is an extra condition not in Apache-2.0. Ambiguous; ask before relying on it commercially.
- NOBODY has publicly wired SoulX-FlashHead or Ditto to LiveKit. I searched specifically; LiveKit's own issue #3216 ("Architecture for self-implemented Virtual Avatars", opened 21 Aug 2025) was CLOSED AS NOT PLANNED with no maintainer answer. LiveKit does ship a Python `AvatarRunner` / `DataStreamAudioOutput` helper for custom workers, but the only avatar example in the repo uses LemonSlice, a paid vendor. You would be writing that worker yourself.

## OPTIONS
=== TIER A: ACTUALLY REAL-TIME, LICENCE-CLEAN, USABLE COMMERCIALLY ===

1. SoulX-FlashHead (Soul-AILab) — THE ANSWER THAT CHANGED IN 2026
- Licence: code Apache-2.0 (GitHub LICENSE, confirmed via API). WEIGHTS Apache-2.0 (HF model-card tag on Soul-AILab/SoulX-FlashHead-1_3B). Base model Wan2.1-T2V-1.3B is also Apache-2.0. Clean chain, no InsightFace, no OpenRAIL, no NC clause. Commercial: YES.
- Hardware for real-time: project's own claim — Model_Lite "96 FPS, or 3-concurrent real-time (25+ FPS) streaming on single RTX4090". Model_Pro "10.8 FPS on single RTX4090, or real-time (25+ FPS) on two RTX5090". CPU: no. VRAM figure not published (a blog claims ~6.4 GB for Lite — unverified).
- Driven by: streaming audio fragments of ~1.32 s with an 8 s rolling audio context window; explicitly trained for "audio arriving in short fragments". It CAN start speaking before the audio is finished — this is the property that makes it a live-conversation candidate rather than a renderer.
- Input: a single portrait image. Output 512x512.
- LiveKit/WebRTC: NO existing integration. OpenAvatarChat (Apache-2.0) lists FlashHead as a backend, which is the nearest thing to a pre-wired WebRTC path. A LiveKit plugin would be yours to write against `AvatarRunner`.
- Released Feb 2026; online demo Mar 2026.

2. Ditto-TalkingHead (Ant Group, ACM MM 2025)
- Licence: code Apache-2.0; WEIGHTS Apache-2.0 (the HF weight repo ships its own Apache-2.0 LICENSE — I read it). Commercial: YES.
- Hardware for real-time: the paper's own numbers — online streaming RTF 0.895 on 1x A100 (with a 12-core Xeon). RTF 0.895 means it consumes 0.895 s of compute per 1 s of video: real-time with ~10% headroom, ON AN A100. That headroom is gone on anything smaller. Shipped TensorRT engines are Ampere-or-newer only. CPU: no.
- Latency: first-frame delay 385 ms (talking-head), stated in the paper.
- Driven by: 0.4 s audio stream units, genuinely streaming. Yes, starts before audio ends.
- Input: a single image.
- LiveKit/WebRTC: none found.
- Verdict: licence-perfect and truly streaming, but the A100 requirement ($1.39/hr on RunPod) makes it the expensive option now that FlashHead exists.

3. MuseTalk 1.5 (Tencent Music / TMElyralab)
- Licence: code MIT. WEIGHTS: HF YAML says `creativeml-openrail-m` while the README says "available for any purpose, even commercially". I verified the OpenRAIL-M text — it permits commercial use and SaaS hosting, so the two are reconcilable, but you inherit Attachment A use-based restrictions and must pass them to downstream users. Commercial: YES, with conditions. Note also that whisper / ft-mse-vae / dwpose / S3FD each keep their own licences.
- Hardware: project's claim 30 FPS+ on a Tesla V100 at a 256x256 face region. LiveTalking measured 72 FPS on an RTX 4090 and specifies RTX 3080Ti as the minimum. On a 4 GB RTX 3050 Ti laptop the README reports ~5 minutes for an 8-second clip — i.e. not remotely real-time on small consumer GPUs.
- Driven by: MuseTalk's OWN realtime_inference.py takes audio FILES (`audio_path`, `audio_clips`) and requires a one-time `preparation=True` pass per avatar. The streaming plumbing lives in LiveTalking, not in MuseTalk.
- Input: a short video or an image directory of the avatar (pre-processed into cached latents).
- LiveKit/WebRTC: no LiveKit plugin, but LiveTalking (Apache-2.0) wires it to WebRTC and is actively maintained — this is the most battle-tested self-hosted real-time path that exists today.
- Caveat: it inpaints the mouth region of an existing video loop. Lower risk, lower ceiling than FlashHead.

=== TIER B: REAL-TIME BUT NOT PHOTOREAL, OR NOT OPEN SOURCE ===

4. bithuman — closed SDK, but the only credible CPU-only real-time option
- Licence: NOT open source. Python SDK under a "commercial license"; runtime ships as Cython-compiled .so with source private. Only the examples are MIT. Requires BITHUMAN_API_SECRET (an online licence check).
- Hardware: Essence model runs on "any CPU (laptop, server, Raspberry Pi)" at 25 FPS. Expression needs an NVIDIA GPU or an M3+ Mac. Wheels: Linux x86_64/aarch64 + macOS Apple Silicon. No Windows wheels — you would need WSL2 or a Linux box.
- Driven by: `push_audio`, true streaming, resampled to 16 kHz internally. Starts before audio ends.
- Input: you upload a photo or video at bithuman.ai; Essence produces a `.imx` model. Expression can take a face image at runtime.
- LiveKit: YES, first-party, documented, maintained (`livekit-plugins-bithuman`). Contrast with Hedra, which is the only provider LiveKit marks deprecated.
- Cost: Creator $20/mo = 1,800 credits; Essence 1 self-hosted burns 1 credit/min → 30 hours/month → about $0.67/hour of live avatar. Top-ups are $1 = 100 credits → $0.60/hour. Cloud doubles it. One-time 250 credits (~$2.50) to create each avatar. Free tier is 99 credits/month (~1.6 hours).

5. LiteAvatar (HumanAIGC, Alibaba) — MIT, 30 FPS on CPU, but stylised 2D
- Licence: code MIT (verified). The avatar assets come from LiteAvatarGallery — I did NOT establish a licence for the gallery assets; treat that as open.
- Hardware: claims 30 FPS on CPU only, no GPU, and says the 2D face generator can run on mobile.
- Driven by: sample script takes an audio file; streaming is handled by OpenAvatarChat around it.
- Input: a pre-trained avatar identity (not an arbitrary photo — you cannot self-serve a new identity from the repo).
- WebRTC: yes, via OpenAvatarChat (Apache-2.0), ~2.2 s average response time.
- Quality: 2D chat avatar, not photoreal video. Honest about being "lite".

6. NVIDIA Audio2Face-3D — real-time, but 3D blendshapes, not photoreal
- Licence: models under the "NVIDIA Open Model License" (NOT Apache/MIT); Audio2Emotion under a separate NVIDIA agreement. SDK/plugins on GitHub. Read the NVIDIA Open Model License before committing — it is permissive-ish but bespoke.
- Hardware: >60 FPS; supports pre-recorded files AND real-time streams. Needs an NVIDIA GPU.
- Output: facial blendshapes driving a 3D character (Maya / UE5 plugins shipped), not a photo.

7. met4citizen/TalkingHead — MIT, real-time, zero server cost
- Licence: MIT, code only, no model weights involved. Commercial: YES, unambiguously.
- Hardware: NONE on your side. It runs in the STUDENT'S browser on a Ready Player Me GLB avatar with viseme-based lip-sync. Works with any TTS that returns word-level timestamps.
- This is the only option in this whole list with a marginal cost of exactly zero per minute.

=== TIER C: LICENCE TRAPS — DO NOT SHIP ===

8. Wav2Lip — the famous trap, confirmed. README: "This repository can only be used for personal/research/non-commercial purposes." LRS2-trained weights: "any form of commercial use is strictly prohibited." Code licence is irrelevant; the checkpoint kills it. Note LiveTalking's fastest number (120 FPS on a 3080Ti) is wav2lip256 — that speed is unavailable to you commercially.
9. V-Express (Tencent AI Lab) — code released for academic AND commercial use, but "both manual-downloading and auto-downloading models... are for non-commercial research purposes." Exactly the code/weights split you warned about. Also ~43 min to render 31 s on a V100; not real-time by any reading.
10. Sonic (Tencent) — CC BY-NC-SA-4.0, explicitly non-commercial, tested on a 32 GB GPU.
11. FLOAT (DeepBrain AI) — CC BY-NC-ND 4.0, "may not use this work for commercial purposes and may use it only for research purposes". NC AND ND.
12. Ultralight-Digital-Human — NO LICENCE AT ALL. GitHub API returns `license: null` and there is no LICENSE file in the repo root, despite an Apache-2.0 badge in the README. Default copyright = all rights reserved. Tempting (trains per-identity from 3-5 min of video, claims <10 ms per frame on a 2080, runs on mobile) and actively maintained, which makes it more dangerous, not less.
13. Hallo2 high-res path — the main repo is MIT and its HF weights are `mit`, but the high-resolution module is modified CodeFormer under S-Lab License 1.0, which is non-commercial. Using Hallo2 at high res drags an NC licence in.
14. Hallo3 — MIT code, but weights are a CogVideoX-5B-I2V derivative and the README says you must comply with CogVideoX's terms. Tested on H100. Not a solo-founder option regardless.
15. LivePortrait / JoyVASA — both MIT (code and HF weights), but LivePortrait's own LICENSE warns that InsightFace's models are non-commercial and must be removed and replaced for commercial use. JoyVASA inherits this. Also LivePortrait is video-driven, not audio-driven, so it does not solve lip-sync from speech on its own.

=== TIER D: NOT REAL-TIME AT ALL (these belong to the RECORDED half, not the live half) ===

16. LatentSync 1.5/1.6 (ByteDance) — code Apache-2.0, WEIGHTS `openrail++` on HF (a genuine code/weights divergence, though openrail++ still permits commercial use). 8 GB VRAM (1.5) / 18 GB (1.6). Whole video file + whole audio file in. Multi-step diffusion. Best-in-class offline quality; useless for live.
17. SadTalker — Apache-2.0, non-commercial restriction explicitly removed. Single photo + WAV. Offline.
18. AniPortrait — Apache-2.0 code. Offline diffusion.
19. EchoMimic v1/v2/v3 — code Apache-2.0 on all three, but the HF weight cards carry NO licence metadata at all, so the weights licence is UNESTABLISHED. v2: ~7 min for 120 frames, ~50 s accelerated on an A100. v3 is 1.3B and runs in 12-16 GB. Offline.
20. Hallo / Hallo2 — MIT code, `mit` weights. Offline, A100-class.
21. Real3D-Portrait — MIT code; checkpoints on Google Drive/BaiduYun with NO licence attached. UNESTABLISHED weights licence.
22. VideoReTalking — Apache-2.0. Offline.
23. Hallo-Live (arXiv, 26 Apr 2026) — the state of the art in streaming avatars as of now: 0.94 s latency, 20.38 FPS, on TWO H200s. No code, no weights. Included only as the ceiling marker: this is what "research-grade real-time photoreal" costs, and it is 20 FPS on ~$60k of silicon.

## RECOMMENDATION
DIRECT ANSWER TO THE QUESTION ASKED: On a solo founder's own machine with no high-end GPU, or on a CPU-only cloud box, real-time open-source PHOTOREAL lip sync is NOT achievable today. Every model that produces photoreal video at 25+ FPS needs a modern NVIDIA GPU. There is no exception. Anyone claiming CPU photoreal real-time is either selling a closed SDK (bithuman) or is not photoreal (LiteAvatar).

But the answer is no longer "no" outright, and that changed in February 2026. SoulX-FlashHead Lite is Apache-2.0 in BOTH code and weights, built on an Apache-2.0 base (Wan2.1-1.3B), and its own README claims 96 FPS on ONE RTX 4090 — with 3 concurrent real-time streams from that single card. Before this, the honest floor was Ditto at RTF 0.895 on an A100. FlashHead moves the floor from a $1.39/hr datacentre card to a $0.34/hr consumer card with 4x headroom. That is the single most important fact in this research.

WHAT I RECOMMEND, IN ORDER:

STEP 1 — Split the problem, exactly as you already saw. Do not let one model serve both halves. The recorded lesson avatar should be rendered offline once per lesson with LatentSync 1.5 (Apache-2.0 code, openrail++ weights, 8 GB VRAM, best quality of anything here) on a rented 4090 for a few rupees per lesson, and shipped as an MP4 from your CDN. That half is solved and costs almost nothing. Everything below is only about the live doubt.

STEP 2 — Ship the live doubt with NO avatar first. Gemini Live voice, the paused lesson frame held on screen, a waveform or a simple animated indicator. This costs zero, has zero new failure modes, and lets you find out whether Class 6-12 students actually care about a face during a 90-second doubt. My honest read: they care far less than adults assume — the value is that someone answered, not that a face moved. Do not spend a month on lip-sync before you know this.

STEP 3 — If you want a face and want it free, use met4citizen/TalkingHead (MIT). A stylised 3D tutor avatar lip-syncs in the student's own browser off your Gemini TTS timings. Marginal cost per minute: zero. No GPU, no server, no per-minute vendor. For a tutor persona aimed at Class 6-12, a consistent friendly stylised character is arguably a BETTER product decision than a photoreal face that will land in the uncanny valley on a ₹8,000 Android phone over a 4G connection. This is also the only option here that survives you having 500 concurrent students without a bill.

STEP 4 — If it must be photoreal, the cheapest path that actually works: one rented RTX 4090 running SoulX-FlashHead Lite, kept warm during class hours, fronted by a LiveKit custom avatar worker you write against LiveKit's Python AvatarRunner.
- Cost: $0.34/hr on RunPod community cloud, $0.13-0.44/hr on Vast.ai. A 7-hour school day is about $2.40 on RunPod, roughly ₹210/day, ~₹6,300/month. One card serves 3 simultaneous doubt sessions at 25+ FPS.
- You cannot spin the box up per doubt — model load on a 1.3B video model is minutes, and the student is waiting. Budget for a warm box across your teaching window, not per-minute billing.
- The work you must do yourself: there is NO LiveKit plugin for FlashHead and none for Ditto. LiveKit closed its own "self-implemented avatars" issue as not planned, and the only avatar example in their repo calls a paid vendor. You get `AvatarRunner` + `DataStreamAudioOutput` and that is it. Budget a week, and prototype against OpenAvatarChat (Apache-2.0) first, since it already lists FlashHead as a backend and already does WebRTC.
- Risk: FlashHead is six months old. The 96 FPS number is the project's own claim, VRAM is undocumented, and nobody has published a live-conversation deployment. Verify on a $0.34/hr box for one hour before you build anything on it.

STEP 5 — The lower-risk photoreal alternative if FlashHead disappoints: MuseTalk 1.5 driven by LiveTalking (both usable commercially; LiveTalking is Apache-2.0 and measured 72 FPS for MuseTalk on a 4090, with WebRTC already wired). Less impressive than FlashHead — it inpaints the mouth of a looping video rather than generating from a photo — but it is the most battle-tested self-hosted real-time stack in existence and it exists TODAY with the plumbing done. Two caveats: MuseTalk's weights are creativeml-openrail-m, so you inherit use-based restrictions you must pass downstream; and LiveTalking's README asks for a watermark on videos published to Chinese platforms, which is an extra condition beyond its Apache-2.0 file — ask the maintainer or ignore that distribution channel.

STEP 6 — If you refuse to run a GPU at all, the cheapest thing that IS achievable: bithuman self-hosted Essence 1 at about $0.60-0.67 per live hour ($1 = 100 credits, 1 credit/min self-hosted; or Creator at $20/mo = 30 hours). It runs on ordinary CPU, hits 25 FPS, streams audio via push_audio, and has a maintained first-party LiveKit plugin — the one avatar plugin in LiveKit's table that is neither deprecated nor GPU-bound. It is NOT open source: closed Cython runtime, mandatory API secret, and no Windows wheels (Linux or Apple Silicon only). At ~$0.65/hr it is roughly TWICE the cost of renting your own 4090 and running Apache-2.0 weights, so it only makes sense if your time is worth more than the delta — which, for a solo founder, it very well might be for the first three months.

WHAT NOT TO DO: Do not build on Wav2Lip, V-Express, Sonic, or FLOAT — all four ship non-commercial weights and every one of them will surface in a due-diligence review. Do not touch Ultralight-Digital-Human despite how perfect it looks on paper: it has no LICENSE file at all, which is worse than a restrictive licence. Avoid Hallo2's high-res path (S-Lab NC) and Hallo3 (CogVideoX terms). If you use LivePortrait or JoyVASA, you must strip and replace InsightFace's detection models — their own LICENSE file says so in writing. And treat EchoMimic v1/v2 and Real3D-Portrait as unusable until someone attaches a licence to the checkpoints: Apache-2.0 code with unlicensed weights gives you nothing.

## SOURCES
- https://github.com/Soul-AILab/SoulX-FlashHead
- https://huggingface.co/Soul-AILab/SoulX-FlashHead-1_3B
- https://arxiv.org/abs/2602.07449
- https://arxiv.org/html/2602.07449v2
- https://soul-ailab.github.io/soulx-flashhead/
- https://api.github.com/repos/Soul-AILab/SoulX-FlashHead/license
- https://huggingface.co/Wan-AI/Wan2.1-T2V-1.3B
- https://github.com/antgroup/ditto-talkinghead
- https://huggingface.co/digital-avatar/ditto-talkinghead
- https://huggingface.co/digital-avatar/ditto-talkinghead/raw/main/LICENSE
- https://arxiv.org/abs/2411.19509
- https://arxiv.org/html/2411.19509v1
- https://github.com/TMElyralab/MuseTalk/blob/main/README.md
- https://huggingface.co/TMElyralab/MuseTalk
- https://huggingface.co/TMElyralab/MuseTalk/raw/main/README.md
- https://huggingface.co/spaces/CompVis/stable-diffusion-license/raw/main/license.txt
- https://github.com/bytedance/LatentSync
- https://raw.githubusercontent.com/bytedance/LatentSync/main/LICENSE
- https://huggingface.co/ByteDance/LatentSync-1.5
- https://huggingface.co/ByteDance/LatentSync-1.6
- https://github.com/KwaiVGI/LivePortrait/blob/main/LICENSE
- https://huggingface.co/KwaiVGI/LivePortrait
- https://raw.githubusercontent.com/Rudrabha/Wav2Lip/master/README.md
- https://raw.githubusercontent.com/OpenTalker/SadTalker/main/README.md
- https://github.com/tencent-ailab/V-Express
- https://github.com/jixiaozhong/Sonic
- https://github.com/deepbrainai-research/float
- https://api.github.com/repos/antgroup/echomimic_v3/license
- https://api.github.com/repos/antgroup/echomimic_v2/license
- https://api.github.com/repos/BadToBest/EchoMimic/license
- https://huggingface.co/BadToBest/EchoMimicV2
- https://huggingface.co/BadToBest/EchoMimic
- https://api.github.com/repos/fudan-generative-vision/hallo/license
- https://api.github.com/repos/fudan-generative-vision/hallo2/license
- https://huggingface.co/fudan-generative-ai/hallo2
- https://github.com/fudan-generative-vision/hallo3
- https://api.github.com/repos/Zejun-Yang/AniPortrait/license
- https://api.github.com/repos/jdh-algo/JoyVASA/license
- https://huggingface.co/jdh-algo/JoyVASA
- https://api.github.com/repos/yerfor/Real3DPortrait/license
- https://api.github.com/repos/OpenTalker/video-retalking/license
- https://api.github.com/repos/anliyuan/Ultralight-Digital-Human
- https://api.github.com/repos/anliyuan/Ultralight-Digital-Human/contents/
- https://github.com/lipku/LiveTalking
- https://raw.githubusercontent.com/lipku/LiveTalking/main/README.md
- https://github.com/HumanAIGC/lite-avatar
- https://api.github.com/repos/HumanAIGC/lite-avatar/license
- https://github.com/HumanAIGC-Engineering/OpenAvatarChat/blob/main/readme_en.md
- https://api.github.com/repos/HumanAIGC-Engineering/OpenAvatarChat/license
- https://github.com/bithuman-product/bithuman-sdk-public
- https://docs.bithuman.ai/guides/pricing/
- https://www.bithuman.ai/pricing
- https://docs.livekit.io/agents/models/avatar/
- https://docs.livekit.io/agents/models/avatar/plugins/bithuman/
- https://docs.livekit.io/agents/integrations/avatar/
- https://github.com/livekit/agents/issues/3216
- https://github.com/livekit/agents/tree/main/examples
- https://github.com/NVIDIA/Audio2Face-3D
- https://huggingface.co/nvidia/Audio2Face-3D-v3.0
- https://api.github.com/repos/met4citizen/TalkingHead/license
- https://github.com/met4citizen/TalkingHead
- https://arxiv.org/abs/2604.23632
- https://www.runpod.io/product/cloud-gpus
- https://vast.ai/pricing/gpu/RTX-4090