# OFFLINE / PRE-RENDERED open-source talking heads for the RECORDED class (quality matters, speed does not) — licence-first triage, real render costs on rented GPUs, identity stability across many lessons, and the still-photo vs source-video question including Indian consent/likeness obligations.

## VERIFIED
VERIFIED FROM PRIMARY SOURCES (licence files, model-card metadata, requirements.txt, actual source code, maintainer comments in the projects' own issue trackers):

LICENCE TRAPS I CONFIRMED BY READING THE FILES
- InsightFace, verbatim from deepinsight/insightface/python-package/README.md: "The code of InsightFace Python Library is released under the MIT License. There is no limitation for both academic and commercial usage." / "**The pretrained models we provided with this library are available for non-commercial research purposes only, including both auto-downloading models and manual-downloading models.**" This single sentence kills or wounds four of the most-recommended repos.
- CodeFormer LICENSE = S-Lab License 1.0: "Redistribution and use for non-commercial purpose... In the event that redistribution and/or use for commercial purpose... is required, please contact the contributor(s)."
- Wav2Lip: repo states personal/research/non-commercial only, because it is trained on LRS2.
- Sonic LICENSE file = CC BY-NC-SA 4.0; README 2025/02/06 entry: "our license is non-commercial. If commercialization is required, please use Tencent Cloud Video Creation Large Model."

PER-PROJECT, CODE vs WEIGHTS, CHECKED SEPARATELY
- Hallo2 — code MIT (github LICENSE file is stock MIT, not S-Lab as several blogs claim), HF card metadata `license: mit`. BUT: requirements.txt pins `insightface==0.7.3`; `hallo/datasets/image_processor.py` line 15 does `from insightface.app import FaceAnalysis` and line 124 calls `self.face_analysis.get(...)` on the reference image — so the non-commercial InsightFace models are in the INFERENCE path, not just training. The HF weight repo itself redistributes `face_analysis/models/{glintr100,scrfd_10g_bnkps,1k3d68,2d106det,genderage}.onnx` plus `CodeFormer/codeformer.pth` (S-Lab, non-commercial) for the 4K stage, plus `audio_separator/Kim_Vocal_2.onnx` (licence unestablished). The declared MIT covers Fudan's own trained UNet/motion/audio-proj weights only.
- Hallo3 — code MIT, HF card `license: mit`, but README §280-282: "This model is a fine-tuned derivative version based on the CogVideo-5B I2V model... use, distribution, and modification of this model must comply with the license terms of CogVideo-5B." CogVideoX-5b LICENSE: free commercial use only AFTER registering at open.bigmodel.cn, capped at 1 million visits/month, governed by PRC law, Haidian District court. Bundle also ships `face_analysis/models/buffalo_l.zip` (InsightFace, non-commercial). Tested GPU: H100.
- MEMO — code and HF card both Apache-2.0, but pyproject.toml pins `insightface==0.7.3` and the HF repo redistributes the same five InsightFace .onnx files. Apache label, non-commercial contents.
- LatentSync — code Apache-2.0; weights are NOT Apache: HF cards ByteDance/LatentSync-1.5 and ByteDance/LatentSync-1.6 both declare `license: openrail++` (commercial permitted, but with behavioural use restrictions you must pass downstream). requirements pins `insightface==0.7.3` and `latentsync/utils/face_detector.py` calls InsightFace `FaceAnalysis.get()` at inference.
- MuseTalk — the only fully clean stack I found. LICENSE = MIT plus an explicit third-party appendix listing sd-vae-ft-mse (MIT), whisper (MIT), face-parsing.PyTorch (MIT), DWPose (Apache-2.0), face-alignment (BSD-3-Clause), S3FD. No InsightFace anywhere. README §Disclaimer/License: "code: ...MIT License. There is no limitation for both academic and commercial usage." / "model: The trained model are available for any purpose, even commercially."
- EchoMimicV3 — README §License and HF card both Apache-2.0. Base model Wan2.1-Fun-V1.1-1.3B-InP is Apache-2.0 (confirmed on its own HF card); audio encoder facebook/wav2vec2-base-960h is Apache-2.0. No insightface in requirements.txt. Genuinely clean.
- SadTalker — LICENSE is stock Apache 2.0 under a Tencent header; README changelog: "The license has been updated to Apache 2.0, and we've removed the non-commercial restriction." BUT its README checkpoint table still lists `checkpoints/wav2lip.pth` (non-commercial) and `checkpoints/BFM` (Basel Face Model, academic-only), while the current `scripts/download_models.sh` fetches only the v0.0.2 safetensors + facexlib + GFPGANv1.4.
- Wan2.2-S2V-14B and Wan2.2-TI2V-5B: Apache-2.0 code and weights. InfiniteTalk: Apache-2.0. HuMo (1.7B/17B): Apache-2.0 code and weights. OmniAvatar-14B: Apache-2.0. AniPortrait: Apache-2.0 code and weights. FantasyTalking: Apache-2.0 code and weights.
- FantasyTalking2: NO LICENSE FILE in the repo at all (raw LICENSE returns 404) — licence unstated, treat as unusable until they add one.
- EchoMimicV2: GitHub reports Apache-2.0 for the repo, but the README has no licence section and the HF weights repo has no licence tag — weights licence unstated.
- HunyuanVideo-Avatar: GitHub licence = NOASSERTION → Tencent Hunyuan Community License. Commercial allowed, but the licensed territory EXCLUDES the EU, UK and South Korea, and >100M MAU requires a separate licence. Fine for an India-first product; a landmine if he ever sells into Europe.
- Enhancers: GFPGAN = Apache 2.0 (README §License: "GFPGAN is released under Apache License Version 2.0"). Real-ESRGAN = BSD-3-Clause. Both safe; CodeFormer is not.

REAL TIMING NUMBERS, FROM THE PROJECTS THEMSELVES
- MuseTalk README: "real-time high quality lip-syncing model (30fps+ on an NVIDIA Tesla V100)"; "size of face region of 256 x 256"; minimum-hardware test: RTX 3050 Ti Laptop 4GB, fp16, 8-second video ≈ 5 minutes. Realtime mode has an explicit `preparation: True` (once per avatar) / `preparation: False` (every later render) flag — the middle path is a first-class supported feature, not a hack.
- EchoMimicV3, repo issue #16, user report CONFIRMED BY THE MAINTAINER (mengrang: "your cost time is also really correct for 10s length"): 10 s of audio, talking head, num_inference_steps=5 → 3 minutes, 43,434 MiB VRAM, and both parties describe the lip quality at 5 steps as bad. Half-body: 12 min, 63,248 MiB. Maintainer: "Num_inference_steps set as 5 for faster inference, but 25 for better results." README: 12G VRAM (quantised build), up to 768×768, hard limit 138 frames per pass.
- Hallo2, repo issue #15, community report: RTX 4070 16GB ≈ "1mn per second of audio, so 10s takes 10mn". The paper publishes no inference time (issue #31 complains about exactly this).
- LatentSync: min VRAM 8GB (v1.5) / 18GB (v1.6); v1.6 trained at 512×512 specifically "to mitigate the blurriness problem". Replicate's hosted bytedance/latentsync: "Predictions typically complete within 104 seconds", "runs on Nvidia L40S", "approximately $0.10 to run".
- Wan2.2-TI2V-5B HF card: "5-second 720P video in under 9 minutes on a single consumer-grade GPU" (RTX 4090).
- Wan2.2-S2V-14B HF card: at least 80GB VRAM for single-GPU inference; 480P and 720P.
- HuMo README: 1.7B "generate a 480P video in 8 minutes on a 32G GPU"; trained on 97-frame clips at 25 fps, degrades beyond.
- InfiniteTalk README concedes: colour shift becomes pronounced past one minute and ID preservation degrades.
- RunPod public pricing page, fetched today: RTX 4090 $0.34/hr community / $0.74 secure; RTX 5090 $0.69/$0.99; L40S $0.79/$0.99; A100 PCIe 80GB $1.19/$1.39; H100 PCIe 80GB $1.99/$2.89; H200 $3.59/$4.59.

INDIAN LAW, VERIFIED
- IT Amendment Rules 2026, G.S.R. 120(E), notified 10 Feb 2026, in force 20 Feb 2026. Creates "synthetically generated information" (audio/visual content algorithmically created or altered to appear authentic; excludes text). Must be "clearly and prominently labelled" with embedded provenance metadata. The draft's fixed 10%-of-screen label requirement did NOT survive into the final rules. Obligations attach to intermediaries, heaviest on SSMIs (5M+ Indian users); a company publishing its own content on its own app is a publisher, not an intermediary, so the strictest duties likely do not attach.
- DPDP Rules 2025 notified 14 Nov 2025. Data Protection Board effective immediately (13 Nov 2025); consent-manager provisions 13 Nov 2026; all other substantive obligations 13 May 2027. A face is personal data; consent must be free, specific, informed, unconditional, by clear affirmative action, and is withdrawable.
- Personality/publicity rights in India are NOT codified — they are enforced case-by-case (Delhi HC restrained unauthorised use of an actor's name, image, voice, gesture and AI-generated look-alike in Simply Life India, 2023).

INFERRED, NOT VERIFIED — flagging honestly:
- Hallo2's speed on a rented datacentre GPU. I scaled a single community comment (4070 ≈ 60× realtime) by an assumed 3–4× A100 speedup. LOW confidence; no official number exists.
- Wan2.2-S2V per-minute cost. Extrapolated from third-party Wan-14B text-to-video benchmarks (~4 min per 5 s of 480p on H100 PCIe), not from an official S2V figure. MEDIUM-LOW confidence.
- MuseTalk throughput on a 4090. Extrapolated from the official V100 figure; the error direction is favourable (a 4090 is faster than a V100). MEDIUM confidence.
- Whether SadTalker v0.0.2's safetensors still embed BFM-derived 3DMM bases. The README's checkpoint table lists checkpoints/BFM; the v0.0.2 download script does not fetch it. UNRESOLVED — I could not determine this and will not guess.
- `chinese-wav2vec2-base` (TencentGameMate, ModelScope), required only by EchoMimicV3-**Flash** — licence not established. The `preview` variant uses Apache-2.0 wav2vec2-base-960h instead, so prefer preview if this matters.
- `Kim_Vocal_2.onnx` (UVR MDX vocal separator), shipped inside Hallo2/Hallo3/MEMO — licence not established.
- Whether GFPGAN's FFHQ-derived training data creates a downstream restriction. GFPGAN declares Apache 2.0; FFHQ-as-a-dataset is CC BY-NC-SA 4.0. Grey area, widely used commercially, but I did not verify a clean chain.
- "Wan 2.5 is Apache 2.0 open weights" appears on several aggregator blogs. I could not resolve a Wan-Video/Wan2.5 GitHub repo or a Wan-AI/Wan2.5-* HF weights repo. Treat as marketing hype until weights actually appear.

## OPTIONS
Ranked for THIS product (one render per lesson, done once at authoring time, commercial Indian edtech, solo founder, no GPU).

═══ TIER 1 — USE THIS ═══

1) MuseTalk 1.5 (TMElyralab / Tencent Music) — mouth-region inpainting on a driving video
- Licence CODE: MIT (LICENSE file), with an explicit third-party appendix: sd-vae-ft-mse MIT, whisper MIT, face-parsing.PyTorch MIT, DWPose Apache-2.0, face-alignment BSD-3-Clause, S3FD (licence not named in the appendix — the only gap).
- Licence WEIGHTS: README states "The trained model are available for any purpose, even commercially." HF card metadata declares `creativeml-openrail-m`. These disagree in form but agree in substance: both permit commercial use. CreativeML OpenRAIL-M adds behavioural use restrictions you must pass downstream in your ToS.
- COMMERCIAL: YES. This is the only candidate with no non-commercial component anywhere in the dependency graph. No InsightFace, no CodeFormer, no Wav2Lip, no BFM.
- Hardware: runs on 4GB. Officially tested down to an RTX 3050 Ti Laptop.
- Latency: 30fps+ on a V100 (official) — i.e. FASTER than realtime. 8s video in ~5 min on a 4GB laptop GPU in fp16 (official). On a rented 4090 a 3-minute lesson is minutes, not hours.
- Quality: face region is 256×256 natively. The README names this as its top limitation and recommends GFPGAN (Apache-2.0) for super-resolution. CRITICAL FRAMING: only the mouth patch is 256-native — the rest of the frame stays at whatever resolution your source loop is. On a 6-inch phone with the tutor rendered ~360px wide, 256 is at or above display resolution. On a 4K TV it would be visible. For a mobile-first app this is a non-issue.
- Driven by: audio + a SOURCE VIDEO (or a still, but a still gives a dead, motionless face).
- Identity stability across renders: PERFECT, by construction. It regenerates only the mouth region of frames you supply. Lesson 3 and lesson 40 are literally the same person because they are literally the same pixels everywhere except the lips.
- Cost per 3-min lesson: ~5–10 min on a RunPod 4090 community at $0.34/hr = $0.03–$0.06 (₹2.5–₹5), including an optional GFPGAN pass. Avatar preparation is a one-time step (`preparation: True`), then every later lesson runs with `preparation: False` against the cached avatar.
- Bonus: it is real-time capable, so the SAME avatar and the SAME prepared cache can drive the live doubt agent. One avatar system, both halves of the product, same face.

2) Wan2.2-TI2V-5B (Alibaba) — NOT a talking head; the one-time idle-loop generator
- Licence CODE + WEIGHTS: Apache-2.0, both. Clean.
- COMMERCIAL: YES, unrestricted.
- Hardware: single RTX 4090 (24GB) with --offload_model True.
- Latency: "5-second 720P video in under 9 minutes" on a 4090 (official HF card).
- Driven by: a still image + text prompt. This is how you turn a generated tutor PORTRAIT into the idle/listening LOOP that MuseTalk then drives forever.
- Cost: ~$0.05 per 5s candidate on a 4090 at $0.34/hr. Generate 12 candidates, pick one: ~$0.61, ONCE, for the lifetime of the product.

═══ TIER 2 — VIABLE, WITH WORK OR WITH REAL COST ═══

3) LatentSync 1.6 (ByteDance) — the 512px upgrade path if 256 ever looks soft
- Licence CODE: Apache-2.0. Licence WEIGHTS: **openrail++** (HF cards for 1.5 and 1.6). Different from the code licence — this is exactly the trap the brief warned about.
- COMMERCIAL: YES under OpenRAIL++, but it is a use-restricted licence: you must carry Attachment A's behavioural restrictions into your own terms and pass them to downstream users.
- BLOCKER TO FIX FIRST: `requirements.txt` pins `insightface==0.7.3` and `latentsync/utils/face_detector.py` calls InsightFace's FaceAnalysis at inference. InsightFace's pretrained models are non-commercial research only. It is used ONLY as a face detector/aligner here, so it is swappable for MediaPipe (Apache-2.0) or facexlib RetinaFace — but that is real engineering work you must do and verify before shipping.
- Hardware: 8GB VRAM (v1.5), 18GB (v1.6).
- Latency: ~104s typical on an L40S per Replicate's hosted page, ~$0.10/run there. Self-hosted on a RunPod L40S at $0.79/hr that is ~$0.02 of GPU time per run.
- Quality: 512×512, released specifically to fix v1.5's blurriness. Better mouth detail than MuseTalk.
- Driven by: audio + a SOURCE VIDEO. Not a still.
- Identity stability: same as MuseTalk — perfect, because it edits your frames.

4) EchoMimicV3 (Ant Group, AAAI 2026) — the best-licensed still-photo-to-video model
- Licence CODE + WEIGHTS: Apache-2.0, both, stated in README §License and on the HF card. Base Wan2.1-Fun-V1.1-1.3B-InP Apache-2.0. wav2vec2-base-960h Apache-2.0. NO InsightFace. This is the cleanest full-generation stack available.
- COMMERCIAL: YES, unrestricted. ("We claim no rights over the your generated contents.")
- Caveat: the **Flash** variant needs TencentGameMate/chinese-wav2vec2-base whose licence I could not establish. The **preview** variant uses Apache-2.0 wav2vec2-base-960h. Prefer preview.
- Hardware: 43GB peak for a talking head at native settings (so A100/H100 80GB), or 12–16GB with the quantised app_mm.py / ComfyUI builds.
- Latency (maintainer-confirmed): 10s of talking-head audio at 5 steps = 3 minutes on the reporter's card. Maintainer says use 25 steps for acceptable quality → roughly 5× that.
- Quality: up to 768×768. Genuinely good when you give it 25 steps and a text prompt; both the reporter and maintainer agree 5 steps and no-prompt produce bad lips.
- Driven by: still photo + audio (+ optional mask, + text prompt).
- Identity stability: POOR across renders and even WITHIN one lesson. Hard 138-frame limit per pass (~5.5s at 25fps) means a 3-minute lesson is ~33 chunks stitched together. Same photo + same seed gets you close, not identical. This is the "face subtly changes between lesson 3 and lesson 4" failure mode the brief specifically warns about.
- Cost per 3-min lesson on a RunPod A100 at $1.19/hr: ~$1.07 at 5 steps (unusable lips), ~$4.20–$5.40 at 25 steps. With one or two authoring retries, budget $10–$16 per lesson. That is 200–500× the MuseTalk path.

═══ TIER 3 — LICENCE-BLOCKED OR ECONOMICALLY DEAD ═══

5) Hallo2 (Fudan, ICLR 2025) — code MIT, weights card MIT, BUT NOT COMMERCIALLY USABLE AS SHIPPED
- InsightFace models are in the inference path (`image_processor.py` imports and calls FaceAnalysis) → non-commercial research only. CodeFormer (S-Lab 1.0, non-commercial) powers the 4K/HD stage → that stage is simply off-limits, which removes Hallo2's headline feature. Also bundles Kim_Vocal_2.onnx (licence unestablished) and SD1.5 (CreativeML OpenRAIL-M).
- The declared MIT covers Fudan's own trained weights only. Do not read the model-card badge as clearance for the bundle.
- Hardware: ~13GB VRAM minimum; A100 tested; 4K/1hr+ capability is the licence-blocked stage.
- Latency: ~1 minute of compute per second of audio on a 16GB RTX 4070 (community report; no official figure). Scaled to an A100, I estimate 45–75 min per 3-min lesson ≈ $0.90–$1.50 — LOW confidence.
- Driven by: still photo. Requires a square image, face 50–70% of frame, rotation <30°, clear English WAV.
- Identity stability: chunked long-form generation; drift is expected.
- Verdict: to use this commercially you would have to rip out InsightFace, abandon the HD stage, and resolve the vocal-separator licence. Not worth it when EchoMimicV3 is Apache-2.0 and newer.

6) Hallo3 (Fudan) — code MIT, weights card MIT, but the README itself says CogVideoX-5B's licence governs
- CogVideoX-5B: free commercial use only after registering on a Chinese government-adjacent portal, capped at 1M visits/month, PRC law, Beijing jurisdiction. Plus it ships buffalo_l.zip (InsightFace, non-commercial). Tested GPU: H100.
- Verdict: a registration obligation and a traffic cap on a Chinese licence is not something a solo Indian founder should build a product on. Dead.

7) Sonic (Tencent) — DEAD. LICENSE file is CC BY-NC-SA 4.0 and the README says so plainly: "our license is non-commercial." Beautiful output, legally unusable. Their own suggested path is paid Tencent Cloud.

8) MEMO — code Apache-2.0, HF card Apache-2.0, but the HF repo REDISTRIBUTES the five InsightFace .onnx models and pyproject pins insightface==0.7.3. Apache label over non-commercial contents. Fix the detector or don't use it.

9) SadTalker — code Apache-2.0, non-commercial restriction explicitly removed by the authors. But the README checkpoint table still lists `wav2lip.pth` (LRS2, non-commercial) and `checkpoints/BFM` (Basel Face Model, academic-only). The v0.0.2 download script fetches neither. I COULD NOT DETERMINE whether the v0.0.2 safetensors embed BFM-derived 3DMM bases — this is unresolved and I will not assume. Separately: quality is 2023-era, 256/512 face render, visibly worse than everything above. Not recommended on quality grounds regardless of the licence question.

10) AniPortrait — Apache-2.0 code AND Apache-2.0 weights, genuinely clean. But it is a 2024 SD1.5-based pipeline, superseded on quality by EchoMimicV3 and everything Wan-based. No reason to pick it.

11) FantasyTalking — Apache-2.0 code and weights, clean. FantasyTalking2 (AAAI 2026) has NO LICENCE FILE AT ALL — unstated, unusable until they add one.

12) Wan2.2-S2V-14B — Apache-2.0 code and weights, best-in-class open quality, worst economics: ≥80GB VRAM on a single GPU. Extrapolating from Wan-14B benchmarks (~4 min per 5s of 480p on an H100 PCIe), a 3-min lesson is ~2.4 h on an H100 = ~$4.80 at 480p, roughly $10–$15 at 720p. Still chunked, so still drifts. MEDIUM-LOW confidence on the timing.

13) InfiniteTalk (MeiGen-AI) — Apache-2.0 code and weights, supports both image-to-video and video-to-video dubbing, "unlimited length" via streaming. Its own README concedes colour shift past one minute and reduced ID preservation. Built on Wan2.1-I2V-14B, so the same 80GB-class cost profile.

14) HuMo (ByteDance) — Apache-2.0 code and weights. HuMo-1.7B: "generate a 480P video in 8 minutes on a 32G GPU", trained on 97-frame clips (3.9s) and degrades beyond. That is ~46 chunks and ~6 hours of GPU for one 3-minute lesson ≈ $4.20 on an RTX 5090, at 480p, with 46 seams. Out on cost and seams.

15) OmniAvatar-14B — Apache-2.0 code and weights, but 14B/Wan2.1-based; same 80GB-class economics as above. Last pushed Aug 2025.

16) HunyuanVideo-Avatar (Tencent) — Tencent Hunyuan Community License. Commercial permitted, but the licensed territory EXCLUDES the EU, UK and South Korea, and >100M MAU needs a separate licence. Fine for India today; a structural ceiling if the product ever travels.

═══ THE PRAGMATIC MIDDLE PATH — ANSWERED DIRECTLY ═══
"A single looping video of a listening/idle tutor, with only the mouth region driven per lesson — is that meaningfully cheaper or more stable, and does any tool support it?"

YES on all three counts, and it is not a hack — MuseTalk supports it as a documented first-class feature.

- SUPPORTED: MuseTalk's realtime pipeline has an explicit `preparation` flag. README: "Set `preparation` to `True` when processing a new avatar... Set `preparation` to `False` for generating more videos with the same avatar." You prepare the idle loop ONCE (face detection, crops, VAE latents all cached), then every subsequent lesson skips all of that. LatentSync and Wav2Lip work the same way architecturally but without the caching affordance (and Wav2Lip is non-commercial).
- CHEAPER: 200–500× cheaper. $0.03–$0.06 per lesson versus $4–$16 for any photo-to-video model. Across a 96-lesson subject-year: about $5 total, versus roughly $1,150. And when he fixes a typo in a script and re-renders, the MuseTalk path costs him five cents and ten minutes, while the generative path costs him another $12 and an hour — which in practice means he will stop fixing typos.
- MORE STABLE: this is the decisive argument, not the cost one. Every image-to-video model regenerates the entire face from scratch on every run, and all of them chunk (EchoMimicV3 caps at 138 frames, HuMo at 97, Wan-S2V and InfiniteTalk stitch, and InfiniteTalk's own docs admit colour shift and ID loss past a minute). So the face drifts BETWEEN lessons and WITHIN a lesson. Mouth inpainting cannot drift: every pixel outside the mouth is the original loop, byte-identical in lesson 3 and lesson 40. The brief says a tutor whose face changes between lessons is worse than no face at all — mouth-region inpainting is the only approach here that structurally cannot have that failure.
- COST: a seamless loop needs care. Record or generate 20–40s at 25fps (matching MuseTalk's training fps), ping-pong it and crossfade the seam, keep the head roughly frontal and the mouth closed at the loop boundary. One evening of work, once.

═══ STILL PHOTO vs SOURCE VIDEO, AND THE CONSENT QUESTION ═══
- Photo is enough for: SadTalker, Hallo2, Hallo3, EchoMimicV3, Sonic, MEMO, AniPortrait, Wan2.2-S2V, FantasyTalking, HuMo, OmniAvatar.
- Real source VIDEO required for: MuseTalk, LatentSync, Wav2Lip, InfiniteTalk's V2V mode.
- THE BRIDGE that dissolves the dilemma: you do not need a real person to get a source video. Generate the tutor PORTRAIT with the Gemini image model he already has in the repo (the Nano Banana factory), then generate the idle LOOP once with Wan2.2-TI2V-5B (Apache-2.0, <9 min per 5s clip on a 4090). Now he has a source video of a person who does not exist, and the video-driven tools become available to him at photo-driven convenience.

IF HE USES A REAL PERSON (himself, a hired teacher, a model) — commercial Indian edtech obligations:
- DPDP Act 2023 + DPDP Rules 2025 (notified 14 Nov 2025): a face is personal data. Consent must be free, specific, informed, unconditional, by clear affirmative action, with an itemised notice. Substantive obligations bite 13 May 2027; the Data Protection Board is already live. Crucially, DPDP consent is WITHDRAWABLE — a tutor who withdraws consent after 200 lessons are shot is a business-ending event. Structure the likeness grant as a separate irrevocable contractual licence, not as data-protection consent, and take both.
- Personality/publicity rights are NOT codified in India — they are enforced case-by-case, and the Delhi High Court has already restrained unauthorised use of a person's name, image, voice, gesture AND AI-generated look-alike (Simply Life India, 2023). So you need an explicit written release covering: likeness, voice, name, and specifically synthetic/AI reanimation and performance generation from that likeness; perpetual; worldwide; irrevocable; sublicensable; assignable on a sale of the company; naming the product. A generic model-release form does not cover synthetic reanimation.
- IT Amendment Rules 2026 (G.S.R. 120(E), in force 20 Feb 2026): synthetically generated information must be clearly and prominently labelled with embedded provenance metadata. The strictest duties attach to intermediaries and SSMIs; publishing your own video on your own app makes you a publisher, not an intermediary, so those specific duties likely do not attach. Label anyway — the direction of travel is unmistakable and parents of Class 6–12 students will ask.
- Separately (about students, not the avatar): DPDP requires verifiable parental consent for under-18s and bans tracking and behavioural advertising to children. That is a whole other workstream for this product.

THE CLEAN ESCAPE: a fully synthetic tutor has NO data principal, NO consent to obtain, NO consent to withdraw, NO personality right to infringe, and no renegotiation when the product succeeds. Google's terms give him the rights in Gemini image outputs. He has already built that pipeline. This is the cheapest legal posture available and he is one prompt away from it.

## RECOMMENDATION
Do not pick a talking-head model. Pick an ARCHITECTURE, and the architecture makes the model choice cheap and reversible.

THE PIPELINE — four steps, one of them is one-time.

1. TUTOR IDENTITY (once, ~an hour). Generate one portrait with the Gemini image factory already in the repo. Square, frontal, face 50–70% of frame, neutral closed mouth, even lighting, plain background. No real person means no consent, no personality right, no withdrawal risk, no renegotiation when the product works. Commit the PNG. This file is now the most load-bearing asset in the product — treat it like a logo.

2. IDLE LOOP (once, ~$0.61 and one evening). Rent an RTX 4090 on RunPod at $0.34/hr. Run Wan2.2-TI2V-5B (Apache-2.0 code AND weights) to generate ~12 candidate 5-second 720p clips of the tutor listening, blinking, small nods, mouth closed — under 9 minutes each per Alibaba's own card. Pick the best, build a 20–40s loop at 25fps (MuseTalk's training fps) with a ping-pong and a crossfade at the seam. Commit the mp4. THIS IS THE TUTOR, FOREVER. Every lesson and every live doubt shows these exact pixels.

3. PER LESSON (~5–10 minutes, ~$0.03–$0.06). Pre-rendered Gemini TTS narration → MuseTalk 1.5 with `preparation: False` against the cached avatar → optional GFPGAN pass (Apache-2.0) on the face crop → H.264/AAC → commit the mp4 and serve it. A 96-lesson subject-year costs about $5 of GPU in total. He can re-render the entire course after a script change for the price of a samosa.

4. LIVE DOUBT — same avatar, same cache. MuseTalk claims 30fps+ on a V100, so real time is comfortably in reach on a 4090. The recorded lesson and the live doubt then show the same face because they ARE the same face, driven by the same cached avatar. That is the product's central promise — "the recording pauses and the tutor takes over the same room" — delivered by construction rather than by hoping two different models produce a similar-looking person. (The live half is a separate research area; flagging only that this choice makes both halves one system instead of two.)

WHY MuseTalk AND NOT THE IMPRESSIVE ONES

Licence: it is the only candidate with no non-commercial component anywhere. MIT code, weights explicitly cleared for commercial use, and a third-party appendix that is entirely MIT/Apache-2.0/BSD-3. No InsightFace. No CodeFormer. No Wav2Lip. No BFM. No Chinese registration portal. Every other serious contender has at least one of those, and most of the ones the internet recommends have several while wearing an MIT or Apache badge on the front page.

Identity: mouth inpainting structurally cannot drift. Every generative model here chunks (138 frames for EchoMimicV3, 97 for HuMo) and rebuilds the whole face every run. The brief is right that a tutor whose face changes between lesson 3 and lesson 4 is worse than no face — and this is the only approach where that cannot happen.

Cost: $0.03 versus $4–$16 per lesson. The number matters less than what it enables: at five cents he re-renders freely, which means he actually fixes his scripts.

THE HONEST WEAKNESS, AND WHAT TO DO ABOUT IT
MuseTalk's face region is 256×256. On a 4K display that is visibly soft. On a mobile-first web app where the tutor occupies maybe 360 CSS pixels, it is at or above display resolution — and only the mouth patch is 256-native; the rest of the frame stays at your loop's full 720p. So test this on a real ₹12,000 Android phone before doing anything else. If it looks fine, ship it and never think about this again.

If it does NOT look fine, the upgrade is LatentSync 1.6 (512×512, released specifically to fix blurriness) — but do this work first, in this order: (a) replace its InsightFace face detector with MediaPipe or facexlib RetinaFace, because InsightFace's pretrained models are non-commercial research only and LatentSync calls them at inference; (b) read OpenRAIL++ Attachment A and carry those behavioural restrictions into the product's ToS, because the weights are OpenRAIL++ even though the code is Apache-2.0. Still cents per lesson.

WHAT TO IGNORE, SO HE STOPS EVALUATING IT
- Sonic: CC BY-NC-SA 4.0. Non-commercial. Full stop. Beautiful and useless.
- Hallo2: InsightFace in the inference path and CodeFormer behind the 4K feature. The MIT badge covers Fudan's own weights, not the bundle you actually download.
- Hallo3: inherits CogVideoX-5B — free commercial use requires registering on a Chinese portal and caps you at 1M visits/month under PRC law.
- MEMO: Apache-2.0 label, InsightFace models redistributed inside the weights repo.
- Wav2Lip: non-commercial because of LRS2. This also contaminates the older SadTalker checkpoint bundle.
- FantasyTalking2: no licence file at all.
- Everything 14B-and-up (Wan2.2-S2V, InfiniteTalk, OmniAvatar, HuMo): needs 80GB-class GPUs, costs $4–$15 per lesson, and still drifts. Apache-2.0 does not make an unaffordable model affordable.

ONE PLACE THE EXPENSIVE MODELS EARN THEIR KEEP
EchoMimicV3 is Apache-2.0 clean, top to bottom — the only full-generation model I can say that about without caveats. Use it ONCE for a marketing hero video where the tutor gestures with their hands, at 25 steps and $5-ish. Do not use it for 96 lessons.

WHAT WOULD CHANGE THIS ANSWER
If the 256px mouth reads as soft at the size he actually renders the tutor on a mid-range Android — that is the one experiment worth running this week, and it costs an hour on a $0.34/hr pod. Everything else in this recommendation holds regardless.

## SOURCES
- https://github.com/TMElyralab/MuseTalk
- https://raw.githubusercontent.com/TMElyralab/MuseTalk/main/LICENSE
- https://raw.githubusercontent.com/TMElyralab/MuseTalk/main/README.md
- https://huggingface.co/TMElyralab/MuseTalk
- https://github.com/deepinsight/insightface/blob/master/python-package/README.md
- https://github.com/sczhou/CodeFormer/blob/master/LICENSE
- https://github.com/fudan-generative-vision/hallo2
- https://raw.githubusercontent.com/fudan-generative-vision/hallo2/main/LICENSE
- https://huggingface.co/fudan-generative-ai/hallo2
- https://raw.githubusercontent.com/fudan-generative-vision/hallo2/main/hallo/datasets/image_processor.py
- https://github.com/fudan-generative-vision/hallo2/issues/15
- https://github.com/fudan-generative-vision/hallo3
- https://huggingface.co/THUDM/CogVideoX-5b/blob/main/LICENSE
- https://github.com/antgroup/echomimic_v3
- https://raw.githubusercontent.com/antgroup/echomimic_v3/main/README.md
- https://huggingface.co/BadToBest/EchoMimicV3
- https://github.com/antgroup/echomimic_v3/issues/16
- https://huggingface.co/alibaba-pai/Wan2.1-Fun-V1.1-1.3B-InP
- https://github.com/antgroup/echomimic_v2
- https://github.com/bytedance/LatentSync
- https://huggingface.co/ByteDance/LatentSync-1.6
- https://huggingface.co/ByteDance/LatentSync-1.5
- https://raw.githubusercontent.com/bytedance/LatentSync/main/latentsync/utils/face_detector.py
- https://replicate.com/bytedance/latentsync
- https://github.com/OpenTalker/SadTalker
- https://raw.githubusercontent.com/OpenTalker/SadTalker/main/LICENSE
- https://raw.githubusercontent.com/OpenTalker/SadTalker/main/scripts/download_models.sh
- https://github.com/Rudrabha/Wav2Lip
- https://github.com/jixiaozhong/Sonic
- https://raw.githubusercontent.com/jixiaozhong/Sonic/main/LICENSE
- https://github.com/memoavatar/memo
- https://huggingface.co/memoavatar/memo
- https://github.com/Zejun-Yang/AniPortrait
- https://huggingface.co/ZJYang/AniPortrait
- https://github.com/Fantasy-AMAP/fantasy-talking
- https://huggingface.co/acvlab/FantasyTalking
- https://github.com/Fantasy-AMAP/fantasy-talking2
- https://huggingface.co/Wan-AI/Wan2.2-S2V-14B
- https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B
- https://github.com/Wan-Video/Wan2.2
- https://github.com/MeiGen-AI/InfiniteTalk
- https://github.com/Phantom-video/HuMo
- https://huggingface.co/bytedance-research/HuMo
- https://github.com/Omni-Avatar/OmniAvatar
- https://github.com/Tencent-Hunyuan/HunyuanVideo-Avatar
- https://github.com/TencentARC/GFPGAN
- https://github.com/xinntao/Real-ESRGAN
- https://www.runpod.io/pricing
- https://www.freshfields.com/en/our-thinking/blogs/technology-quotient/india-targets-deepfakes-and-ai-generated-content-key-changes-under-meitys-2026-102mjwn
- https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014
- https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025
- https://www.rfmlr.com/post/digital-doppelg%C3%A4ngers-reconsidering-intellectual-property-and-personality-rights-in-the-age-of-ai-c
- https://www.instasd.com/post/wan2-1-performance-testing-across-gpus