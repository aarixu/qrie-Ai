# verified so far
- LiveKit avatar arch: agent TTS audio -> avatar worker -> publishes A+V. BYO voice works for ALL LiveKit avatar plugins.
- LiveKit plugin langs: Anam/BeyondPresence/D-ID/LemonSlice/Protoface/Runway/Tavus/TruGen = Py+Node; Avatario/AvatarTalk/bitHuman/Keyframe/LiveAvatar/Simli/Spatius = Py only. Hedra deprecated.
- bitHuman: free 99 cr/mo. Essence1 cloud 2cr/min, self-host 1cr/min. Top-up $1=100cr => ~$0.01/cr. Creator $20/1800cr/3 concurrent.
  Code: repo Apache-2.0, examples MIT, PYTHON SDK = COMMERCIAL LICENCE (closed wheels, Cython .so). Swift = ToS.
  Weights: .imx proprietary, ENCRYPTED, decryption key fetched from bitHuman API at startup; BITHUMAN_API_SECRET required; billing heartbeat once/min even self-hosted.
  CPU claim real but: Essence2 CPU ~22-25fps on a 16-CORE desktop. Expression needs NVIDIA Ampere+ or M3+.
  WASM = "engine-internal Emscripten beachhead, not a production browser SDK". JS SDK @bithuman/sdk preview, NOT on npm, and is a cloud client.
- Simli: free $10 + 50 min/mo top-up. Trinity-1 "<1c/min"; legacy PAYG ~$0.05/min. JS SDK simli-client, PCM16@16kHz push, HTMLVideoElement, WebRTC. Custom faces app.simli.com/faces.
  Quality caveat (Docket eval): idle artifacts most pronounced, unnatural eye movement.
- Spatius: free 1000cr ~100min/mo, 2 concurrent, 10-min cap, NO COMMERCIAL USE on free, public avatars only. Starter $19 = 2000min (~$0.0095/min), 4 concurrent, 30min cap, commercial OK, 2 avatar creations/mo. Overage $0.009/min. Custom avatar $25.
- Protoface: realtime free 50cr, 1 custom avatar, 1 concurrent, 2-MIN SESSION CAP. Starter $20/500cr/2 concurrent/10min sessions, extra $0.02. Launch $99/7500cr/10 concurrent/20min, extra $0.01. LiveKit Py+Node.
- Anam $0.11-0.16/min overage, free 30min/mo. LemonSlice $0.14-0.19/min, no recurring free. HeyGen LiveAvatar $0.095-0.25/min, no free API tier. D-ID ~$0.56/min streaming, watermark + personal-use-only free. Trulience free 30min/mo, then $199/mo. Akool/Vidnoz = batch video credits, watermarked free.
- LiteAvatar (HumanAIGC): CODE MIT (verified LICENSE). WEIGHTS: ModelScope LiteAvatarGallery -> API JSON License field EMPTY = NOT DECLARED. CPU 30fps claim. ASR = Paraformer from ModelScope (separate licence).
- lite-avatar-WASM (fusheng-ji): MIT, ONNX Runtime Web, ~817MB models, 150 frames in 5-10s, 1-2GB RAM. Not mobile-viable.
