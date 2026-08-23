# The browser-only, zero-infrastructure, zero-marginal-cost stylised animated tutor: a drawn character that lip-syncs in the student's own browser with no server, no GPU, no per-minute fee. Covers (1) where viseme/phoneme timings come from when Gemini TTS returns only raw PCM, (2) the animation runtimes, (3) ready-made open-source avatar components, (4) how the character gets authored for an Indian school tutor.

THE STRUCTURAL POINT THAT DECIDES EVERYTHING: the recorded class and the live doubt are two different problems and must not share a solution.
- Recorded class: audio is finished before any student sees it. The narration TEXT is known. So lip sync is a BUILD-STEP problem. Run a forced aligner once per lesson on a laptop, ship a ~2 KB/minute JSON of {viseme, time, duration} next to the audio. Runtime cost in the browser: reading an array. Zero CPU for analysis, works offline, perfectly in sync, and you can lead the mouth by 40 ms the way real animators do because you can see the future.
- Live doubt: audio arrives as it is spoken. There is no future to see. This must be real-time audio analysis in the browser, and it is inherently reactive, not anticipatory.
An answer that treats these as one problem picks a real-time analyser for both and throws away free accuracy on 95% of the minutes watched.

## VERIFIED
CONFIRMED FROM PRIMARY SOURCE (repo LICENSE files, npm registry metadata, vendor docs, HTTP HEAD on CDN):

Licences read directly from the source: Rive runtime LICENSE = MIT (Rive, 2020). Rhubarb LICENSE.md = MIT (Daniel Wolf), with every third-party dep enumerated as BSD-2/BSD-3/MIT/Boost/WTFPL — no copyleft, no non-commercial. lottie-web, @lottiefiles/dotlottie-web (LottieFiles.com 2023), @pixiv/three-vrm, @met4citizen/talkinghead, wlipsync, wawa-lipsync, rhubarb-lip-sync-wasm, charsiu, charsiu-js = MIT (npm `license` field and/or GitHub licence API). sherpa-onnx and vosk-browser = Apache-2.0. WhisperX = BSD-2-Clause. Echogarden = MIT with GPL eSpeak-NG unbundled since v3.0.0. espeak-ng = GPL-3.0. g2p_en = Apache-2.0.

WEIGHTS licences, checked separately from code as instructed:
- MFA code MIT; English MFA acoustic model v2.2.1 weights CC BY 4.0 — commercial use permitted with attribution. Different licence from the code. CONFIRMED on the model's own doc page.
- facebook/wav2vec2-base-960h weights = apache-2.0, read off the HF model card. This is the aligner WhisperX uses for English.
- torchaudio MMS_FA (the default multilingual forced-alignment bundle everyone reaches for) = CC-BY-NC 4.0. NON-COMMERCIAL. This is the single biggest licence trap in this area and it is the default in most tutorials.
- Kokoro-82M-v1.0-ONNX(-timestamped) = apache-2.0.
- Rhubarb's bundled CMU Sphinx US English acoustic model = 2-clause BSD variant (Alpha Cephei), enumerated in Rhubarb's own LICENSE.md.
- CANNOT ESTABLISH: the charsiu wav2vec2 aligner weights. huggingface.co/charsiu/en_w2v2_fc_10ms has no model card and no licence field. The charsiu code is MIT and charsiu-js is MIT, but the checkpoints those tools download are unlicensed. I am not assuming the weights follow the code. Treat charsiu as unusable commercially until the author states a licence.

Sizes MEASURED, not quoted, by HTTP HEAD against jsDelivr with and without gzip (numbers in the options section).

Vendor terms confirmed on vendor pages: Rive free plan cannot export .riv (rive.app/docs/editor/exporting/exporting-for-runtime states "Exporting for runtime is available on paid plans"); Cadet is $9/seat/mo annual, $17 monthly, unlimited exports, "No runtime fee. Your exports keep working forever." Live2D Cubism Web Framework LICENSE.md states verbatim: "All business users must obtain a Cubism SDK Release License. 'Business' means an entity with the annual gross revenue more than ten million (10,000,000) JPY for the most recent fiscal year." Live2D FREE editor limits read off the official comparison page. Spine runtimes require a Spine Editor licence at time of integration, per Esoteric's own licence text. Gemini-TTS on Cloud TTS docs list output encodings but no SSML mark / enableTimePointing — confirmed absent. Gemini Live outputAudioTranscription streams word-by-word — confirmed in Google's Live API capabilities docs. MFA's model index confirms 20 languages with acoustic models and Hindi is NOT one of them.

MAJOR NEGATIVE FINDING, CONFIRMED: Ready Player Me is dead. Netflix acquired it December 2025; the avatar creator, PlayerZero and the developer APIs were taken offline on 31 January 2026. docs.readyplayer.me no longer resolves DNS. Already-exported GLB files still work because they are plain glTF, but you cannot create new avatars and nothing served from RPM's hosts loads. This invalidates the default pipeline of TalkingHead and most "AI avatar" tutorials written before 2026. TalkingHead's own tracker has an open request (#169, 11 May 2026) to replace RPM as the avatar source. Anyone recommending "Ready Player Me + three.js morph targets" today has not checked.

INFERRED / NOT CONFIRMED, flagged as such:
- The Rive-vs-Lottie Android benchmark (Rive ~60fps vs Lottie 17fps on a Sony Xperia Z3) is third-party, single-device, and not reproducible by me. Treat the direction as real and the magnitude as marketing-adjacent. Rive's own best-practices page is the honest source: it explicitly warns that "poorly optimized animations can consume significant resources and cause poor performance, particularly on low-end devices" and recommends alternative reduced artboards for low-end hardware.
- Duolingo "used Rive in their characters' phonetic lip syncing" comes from third-party write-ups. Rive's own Duolingo case study confirms the State Machine "drives Lily's mouth positions" and that the file stays "under a megabyte", but does NOT disclose whether visemes come from TTS metadata or audio analysis. I did not find a primary statement of their lip-sync source.
- Indian illustration and rigging rates are aggregated from rate guides, not from quotes I obtained. Ranges, not prices.
- I did not benchmark anything on a physical mid-range Android device. Per-frame cost claims below are reasoned from the measured algorithms (FFT size, thread placement, draw calls), not measured.
- rhubarb-lip-sync-wasm self-describes as beta, 30 stars, last pushed Sept 2025. Its accuracy parity with native Rhubarb is unverified by me.

## OPTIONS
═══════════════════════════════════════════════
LAYER 1 — WHERE VISEMES COME FROM WHEN TTS GIVES YOU ONLY PCM
═══════════════════════════════════════════════

This is the actual hard problem. The animation runtime is the easy part.

--- 1A. RHUBARB LIP SYNC (build step) — the strongest single answer for the recorded class ---
Licence: MIT, Daniel Wolf. Weights: the bundled CMU Sphinx US English acoustic model is a 2-clause BSD variant; CMU Flite BSD-like; PocketSphinx/sphinxbase BSD-2. Every dependency is enumerated in LICENSE.md and every one is permissive. Its own text says "you can use Rhubarb Lip Sync in almost any way you want, including the creation of commercial software." (GitHub's licence detector shows NOASSERTION only because LICENSE.md also carries the third-party table — the grant itself is plain MIT.)
Hardware: any laptop. Multi-threaded, defaults to one worker per core. No GPU.
Latency: offline, batch, on a complete file. NOT streamable. Irrelevant for the recorded class, disqualifying for the live doubt.
Quality: purpose-built for exactly this. Outputs the six Hanna-Barbera basic mouth shapes A–F (the de-facto 2D standard used by Disney and Warner Bros) plus three optional extended shapes G (F/V), H (long L), X (idle). Feed it the narration text with `-d dialog.txt` and accuracy jumps, because it biases recognition toward words it expects — and you HAVE the narration text, it is the lesson script. Output tsv / xml / json / dat.
Driven by: `rhubarb -r pocketSphinx -d lesson.txt -f json -o lesson-mouths.json lesson.wav` in the lesson build pipeline. Ship the JSON.
Commercial: yes, unambiguously.
THE CATCH, and it is real: `pocketSphinx` is English only. For Hinglish you fall back to `-r phonetic`, which Rhubarb's own docs describe as language-independent but "usually less precise". A Class 6–12 Indian tutor code-switching mid-sentence is exactly the case that degrades. Mitigation that actually works: the narration is scripted, so keep the script's English spine in the dialog file and accept softer shapes on the Hindi clauses. A stylised cartoon mouth forgives this in a way a photoreal mouth does not — which is itself an argument for the stylised route.

--- 1B. rhubarb-lip-sync-wasm (npm: rhubarb-lip-sync-wasm@0.1.8) ---
Licence: MIT (matches upstream). Weights: same BSD Sphinx model, shipped inside the package.
Size, MEASURED: 41.9 MB unpacked — rhubarb.data 37.00 MB (the acoustic model + 100k-word dictionary), rhubarb.wasm 4.58 MB, rhubarb.js 0.35 MB.
Verdict: absolutely not shippable to an Indian mobile browser. But it removes the need to compile C++ or ship platform binaries — run it under Node in your lesson build step and the whole aligner is an `npm i`. That is its real value for a solo founder on Windows. API takes a 16 kHz PCM buffer plus optional dialogue text, returns mouth cues with start/end/shape. In-memory on complete buffers only; no streaming. Self-described beta, 30 stars, last push Sept 2025 — pin the version.

--- 1C. MONTREAL FORCED ALIGNER (build step, highest accuracy) ---
Licence: code MIT. WEIGHTS: English acoustic model v2.2.1 is CC BY 4.0 — commercial use permitted, attribution REQUIRED (different licence from the code; you owe a credit line).
Hardware: laptop CPU, Python/conda install, Kaldi under the hood. Heavier setup than Rhubarb.
Latency: offline only.
Quality: phone-level boundaries, the gold standard; gives you real ARPABET phones you map to whatever mouth set you drew, not a fixed 9.
Driven by: a Python build step producing TextGrid, then your own phone→viseme table.
Commercial: yes, with attribution.
HARD LIMIT FOR THIS PRODUCT: there is NO Hindi acoustic model. Confirmed against MFA's own model index — the 20 languages are Bulgarian, Croatian, Czech, English, French, German, Hausa, Japanese, Korean, Mandarin, Polish, Portuguese, Russian, Spanish, Swahili, Swedish, Thai, Turkish, Ukrainian, Vietnamese. For a Hinglish tutor this is English-only in practice.

--- 1D. WhisperX (build step) ---
Licence: BSD-2-Clause. WEIGHTS: Whisper is MIT; the English alignment model it uses, facebook/wav2vec2-base-960h, is Apache-2.0 — both fine. Its diarisation models are pyannote and gated with their own terms; you do not need diarisation here, so do not pull it in.
Gives word-level timestamps (~±50 ms) not phones, so you still need a text→viseme rule pass on top (see 1F).
Commercial: yes if you stay off pyannote.

--- 1E. THE MMS_FA TRAP — name it so it gets avoided ---
`torchaudio.pipelines.MMS_FA` is the multilingual forced aligner in every "how to align any language" tutorial, and it is the obvious reach for Hindi. Its weights are CC-BY-NC 4.0. NON-COMMERCIAL. It cannot ship in this product. Same warning for charsiu / charsiu-js (MIT code, weights with no licence stated at all on Hugging Face — cannot establish, so cannot use).

--- 1F. TalkingHead's lipsync-en.mjs — text→visemes with NO model and NO weights ---
Licence: MIT, part of @met4citizen/talkinghead, ~12 KB.
This deserves its own line because it sidesteps the weights question entirely. It is a letter-to-sound rule table (adapted from NRL Report 7948, 1976) that maps English spelling straight to the 15 Oculus visemes, and it carries a per-viseme relative duration table (aa 0.95, PP 1.08, SS 1.23, kk 1.21, nn 0.88 …) plus pause weights for space/comma/hyphen. `wordsToVisemes()` returns visemes + relative times + relative durations in unitless form; you scale them to the real audio length.
So: known narration text + known audio duration → a full viseme timeline with zero ML, zero weights, zero licence risk, zero build tooling. Accuracy is clearly below a real aligner and drift accumulates over a long paragraph — but if you cut narration at sentence boundaries (which you want anyway for the raise-hand pause) and scale per sentence, drift stays under a syllable. This is the fallback that never breaks and never needs a licence lawyer. It is English-only rules.

--- 1G. wawa-lipsync (real-time, browser) — for the LIVE doubt ---
Licence: MIT. No weights at all. Zero dependencies. v0.0.2, published 7 Nov 2025, 211 stars.
Size MEASURED: dist ES module 7,481 bytes raw / 2,566 bytes gzipped. Package unpacked 125 KB.
How it actually works (I read the compiled source): one AnalyserNode at fftSize 2048; seven hand-chosen frequency bands (50–200, 200–400, 400–800, 800–1500, 1500–2500, 2500–4000, 4000–8000 Hz) which are a coarse F1/F2/fricative proxy; plus spectral centroid, per-band deltas, and a 10-frame history. Then a hand-tuned scoring table picks one of the 15 Oculus visemes (viseme_sil, PP, FF, TH, DD, kk, CH, SS, nn, RR, aa, E, I, O, U), with a consistency bonus that holds the current viseme for up to ~100 ms so the mouth does not flicker.
Latency: one frame. Genuinely real-time, works on a live stream.
Quality: honest assessment — the vowels (aa/E/I/O/U) land often enough to read as speech; the consonant classification is heuristic and frequently wrong. On a stylised character nobody notices. On a photoreal face it would be unwatchable. This is the trade the whole stylised route is built on.
Driven by: `processAudio()` called from requestAnimationFrame, read `.viseme`.
TWO INTEGRATION GOTCHAS I found in the source, both trivial to fix: (a) `connectAudio()` insists on an HTMLAudioElement with a `.src`, which Gemini Live audio does not have — but the class also exposes `connectMicrophone()` using createMediaStreamSource, and `this.analyser` is reachable, so you connect your AudioBufferSourceNode straight to it: `myPcmNode.connect(lipsync.analyser)`. (b) it constructs its OWN AudioContext and wires analyser→destination, so if you also connect your source to destination you get doubled audio. At 2.6 KB gzipped and ~300 lines of readable code, the correct move is to vendor it and own it rather than depend on a 0.0.2 package.
Commercial: yes.

--- 1H. wLipSync (real-time, browser, AudioWorklet) — the better real-time option ---
Licence: MIT (mrxz). Port of hecomi's uLipSync, also MIT. Zero dependencies. Last push 6 Aug 2026 — actively maintained.
Size MEASURED: wlipsync-single.js 21.0 KB with the 11.9 KB WASM and the worklet processor inlined. ~33 KB total, one file, no fetch orchestration.
How it works: real MFCC computation in WASM, compared against a calibrated profile of per-viseme MFCC centroids, running inside an AudioWorklet.
WHY THIS BEATS 1G ON A MID-RANGE ANDROID: the AudioWorklet runs on the audio render thread. When the main thread is busy — React re-render, lesson video decode, a GC pause — wawa-lipsync's rAF loop drops frames and the mouth stutters; wLipSync keeps computing and you just read `.weights` whenever you next paint. On the device this actually ships to, that is the difference between "alive" and "broken".
Latency: real-time, works on any Web Audio source including a live stream.
Driven by: `const node = await createWLipSyncNode(ctx, profile); source.connect(node);` then read `node.weights` and `node.volume` in your animation loop.
THE CATCH: it requires a profile, and the repo ships no way to make one — you calibrate in Unity using uLipSync's calibration tool. That is a genuine one-off friction cost (install Unity, record the target voice saying A/I/U/E/O, export profile.json, convert to binary with the bundled `tools/json2bin.js`). BUT it is a ONE-OFF and it is a perfect fit here: your live voice is a single fixed Gemini Live voice, so you calibrate once, forever, and get a profile tuned to that exact voice — which is strictly better than wawa-lipsync's voice-agnostic heuristic.
Commercial: yes.

--- 1I. Raw AnalyserNode RMS — the floor ---
Licence: none, it is a browser API. ~20 lines.
`getByteTimeDomainData` → RMS → drive one "mouth open" value 0..1. That is all Live2D's own official lip-sync tutorial does (`getRms()`, multiplied by 0.8, applied to ParamMouthOpenY). No visemes, no phonemes.
Quality: a flapping jaw. Genuinely fine for a small character, a side-view, or a character whose mouth is stylised to a simple shape. It is what a lot of shipped VTuber-adjacent software does. Cost: zero bytes, zero CPU, zero risk. Worth having as the guaranteed-works fallback path behind a feature flag.

--- 1J. HeadTTS — change the TTS instead of solving the timing ---
Licence: code MIT (met4citizen). WEIGHTS: Kokoro-82M-v1.0-ONNX-timestamped, Apache-2.0. transformers.js Apache-2.0. All commercial-clean.
This is neural TTS that EMITS word timestamps, durations, phonemes AND Oculus viseme IDs — the exact problem Gemini TTS creates, solved at source. Runs in-browser on WebGPU with WASM fallback, or on a local Node WebSocket/REST server.
Why it is not the answer here: en-us only. An Indian Class 6–12 tutor needs Indian-accented English at minimum and Hinglish realistically; Kokoro's American voices will read as foreign to the student. Keep Gemini for voice.
Why it is still worth knowing: it is the clean escape hatch if Gemini TTS licensing, pricing or availability ever turns. And it proves the pattern — a TTS that reports its own phoneme timings makes this whole layer disappear.

--- 1K. Google Cloud TTS timepoints — the escape hatch that mostly is not one ---
Cloud TTS v1beta1 has `enableTimePointing: SSML_MARK`, which returns timings for `<mark>` tags. But Gemini-TTS on Cloud TTS supports no SSML marks and no timepointing (confirmed against its docs — text in, PCM/MP3/OPUS out, nothing else), Studio voices explicitly do not support `<mark>`, and there are open Google issue-tracker reports of Neural2 not returning mark timepoints. So the timepoint feature exists only on the older, worse-sounding voice families. Trading voice quality for word-level (not viseme-level) marks is a bad trade when a free offline aligner gives you phone-level for nothing.

--- 1L. In-browser WASM ASR aligners — investigated and rejected ---
vosk-browser (Apache-2.0 code, Apache-2.0 Vosk models) returns word start/end and runs in a WebWorker; sherpa-onnx (Apache-2.0) has WASM builds; whisper.cpp (MIT, Whisper weights MIT) has whisper.wasm with SIMD. All three are licence-clean and all three are the wrong tool: whisper.cpp's own WASM demo warns it needs "a fast desktop or laptop computer (not a mobile phone)", tiny/base are the realistic browser ceiling, and models are tens to hundreds of MB. You would be running a speech recogniser on a ₹12,000 Android phone to find out what your own script already told you. Rejected on device budget, not on licence.

--- 1M. GEMINI LIVE'S OWN TRANSCRIPT — a free assist for the live doubt ---
Gemini Live supports `outputAudioTranscription`, and Google's docs confirm output transcription streams word-by-word (input transcription arrives as one lump). That gives you the words being spoken, streaming, for free — no timings, but it lets you run the 1F rule table on the incoming words and use it to BIAS the real-time analyser's consonant guesses, which is exactly where wawa-lipsync/wLipSync are weakest. Nobody does this. It is the highest-leverage cheap improvement available on the live path.

═══════════════════════════════════════════════
LAYER 2 — THE ANIMATION RUNTIMES
═══════════════════════════════════════════════
All sizes below MEASURED by HTTP HEAD against jsDelivr, gzipped transfer size, on 23 Aug 2026.

--- 2A. RIVE ---
Runtime licence: MIT, "Copyright (c) 2020 Rive". Confirmed in rive-runtime/LICENSE. @rive-app/canvas, canvas-lite, webgl2 and react-canvas all carry `"license": "MIT"` in npm metadata.
Size MEASURED:
  @rive-app/canvas@2.40.1  — rive.js 92,331 gz + rive.wasm 752,750 gz = ~845 KB gzipped
  @rive-app/canvas-lite@2.40.1 — rive.js 84,536 gz + rive.wasm 317,076 gz = ~402 KB gzipped  ← use this one
  @rive-app/react-canvas@4.32.1 — 43 KB unpacked wrapper on top
402 KB gzipped is a real cost on an Indian mobile connection but it is a one-time cached cost, and it is less than a single lesson thumbnail.
COST — THE THING NOBODY MENTIONS: the runtime is free forever, but the EDITOR's free plan cannot export .riv. Rive's own docs: "Exporting for runtime is available on paid plans." So shipping requires Cadet at $9/seat/mo annual ($17 month-to-month) ≈ ₹800/mo. Rive states "No runtime fee. Your exports keep working forever" — so you can subscribe only in the months you are authoring or revising the character, export, cancel, and the .riv keeps working. Realistically ~$20–30 total to author and revise one tutor character. That is the honest number: not free, but not a meter.
Driven by: data binding, which is the current API and the one Rive is migrating everyone to. `const vmi = rive.viewModelInstance; vmi.number("Viseme").value = n;` — also `.boolean()`, `.string()`, `.color()`, `.enum()`, nested paths like `vmi.number("Face/Mouth/Viseme")`, and `.on()` observers. Setting a number every frame from your audio loop is exactly the intended usage.
THE RIGHT RIG for lip sync, from Rive's own best-practices page: put the 9 mouth drawings inside a **Solo**. A Solo renders only the active child and Rive documents it as "more efficient... it stops the rendering of any non active objects". So a viseme change is a draw-order flip, not a shape morph — near-zero per-frame cost even on a weak GPU. Bind the Solo's index to a data-bound number or enum and the whole lip-sync integration is one line of JS.
Mid-range Android at 30fps: yes, comfortably, with the Solo rig — you are drawing one small vector mouth per frame over an otherwise idle character. Rive's best-practices doc is candid that heavy vector work does hurt low-end devices and recommends a reduced alternate artboard for weak hardware; take that seriously and keep the tutor's body on a looping idle rather than a per-frame-animated one. Rive's state machines also self-pause when nothing is animating, which matters for battery during the long stretches where the tutor is just listening.
Third-party benchmark (unverified, directionally useful): Rive ~60fps vs Lottie 17fps on a Sony Xperia Z3; Rive ~12 MB Java heap vs Lottie ~23 MB.
Precedent: Duolingo. Rive's own case study on the AI video call confirms the State Machine "drives Lily's mouth positions, facial expressions, camera movements" and that the whole file stays "under a megabyte despite the complexity". Duolingo also hired "creative technologists" specifically to own these files — a note on where the real cost lives.

--- 2B. LOTTIE ---
Licence: lottie-web MIT (Airbnb). @lottiefiles/dotlottie-web MIT (LottieFiles.com 2023). Both clean, no weights, no editor subscription — After Effects + the free Bodymovin exporter, or any of the free Lottie editors.
Size MEASURED: lottie_light.min.js 46,831 gz / lottie_canvas.min.js 68,250 gz / lottie.min.js 76,815 gz. dotlottie-web ships a ThorVG WASM engine LottieFiles documents at ~500 KB compressed, fetched from CDN on first player construction (you will want to self-host that to satisfy "no vendor").
Driven by: `anim.goToAndStop(frame, true)`. Perfectly capable of being driven by an audio loop — you build one frame per mouth shape and seek to it.
Mid-range Android at 30fps: this is where Lottie loses. lottie-web's SVG renderer mutates the DOM every frame and is the slow path; the canvas renderer is materially better and is what you would use. Each lottie-web instance runs its own requestAnimationFrame loop, so multiple animations compound. dotlottie-web's Rust/WASM/ThorVG core with WebGL2 (WebGPU where available, software as last resort) closes most of the gap, at the price of a bigger initial payload than lottie_light.
When Lottie is the right answer: if you want zero editor subscription and zero new tooling, and your character is a modest illustrated bust rather than a fully interactive rig. lottie_light at 47 KB gzipped is a ninth of Rive's payload.
When it is wrong: Lottie has no state machine and no runtime logic. Every behaviour is you writing JS to seek timelines. For a character with idle/talking/listening/thinking states plus visemes, you end up hand-building what Rive's state machine gives you.

--- 2C. LIVE2D CUBISM — the licence is the story ---
Code licence: NOT open source in the usual sense. The Cubism Web Framework is dual-gated: the "Live2D Open Software License" plus, quoting the framework's own LICENSE.md verbatim, "All business users must obtain a Cubism SDK Release License. 'Business' means an entity with the annual gross revenue more than ten million (10,000,000) JPY for the most recent fiscal year." The runtime core (live2dcubismcore.min.js) is proprietary and comes from Live2D, redistributable only under those terms. pixi-live2d-display is MIT but is only a wrapper — you still ship Live2D's proprietary core.
So: free today at ~₹57 lakh/yr revenue, and a licensing negotiation with a Japanese company the moment the product works. A second, higher threshold (20,000,000 JPY) and a special "Expandable Application" review apply to avatar-system-shaped products, which is uncomfortably close to what an AI tutor avatar is. For a solo founder building a business he intends to grow, this is a licence bomb on a timer.
Editor cost: Cubism FREE exists but caps you at max 30 motion parameters, 3 blend-shape parameters, 100 ArtMeshes, 30 parts, 50 deformers, ONE texture at 2048 px, 9×9 warp deformer divisions. A proper talking tutor head with 9+ mouth shapes, eyes, brows and a breathing idle will hit the parameter and deformer ceilings and then refuse to export .moc3. In practice you need PRO.
Lip sync: built in and trivial — `getRms()` → `ParamMouthOpenY` via the model3.json LipSync group. But that is the flapping-jaw approach (1I); viseme-quality Live2D lip sync means rigging A/I/U/E/O parameters yourself.
Quality: the best-looking option of all of these for a 2.5D anime-adjacent character. Genuinely lovely. Wrong aesthetic for an Indian school tutor and wrong licence for a company that plans to grow.

--- 2D. SPINE (Esoteric Software) — disqualified ---
Runtimes are NOT free software. A valid Spine Editor licence is required to integrate the runtimes at all, and to distribute software containing them you must have held an editor licence at the time of integration. Editor is a one-time purchase, not a subscription, and Rhubarb even ships a Spine integration — but for a zero-budget solo founder this is a paid dependency with a licence that follows the code. Everything Spine does here, Rive does under MIT. No reason to pick it.

--- 2E. PLAIN SPRITE SHEETS — the option that is actually free and actually fastest ---
Licence: none. It is `ctx.drawImage()`.
Size: one PNG or WebP atlas. Nine mouth shapes at 256×256 in WebP is roughly 30–60 KB. Total runtime code: about 40 lines.
Driven by: `ctx.drawImage(atlas, visemeIndex*W, 0, W, H, x, y, W, H)` once per frame, or a CSS `background-position` + `steps()` variant with no JS at all for the idle loop.
Mid-range Android at 30fps: this is the only option on the list where 30fps is not even a question. A single blit of a small bitmap is the cheapest thing a browser can do. It will outrun Rive and Lottie on the weakest device you will ever ship to, and it degrades to nothing on a slow GPU because there is no vector rasterisation happening.
What you lose: no state machine, no interpolation, no smooth in-betweens, no runtime logic, no responsive scaling without pre-rendering at multiple resolutions. The character will read as classic limited animation — Hanna-Barbera, which is precisely the tradition Rhubarb's six mouth shapes come from.
Why it deserves serious consideration, not a footnote: it is the ONLY option here with zero licence surface, zero vendor, zero subscription, zero bundle cost and zero device risk. For v1 of a product whose per-student margin is in rupees, "the tutor is a lovely illustrated bust with a head-bob idle and nine mouth shapes swapping on a timeline" is a complete, shippable, honest answer that costs one afternoon of code. And critically: the mouth-timing JSON is IDENTICAL whether you later render it through sprites, Lottie or Rive. You can start on sprites and upgrade the renderer without touching the alignment pipeline.

═══════════════════════════════════════════════
LAYER 3 — READY-MADE OPEN-SOURCE AVATAR COMPONENTS
═══════════════════════════════════════════════

--- 3A. TalkingHead (met4citizen) ---
Licence: MIT. npm @met4citizen/talkinghead@1.7.0, 406 KB unpacked, single dependency `three ^0.180.0`. 1,499 stars, last push 2 June 2026 — maintained.
Real-time lip sync on full-body 3D avatars. Built-in lip-sync modules for English, German, French, Finnish, Lithuanian (~4–12 KB each, pure rule tables, no weights). `speakText()` drives from text via TTS; `speakAudio()` takes a PCM buffer plus `wtimes`/`wdurations` word timing arrays and optional `visemes`/`vtimes`/`vdurations` — which means it accepts exactly the JSON your offline aligner produces. That is a clean fit.
THE PROBLEM: it requires an avatar with a Mixamo-compatible rig, 52 ARKit blend shapes and 15 Oculus visemes, and its documented, default source for such avatars was Ready Player Me — which is gone (see 3B). The library still works; the avatar supply chain does not. And it is three.js: `three@0.185.1` is 23 MB unpacked, realistically 600 KB+ gzipped on top of TalkingHead's own 400 KB, before any GLB. On a mid-range Android phone you are now running a WebGL scene with a skinned mesh and 52 morph targets alongside a video element. That is a far worse device budget than a 2D mouth swap, for an aesthetic that lands closer to the uncanny valley, not further from it.

--- 3B. READY PLAYER ME + three.js morph-target visemes — DEAD, do not build on it ---
Netflix acquired RPM in December 2025 and the service wound down on 31 JANUARY 2026: the avatar creator, PlayerZero and the developer APIs all went offline. docs.readyplayer.me does not even resolve DNS any more. Previously-exported GLB files still function because they are standard glTF, but you cannot make new avatars and nothing hosted by RPM loads. Every tutorial, blog post and repo that says "use Ready Player Me" is stale. TalkingHead has an open issue (#169, 11 May 2026) asking for replacements. On licence, it was never as free as people assumed either — avatars made on the RPM website were CC-BY-4.0 non-commercial, and commercial use required being a registered Partner. Moot now.

--- 3C. VRM + @pixiv/three-vrm + VRoid Studio — the surviving 3D path ---
three-vrm licence: MIT. npm @pixiv/three-vrm@3.5.5, 2.5 MB unpacked, split across six sub-packages, plus `three` as peer. 2,123 stars, last push 10 Aug 2026 — the best-maintained thing in this whole report.
Viseme support confirmed by reading the source: `VRMExpressionPresetName` defines exactly `aa, ih, ou, ee, oh` for the mouth, plus blink/happy/angry/sad/relaxed/surprised/neutral and look directions. Five mouth shapes — a Japanese vowel set, coarser than the 15 Oculus visemes but honestly close to what a stylised character needs.
AVATAR ASSET LICENCE — the part that matters and the part that survives: VRoid Studio is free, and pixiv's terms are unusually clean. Models you create with VRoid Studio Stable can be sold and used commercially by individuals or corporations, and you set your own terms of use for what you make. So you can author a tutor character yourself, own it outright, and ship it commercially at zero cost. That is a genuinely better rights position than RPM ever offered. (Caveat: any purchased third-party textures or items you import keep their own licences.)
Verdict: if 3D is wanted, this is the only path with a live, free, commercially-clean asset pipeline in 2026. But the device budget objection from 3A stands unchanged, and VRoid's anime aesthetic is a specific, strong stylistic commitment for an Indian school product.

--- 3D. Maintained React components ---
agentic-avatars (MIT, npm `agentic-avatars`, 17 stars, last push April 2026): React Three Fiber components, pipeline is literally "Web Audio AnalyserNode → wawa-lipsync → morph targets on avatar". Ships three avatars (Jane, Fiona, Sam) loaded from jsDelivr, credited to an individual — the AVATAR ASSET licence is not stated and I could not establish it; the MIT covers the code only. Provider integrations are OpenAI Realtime, Deepgram, ElevenLabs, Vapi, LiveKit. NO Gemini Live. So for this product it offers no integration you would use, wrapping a library (wawa-lipsync) you can adopt directly in 2.6 KB.
avatoon (MIT, 17 stars, pushed 23 Aug 2026): React and React Native R3F component for animated avatars with lip sync and head motion. Very new, very small.
talking-avatar-with-ai (asanchezyali, 463 stars): NO LICENCE FILE AT ALL — all rights reserved by default, legally unusable. Useful as a reference implementation only. Notably its pipeline is GPT + Whisper + ElevenLabs + **Rhubarb** for lip sync, which is independent confirmation that Rhubarb is the practitioners' choice for pre-rendered lines.
pixi-live2d-display (MIT, 1,495 stars, last push Aug 2024 — going stale): PixiJS plugin for Live2D, but you must still supply Live2D's proprietary core. Licence problem of 2C applies.
Honest summary of this whole category: there is no maintained, Gemini-aware, commercially-clean, drop-in React talking-avatar component. Every one of them is a thin wrapper over a lip-sync library plus an avatar whose licence is the unexamined part. Take the lip-sync library, skip the wrapper.

═══════════════════════════════════════════════
LAYER 4 — AUTHORING AN INDIAN SCHOOL TUTOR CHARACTER
═══════════════════════════════════════════════

WHAT THE CHARACTER ACTUALLY IS, minimally: one head-and-shoulders illustration, nine mouth drawings, two eye states (open/blink), and a gentle breathing or head-bob idle. That is the entire asset list. Rhubarb tells you exactly what the nine mouths are, with reference art for each: A closed (P/B/M), B slight-open clenched teeth (most consonants, "EE"), C open ("EH", "AE"), D wide open ("AA"), E slightly rounded ("AO", "ER"), F puckered ("UW", "OW", "W"), G upper teeth on lower lip (F/V), H raised tongue (long L), X relaxed idle. Rhubarb's docs are explicit that C and E double as in-betweens, so A→C→D and C→E→F must read smoothly — that constraint is the whole art direction brief, and it is free.

COST — commissioning it (ranges from rate guides, not quotes I obtained):
- India-based character design: roughly ₹10,000–₹30,000 per character for a beginner illustrator, with the wider market spanning ₹10,000–₹2,00,000 by experience and usage rights. South/Southeast Asian freelance rates land around $10–28/hr.
- Rive rigging/animation: $25–45/hr entry level, $75–150/hr for specialists.
- For calibration on what "fully rigged" costs in a mature market: Live2D commissions run $50 for a lite rig to $3,500 for cinematic, with full-pipeline (design + illustration + rig) at $2,000–$5,000+; Fiverr rigging starts around $40–80; commercial-licence add-ons $100–300 and source files ~$200 are commonly separate line items — NEGOTIATE THOSE UP FRONT, because a mascot you cannot use commercially or cannot re-rig later is worthless.
Realistic solo-founder budget for a sprite-sheet or simple-Rive tutor: ₹15,000–₹40,000 for a good illustrated character sheet from an Indian illustrator, plus either your own weekend in Rive (the state machine for nine mouths in a Solo is genuinely a beginner task) or ₹15,000–₹30,000 to have it rigged. Under ₹60,000 all-in, once, forever. Compare against Mascotbot, the commercial version of exactly this product, at roughly $0.04 per minute of rendered speech.

CAN AN IMAGE MODEL PRODUCE THE CHARACTER SHEET? Yes, and you already have the pipeline — the repo has a Nano Banana image factory. Gemini 2.5 Flash Image is explicitly tuned to hold a subject coherent across edits and contexts, and character turnarounds ("front, side and back views", "keep the subject's X, change Y") are a documented use. The reported consistency is strong relative to other image models, though I did not verify those benchmark numbers.
Rights: Google does not claim ownership of Gemini-generated output and permits commercial use; images carry an invisible SynthID watermark, which is a provenance marker, not a usage restriction. App-surface downloads may also carry a visible mark — generate via the API, not the consumer app.
THE HONEST LIMIT, and it is important: an image model will give you a beautiful, consistent character IDENTITY — face, hair, clothing, palette, personality. It will NOT reliably give you nine mouth shapes that are pixel-registered to each other. Ask for nine mouths and you get nine slightly different faces, and the character's jaw will wobble as the mouths swap. That wobble is the single most common failure of AI-generated 2D lip sync and it reads instantly as cheap.
THE WORKFLOW THAT ACTUALLY WORKS: use the image model for the character sheet, the expression range and the reference art — the expensive, taste-heavy part. Then have a human (or yourself, in any vector tool) redraw JUST the mouth region as nine registered shapes on a fixed anchor point, over a single locked face. Nine small mouth vectors is a couple of hours of work, not a commission. This splits the job exactly along the line where AI is strong (identity, style, variety) and weak (precise geometric registration), and it drops the commission cost by most of its value.
BONUS the product should not miss: an owned illustrated character can be re-generated in new outfits, new subjects, festival variants and per-class art with the SAME Nano Banana factory that already exists in this repo — at zero marginal cost, forever. A photoreal presenter cannot do that without a reshoot and a fresh consent conversation.

## RECOMMENDATION
RECOMMENDATION: build it as two separate pipelines that share ONE data format, and treat the mouth-timing JSON — not the renderer — as the thing you are actually building.

THE ONE FORMAT: `[{ t: 1.240, d: 0.085, v: "D" }, ...]` — start, duration, mouth shape. Roughly 2 KB per minute of narration, gzipped to nothing. Everything below produces or consumes this. It is renderer-agnostic, so you can change your mind about Rive vs sprites later without touching alignment, and it is vendor-agnostic, so nothing here can be taken away from you.

TRACK 1 — RECORDED CLASS (95%+ of minutes watched). Build step, not runtime.
Gemini TTS renders the narration PCM → in the same Node build step run **rhubarb-lip-sync-wasm** (MIT, weights BSD) with `-d` pointed at the lesson script → emit the mouth JSON next to the audio. Ship both. The browser reads an array; it does zero analysis, spends zero CPU, works offline, and stays in sync forever. Rhubarb is the right tool specifically because it is not a general aligner — it was built to produce 2D cartoon mouth shapes, it outputs the exact six Hanna-Barbera shapes plus three extended ones, and it comes with the reference art telling your illustrator what to draw. The 42 MB npm package is irrelevant because it never leaves your laptop.
Ship-blocker to plan for now, not later: Rhubarb's English recogniser is English-only, and Hinglish will degrade to the less-precise `phonetic` recogniser. Test this on a real Hinglish paragraph in week one, before you commission any art. If it is unacceptable, the fallback is TalkingHead's `lipsync-en.mjs` rule table (MIT, no weights, 12 KB) run per sentence over the known script and scaled to each sentence's measured duration — cruder, but immune to language, immune to licensing, and immune to tooling.

TRACK 2 — LIVE DOUBT (the minutes that make the product special, but a small share of total minutes).
**wLipSync** (MIT, ~33 KB, AudioWorklet), with a profile calibrated ONCE against your chosen Gemini Live voice. Choose it over wawa-lipsync specifically because it runs on the audio thread: on a ₹12,000 Android phone the main thread will stall during React renders and video decode, and a main-thread rAF analyser makes the mouth visibly stutter at exactly the moment the student is paying most attention. If the Unity calibration step blocks you for more than an afternoon, ship **wawa-lipsync** instead — but vendor its ~300 lines into your repo rather than depending on a 0.0.2 package, patch it to accept an arbitrary AudioNode (it currently demands an HTMLAudioElement with a `.src`, though `connectMicrophone()` and the exposed `analyser` show the path), and stop its internal analyser→destination wiring from doubling your audio.
The cheap upgrade nobody does: enable Gemini Live's `outputAudioTranscription` — it streams the model's words out word-by-word — and use those words to bias the consonant classification, which is exactly where real-time spectral analysis is weakest.

THE RENDERER — start at the bottom and only climb if it hurts.
Ship v1 on a **sprite sheet**: one WebP atlas of nine mouths plus a looping idle, drawn with `ctx.drawImage`. Zero licence surface, zero vendor, zero subscription, ~40 lines, and it is the only option on this list where 30fps on a mid-range Android is not a question. If and when the character needs real states — talking, listening, thinking, celebrating, reacting to a wrong answer — move to **Rive canvas-lite** (MIT runtime, 402 KB gzipped measured) with the nine mouths in a **Solo** driven by `vmi.number("Viseme").value`, which Rive's own best-practices doc identifies as the efficient way to swap visible children. Budget $9–17/mo for the Rive editor only in the months you author, then cancel: "No runtime fee. Your exports keep working forever."
Do NOT pick Live2D (the Cubism Web Framework's own LICENSE.md requires a paid Release Licence for any business above ¥10M revenue — a licence bomb timed to your success, and the FREE editor's 30-parameter / 50-deformer / one-texture caps will block .moc3 export on a real talking head anyway). Do NOT pick Spine (runtimes legally require an editor licence). Do NOT build on Ready Player Me (dead since 31 Jan 2026). Do NOT reach for torchaudio's MMS_FA when you try to solve Hindi (CC-BY-NC weights) or charsiu (weights with no stated licence at all).

WHAT IS HONESTLY LOST VERSUS A PHOTOREAL TALKING HEAD
1. It does not look like a person. A student who has seen Tavus-grade avatars will read this as a cartoon, and some parents equate photoreal with premium.
2. Micro-expression is gone. No subtle brow flicker, no eye dart, no breath catch before a hard idea. You get a small, deliberate vocabulary of poses.
3. On the live path the mouth is reactive, never anticipatory. A pre-rendered timeline lets you lead the audio by ~40 ms the way real animators do; a real-time analyser cannot see the future and always trails by a frame.
4. Consonants will be wrong in real time. Spectral heuristics resolve vowels acceptably and guess at plosives and fricatives. On a stylised mouth this is invisible. That is not a coincidence — it is the whole reason the stylised route works.
5. You must actually draw something. Photoreal needs a photo; this needs an art direction decision and a character that Indian Class 6–12 students will accept as a teacher and not as a toy. That is a taste risk, and taste risk is harder than technical risk.

WHAT IS GAINED, beyond money
- No per-minute meter, ever. The commercial equivalent of exactly this (Mascotbot, Rive-based 2D avatars) meters at roughly $0.04/min. At scale the difference between ₹0/min and any number greater than zero is the difference between a business and a subsidy.
- No vendor who can die. This report has already had to delete Ready Player Me mid-research — a well-funded, 25,000-developer platform, gone in six weeks — and Hedra's LiveKit plugin was already a tombstone. Everything recommended above is MIT code on your disk with permissive or absent weights. Nothing here can be acquired away from you.
- True offline playback. The mouth JSON sits next to the audio in cache. An Indian student on a patchy 4G connection or in a class with no data can watch the full lesson, avatar and all. A server-rendered photoreal head cannot do that at any price, and for this market that is not a nice-to-have.
- No likeness consent, ever. Nobody's face is pretending to be an AI. No release form, no renegotiation when the person leaves, no awkward disclosure, no deepfake-adjacent optics with minors as the audience. For an education product serving children this is a real safety and trust asset, not a legal footnote.
- No uncanny valley. A slightly-wrong photoreal face is worse than no face; a stylised character has no valley to fall into. Duolingo, Khan Academy and BYJU'S all landed here, and Duolingo went as far as inventing a job title ("creative technologist") to own these files — which tells you both that the approach works and where the real cost sits.
- A brand you own. The character can appear on the landing page, in notification icons, on WhatsApp stickers, in worksheets, in festival art — and can be regenerated endlessly through the Nano Banana factory this repo already has, at zero marginal cost. A photoreal presenter is a cost centre that needs re-shooting. An owned character is an asset that compounds.

WHAT TO DO IN THE NEXT WEEK, in order
1. Take one already-rendered Gemini TTS narration file and run Rhubarb over it with the lesson script as the dialog file. Look at the JSON. This costs an hour and settles the Hinglish question before any money is spent.
2. Draw nine ugly placeholder mouths in any tool and play them back against that audio in a canvas. This costs an afternoon and tells you whether the whole idea reads as alive. It will.
3. Only then commission the character. Use the Nano Banana factory for identity and style; keep the nine registered mouth shapes as a separate, small, human-drawn job over one locked face — that registration is where AI-generated 2D lip sync visibly fails.

## SOURCES
- https://github.com/DanielSWolf/rhubarb-lip-sync
- https://raw.githubusercontent.com/DanielSWolf/rhubarb-lip-sync/master/LICENSE.md
- https://raw.githubusercontent.com/DanielSWolf/rhubarb-lip-sync/master/README.adoc
- https://github.com/danieloquelis/rhubarb-lip-sync-wasm
- https://www.npmjs.com/package/rhubarb-lip-sync-wasm
- https://github.com/mrxz/wLipSync
- https://raw.githubusercontent.com/mrxz/wLipSync/main/README.md
- https://github.com/hecomi/uLipSync
- https://github.com/wass08/wawa-lipsync
- https://cdn.jsdelivr.net/npm/wawa-lipsync@0.0.2/dist/wawa-lipsync.es.js
- https://wawasensei.dev/tuto/real-time-lipsync-web
- https://github.com/met4citizen/TalkingHead
- https://raw.githubusercontent.com/met4citizen/TalkingHead/main/modules/lipsync-en.mjs
- https://github.com/met4citizen/TalkingHead/issues
- https://github.com/met4citizen/HeadTTS
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- https://github.com/rive-app/rive-runtime/blob/main/LICENSE
- https://rive.app/pricing
- https://rive.app/docs/editor/exporting/exporting-for-runtime
- https://rive.app/blog/rive-s-new-9-mo-plan
- https://rive.app/docs/getting-started/best-practices.md
- https://rive.app/docs/runtimes/web/data-binding.md
- https://rive.app/docs/editor/manipulating-shapes/solos
- https://rive.app/blog/duolingo-s-ai-powered-video-call-brings-lily-to-life
- https://github.com/airbnb/lottie-web/blob/master/LICENSE.md
- https://github.com/LottieFiles/dotlottie-web/blob/main/LICENSE
- https://lottiefiles.com/blog/working-with-lottie-animations/hardware-accelerated-lottie-on-the-web-dotlottie-web-now-ships-webgl-webgpu
- https://www.live2d.com/en/sdk/license/
- https://github.com/Live2D/CubismWebFramework/blob/develop/LICENSE.md
- https://www.live2d.com/en/cubism/comparison/
- https://docs.live2d.com/en/cubism-sdk-tutorials/native-lipsync-from-wav-web/
- https://github.com/guansss/pixi-live2d-display
- http://en.esotericsoftware.com/spine-editor-license
- https://github.com/EsotericSoftware/spine-runtimes/blob/4.1/LICENSE
- https://en.wikipedia.org/wiki/Ready_Player_Me
- https://variety.com/2025/digital/news/netflix-acquires-ready-player-me-games-avatar-creation-1236612915/
- https://avatarsdk.com/blog/2026/01/15/switch-from-ready-player-me-to-avatar-sdk-fast-familiar-production-ready/
- https://github.com/pixiv/three-vrm
- https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm-core/src/expressions/VRMExpressionPresetName.ts
- https://vroid.pixiv.help/hc/en-us/articles/4405813333657-Can-I-use-the-models-created-with-VRoid-Studio-Stable-Ver-for-commercial-purposes
- https://vroid.com/en/studio/guidelines
- https://github.com/NavodPeiris/agentic-avatars
- https://github.com/khaledalam/avatoon
- https://github.com/asanchezyali/talking-avatar-with-ai
- https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner
- https://github.com/MontrealCorpusTools/mfa-models/blob/main/docs/source/acoustic/English/English%20MFA%20acoustic%20model%20v2_2_1.md
- https://mfa-models.readthedocs.io/en/latest/acoustic/index.html
- https://github.com/m-bain/whisperX
- https://huggingface.co/facebook/wav2vec2-base-960h
- https://docs.pytorch.org/audio/stable/generated/torchaudio.pipelines.MMS_FA.html
- https://github.com/lingjzhu/charsiu
- https://huggingface.co/charsiu/en_w2v2_fc_10ms
- https://github.com/mnaoizy/charsiu-js
- https://github.com/echogarden-project/echogarden
- https://github.com/ccoreilly/vosk-browser
- https://github.com/k2-fsa/sherpa-onnx
- https://github.com/ggml-org/whisper.cpp
- https://ai.google.dev/gemini-api/docs/speech-generation
- https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- https://docs.cloud.google.com/text-to-speech/docs/ssml
- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://developers.googleblog.com/en/introducing-gemini-2-5-flash-image/
- https://cloud.google.com/blog/products/ai-machine-learning/gemini-2-5-flash-image-on-vertex-ai
- https://templates.mascot.bot/lip-sync-api-2d-characters
- https://www.callstack.com/blog/lottie-vs-rive-optimizing-mobile-app-animation
- https://animarts.studio/blog/live2d-model-cost-pricing-guide
- https://fueler.io/blog/freelance-illustration-rates-character-vs-commercial
- https://www.upwork.com/hire/character-designers/in/