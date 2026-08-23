# Google Gemini text-to-speech via the Generative Language API, for narrating a pre-recorded class (voice list, style steering, multi-speaker, limits, cost, streaming, SSML, Indian-English accent, batch pre-render)

## VERIFIED
Verified 2026-08-23 against primary sources fetched live, not from memory.

PRIMARY SOURCES USED
- ai.google.dev/gemini-api/docs/generate-content/speech-generation — page title is literally "Text-to-speech generation (TTS) | Gemini Generate Content API (Legacy)". This is the doc for YOUR call path (:generateContent). I read its raw markdown source (.md.txt), not a rendered summary.
- ai.google.dev/gemini-api/docs/speech-generation — the current TTS page. NOTE: it has been rewritten around the new Interactions API (POST /v1beta/interactions, `input`, `response_format:{type:"audio"}`, `generation_config.speech_config:[{voice:"Kore"}]`). Your generateContent shape is now the "legacy" surface. It still works and is still documented on its own page; just be aware Google is steering new work to Interactions.
- ai.google.dev/api/generate-content (REST reference) — authoritative field definitions for SpeechConfig / VoiceConfig / PrebuiltVoiceConfig / MultiSpeakerVoiceConfig / SpeakerVoiceConfig.
- ai.google.dev/gemini-api/docs/pricing — exact TTS price rows.
- ai.google.dev/gemini-api/docs/rate-limits — read in full.
- ai.google.dev/gemini-api/docs/batch-api, .../live-api/capabilities, .../models.
- A ListModels dump (models.json, 50 models, captured this session in the scratchpad) for inputTokenLimit / outputTokenLimit / supportedGenerationMethods.

WHAT I COULD NOT CONFIRM — do not let anyone quote these as fact:
1. RPM / TPM / RPD for any TTS model. Google has REMOVED the per-model rate-limit tables. The page now says only: "Rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio... Specified rate limits are not guaranteed and actual capacity may vary." There is no published RPM number for gemini-3.1-flash-tts-preview anywhere. Third-party blogs cite 3 RPM / 15 RPD / 10k TPM for gemini-2.5-flash-preview-tts free tier (matches what Google used to publish), but that is NOT a primary source and is not the model you are using. Read your project's actual numbers in AI Studio.
2. Whether speechConfig.languageCode actually changes the ACCENT on generateContent TTS. The field exists and "en-IN" is a documented valid value, but the TTS guide separately says "The TTS models detect the input language automatically," and the Live API guide says native-audio models "don't support explicitly setting the language code." So the field is real; its effect on TTS accent is untested. Test it before relying on it.
3. Whether all 30 voices truly work on the Live API. Google's Live doc contradicts itself (see gotchas). Needs a one-time smoke test.
4. Batch enqueued-token cap for gemini-3.1-flash-tts-preview — the model is absent from Google's batch enqueued-tokens table entirely.
5. SSML — I found no statement either way in the Gemini API docs. Absence of any mention across the TTS guide, the prompting guide and the REST reference, combined with the entire style system being natural-language prompts + audio tags, is strong evidence it is unsupported, but Google never writes "SSML is not supported." Treat as unsupported.

## API
=== 1. THE COMPLETE 30-VOICE LIST (verbatim from the docs, name -- character) ===
Zephyr--Bright | Puck--Upbeat | Charon--Informative | Kore--Firm | Fenrir--Excitable | Leda--Youthful | Orus--Firm | Aoede--Breezy | Callirrhoe--Easy-going | Autonoe--Bright | Enceladus--Breathy | Iapetus--Clear | Umbriel--Easy-going | Algieba--Smooth | Despina--Smooth | Erinome--Clear | Algenib--Gravelly | Rasalgethi--Informative | Laomedeia--Upbeat | Achernar--Soft | Alnilam--Firm | Schedar--Even | Gacrux--Mature | Pulcherrima--Forward | Achird--Friendly | Zubenelgenubi--Casual | Vindemiatrix--Gentle | Sadachbia--Lively | Sadaltager--Knowledgeable | Sulafat--Warm

FOR A WARM, PATIENT INDIAN SCHOOLTEACHER, ranked:
1. Sulafat ("Warm") — the only voice Google labels Warm. Default pick.
2. Achird ("Friendly") — warm but more casual/peer-like; good for the live doubt agent's register.
3. Vindemiatrix ("Gentle") — patient, soft-spoken; good for a nervous student.
4. Achernar ("Soft") — softest; can read as under-energised over 40 minutes.
5. Sadaltager ("Knowledgeable") — authoritative-warm; good for a senior-class teacher.
6. Gacrux ("Mature") — older-teacher register.
Avoid for this persona: Charon/Rasalgethi (Informative = newsreader, cold), Kore/Orus/Alnilam (Firm = strict), Puck/Laomedeia/Sadachbia (Upbeat/Lively = ad-read energy), Enceladus (Breathy), Algenib (Gravelly).
On your current Aoede ("Breezy"): breezy is light and airy, not warm or patient. It is a defensible choice but it is not the one the label points at. A/B Sulafat against it before you lock a voice into a lesson library.
The names carry NO ethnicity — they are timbre/register only. Indian accent comes from the prompt (see below), never from the voice name.

LIVE API OVERLAP: The Live API capabilities guide says "Native audio output models support any of the voices available for our Text-to-Speech (TTS) models" and links to this exact 30-voice list. Both current Live models (gemini-3.1-flash-live-preview, gemini-2.5-flash-native-audio-*) are native-audio, so on the documented reading all 30 — including Sulafat — are shared, and your same-voice-across-recorded-and-live requirement is satisfiable. See gotcha #1 for the contradiction to smoke-test.

=== 2. STEERING DELIVERY — YES, AND IT IS THE ONLY MECHANISM ===
Confirmed verbatim: "You can control style, tone, accent, and pace using natural language prompts or audio tags for both single- and multi-speaker TTS." Google's own single-speaker example is `Say in an spooky voice: "By the pricking of my thumbs... [short pause] [whisper] Something wicked this way comes"`.

Two layers, both inside the SAME text part — there is no separate style parameter:
(a) A prose prompt block Google structures as: Audio Profile / Scene / Director's Notes (Style, Pacing, Accent) / Sample Context / Transcript. Google says Director's Notes is the one element you should not skip.
(b) Inline audio tags in square brackets: [whispers] [shouting] [very fast] [very slow] [excitedly] [bored] [tired] [serious] [sighs] [laughs] [short pause] [cough] [gasp]. "There is no exhaustive list on what tags do and don't work." For non-English transcripts, still use English tags.

EXACT REQUEST SHAPE — single speaker, your call path:
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -X POST -H "Content-Type: application/json" \
  -d '{
    "contents":[{"parts":[{"text":"<PROMPT BLOCK + TRANSCRIPT, see below>"}]}],
    "generationConfig":{
      "responseModalities":["AUDIO"],
      "speechConfig":{
        "voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Sulafat"}},
        "languageCode":"en-IN"
      }
    }
  }' | jq -r '.candidates[0].content.parts[0].inlineData.data' | base64 --decode > out.pcm
# ffmpeg -f s16le -ar 24000 -ac 1 -i out.pcm out.wav
(languageCode is a sibling of voiceConfig inside speechConfig — confirmed in the REST reference. Optional; see verified-gaps #2.)

THE TEXT PART, shaped for your tutor:
  Synthesize speech for the transcript below. Do not read these instructions aloud.
  # AUDIO PROFILE: Meera Ma'am
  ## "The patient Class 8 science teacher"
  ## THE SCENE
  A quiet afternoon classroom. She is at the board with one student who is a little
  behind the rest. There is no hurry and no audience — nothing to prove, only to explain.
  ### DIRECTOR'S NOTES
  Style: Warm and encouraging, with a vocal smile. Patient, never condescending.
  Pacing: Unhurried. A beat of silence after each new term so it lands.
  Accent: Indian English as spoken by an educated schoolteacher in Delhi — clear,
  natural Indian English, not anglicised, not a caricature.
  ### TRANSCRIPT
  [warmly] Okay, so today we will look at photosynthesis. [short pause] Now — ...
The preamble line and the explicit "### TRANSCRIPT" label are not decoration: they are Google's own documented mitigation for the classifier bug (gotcha #6).

=== 3. MULTI-SPEAKER ===
Shape (mutually exclusive with voiceConfig; MAX 2 SPEAKERS; speaker strings must match the names in the transcript):
"speechConfig":{"multiSpeakerVoiceConfig":{"speakerVoiceConfigs":[
  {"speaker":"Teacher","voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Sulafat"}}},
  {"speaker":"Riya","voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Leda"}}}]}}
Transcript must be labelled: "Teacher: ...\nRiya: ..." and you can direct each speaker separately ("Make Riya sound hesitant, and Teacher sound patient:").
WORTH ANYTHING FOR A SINGLE-TUTOR CLASS? Almost nothing, with one real exception. Not worth it for narration — one tutor is one voice. The exception: the classic Indian-classroom device of a fictional classmate raising the doubt the student is about to have ("Riya: Ma'am, but why does it need sunlight?"). That is genuinely a two-voice scene and multi-speaker renders it in one request, in one acoustic space, with natural turn-taking — better than splicing two separate synths. Cost of using it: output is ONE mixed mono stream, so you cannot duck, re-time or re-record either speaker independently; and you burn a 2-speaker budget you cannot extend. Use it only for scripted dialogue beats, never as the default path.

=== 4. LIMITS AND MONEY (concrete) ===
Per-request size, from ListModels on gemini-3.1-flash-tts-preview:
  inputTokenLimit  8192   outputTokenLimit 16384
  supportedGenerationMethods: ["generateContent","countTokens","batchGenerateContent"]
The docs separately claim "A TTS session has a context window limit of 32k tokens" — that contradicts the API's own 8192. Plan against 8192. Your director's-notes block spends from the same 8192 as the transcript.
Practical ceiling from outputTokenLimit: at your measured 32 audio-tokens/sec, 16384 tokens ≈ 512 s ≈ 8.5 min of audio per request — but Google warns quality "may begin to drift" past "a few minutes", so chunk at 1–3 min regardless.

PRICE (verbatim from the pricing page):
  gemini-3.1-flash-tts-preview — Free tier: input free, output free. Paid: $1.00 / 1M input text tokens, $20.00 / 1M output audio tokens. Batch: $0.50 in, $10.00 out.
  gemini-2.5-flash-preview-tts — Free tier available. Paid: $0.50 in / $10.00 out. Batch: $0.25 / $5.00.
  gemini-2.5-pro-preview-tts — NO free tier ("Not available"). Paid: $1.00 / $20.00. Batch: $0.50 / $10.00.
  Batch is exactly 50% of standard across the board.
COST OF NARRATION, from YOUR measurement (233 tokens / 7.3 s = 32 tok/s):
  $20/1M x 1920 tokens/min = $0.0384 per minute → ~$2.30 per hour of finished narration.
  Via Batch: $0.0192/min → ~$1.15/hour.
  A 40-minute class: ~$1.54 interactive, ~$0.77 batch. Input text is rounding error (~$0.002/lesson).
  Caveat: Google's pricing footnote says "Audio tokens correspond to 25 tokens per second of audio", which would give $0.030/min. Your own measurement says 32. Budget with 32; it is the conservative number and it came from a real billed response.
FREE TIER: input and output are "Free of charge" for gemini-3.1-flash-tts-preview and gemini-2.5-flash-preview-tts. But the same table says "Used to improve our products: Yes" on free tier and "No" on paid — see gotcha #7.
RATE LIMITS: no published RPM/TPM/RPD (see verified-gaps #1). Published per-model batch caps exist only for the 2.5 TTS models — Batch enqueued tokens: 2.5 Pro TTS 25,000 (T1) / 100,000 (T2) / 1,000,000 (T3); 2.5 Flash TTS 100,000 (T1) / 100,000 (T2) / 4,000,000 (T3). Batch API also: 100 concurrent jobs, 2GB input file, 20GB file storage, 20MB cap for inline (non-file) requests.
Spend-based limits, rolling 10 min: Free N/A, Tier 1 $10, Tier 2 $50, Tier 3 $200. Tier 1 = link a billing account.

=== 5. STREAMING — YES, ON YOUR EXISTING PATH ===
You do NOT have to synthesise the whole utterance first. Confirmed for gemini-3.1-flash-tts-preview:
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:streamGenerateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -X POST -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"..."}]}],
       "generationConfig":{"responseModalities":["AUDIO"],
         "speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Sulafat"}}}}}'
JS: ai.models.generateContentStream(...), then per chunk read chunk.candidates[0].content.parts[0].inlineData.data — raw PCM, 24kHz, mono, 16-bit, same format you already decode. Python: client.models.generate_content_stream(...).
Restriction: "Streaming is supported for Text-to-Speech (TTS) models starting with version 3.1." The 2.5 TTS models cannot stream at all.
For your architecture: irrelevant for the pre-recorded class (render at authoring time), decisive if you ever synthesise the live doubt answer through TTS instead of the Live API.

=== 6. SSML — NO. USE AUDIO TAGS. ===
SSML appears nowhere in the Gemini API TTS guide, the prompting guide, or the REST reference. There is no ssml field, and input is a plain text part. The whole control surface is prose + bracket tags.
SUBSTITUTES:
  Pause  → [short pause] (Google's own example), or an em-dash / ellipsis / paragraph break in the transcript, or a Director's Note "a beat of silence after each new term".
  Emphasis → [excitedly], [serious], [whispers], [shouting], or write it into the Director's Notes ("elongated vowels on the key term").
  Rate → [very slow], [very fast], [one word at a time], or Pacing in Director's Notes.
  Pitch/volume → no equivalent; choose a different voice instead.
CRITICAL: none of these are deterministic. For narration that must line up with a canvas event or an animation, do NOT ask the model for a pause of a given length. Synthesise per beat and insert exact silence yourself in your own audio timeline. That also gives you per-chunk retry and sidesteps the long-output drift.

=== 7. INDIAN-ACCENT ENGLISH ===
Supported, via the prompt. The docs make accent a first-class Director's Note and are explicit that specificity wins: use "British English accent as heard in Croydon, England" over "British Accent". Do the same: "Indian English as spoken by an educated schoolteacher in Delhi", not "Indian accent".
LOCALE: speechConfig.languageCode exists on generateContent and its documented valid values include en-IN, plus hi-IN, bn-IN, gu-IN, kn-IN, ml-IN, mr-IN, ta-IN, te-IN (also en-US, en-GB, en-AU, es-US, ar-XA, cmn-CN and others). Reference text: "Optional. The IETF BCP-47 language code that the user configured the app to use. Used for speech recognition and synthesis." Set it to en-IN — but treat the prompt as the load-bearing lever and the field as a hint, per verified-gaps #2.
DOES THE VOICE LIST DIFFER BY LANGUAGE? No. All 30 voices are listed once, unconditionally, with no per-language table. The TTS guide says language is auto-detected from the input, and 91 languages are supported (English, Hindi, Bangla, Marathi, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Odia, Nepali, Sindhi, Konkani, Maithili all present — the whole Indian set you would ever need). Same voice name, any language: which is exactly what lets one tutor persona survive a Hindi/English switch.

=== 8. BATCH — YES, AND IT IS THE RIGHT PATH FOR AUTHORING ===
Confirmed: gemini-3.1-flash-tts-preview lists batchGenerateContent in supportedGenerationMethods (so does gemini-2.5-pro-preview-tts; gemini-2.5-flash-preview-tts does NOT — it lists only countTokens + generateContent). Batch docs: "This feature is currently only available with the generateContent API" — i.e. your path, not Interactions. "The supported modalities for Batch API are the same as what's supported on the interactive API."
JSONL line shape (Google's documented file format uses snake-case generation_config wrapping camelCase inner keys — copy it exactly):
{"key":"lesson07-seg-001","request":{"contents":[{"parts":[{"text":"...prompt+transcript..."}]}],"generation_config":{"responseModalities":["AUDIO"],"speechConfig":{"voiceConfig":{"prebuiltVoiceConfig":{"voiceName":"Sulafat"}}}}}}
Submit inline (under 20MB total) or as a file (2GB cap). Poll state; on JOB_STATE_SUCCEEDED read response.responsesFile or response.inlinedResponses.
WHAT IT BUYS YOU: half price ($1.15/hr instead of $2.30/hr of narration); one submission for an entire lesson's segments instead of hand-managing an unpublished RPM ceiling; and a machine-readable per-request failure list (batchStats.failedRequestCount) so the random 500s become a re-queue of named keys rather than a silent gap in a lesson.
WHAT IT COSTS YOU: 24-hour SLO (jobs expire at 48h), so it is an authoring-time tool only — never in a student's request path. Results retained 6 weeks, so download and store your own audio. Audio returns base64 in the results JSONL (~1.33x inflation), so an hour of narration is roughly 230MB of PCM before you encode — budget against the 20GB file-storage cap. And Tier-1 enqueued-token caps for TTS are small (100k for 2.5 Flash TTS; unpublished for 3.1), so submit lesson-by-lesson, not library-at-once.

## GOTCHAS
- LIVE-API VOICE OVERLAP IS SELF-CONTRADICTORY IN GOOGLE'S OWN DOC — smoke-test before you commit a voice to a lesson library. The Live capabilities guide says native-audio models 'support any of the voices available for our Text-to-Speech (TTS) models' and links to the 30-voice list; twelve lines later the same page says 'If you're using the generateContent API, the set of available voices is slightly different' — and links to that same list. The note is almost certainly stale (from when half-cascade Live had only 8 voices), and both current Live models are native-audio, so all 30 should be shared. But your entire same-voice-across-recorded-and-live requirement rests on this. Spend five minutes: open a gemini-3.1-flash-live-preview session with voiceName 'Sulafat' and confirm it does not error, BEFORE you render a single lesson.
- NO WORD-LEVEL TIMESTAMPS COME BACK FROM TTS. With responseModalities:['AUDIO'] you get audio and nothing else — there is no text part, no alignment data. The wordTimestamp boolean in the REST reference belongs to speech RECOGNITION config, not synthesis. So there is no free path to karaoke-style highlighting, per-sentence captions, or auto-syncing a canvas diagram to the moment the tutor names it. Your only levers: synthesise per beat and use your own authored chunk boundaries as the timeline (recommended — you control it exactly), or run forced alignment afterwards. Decide this before you design the lesson player, because 'one big audio file per lesson' forecloses it.
- THE MODEL SOMETIMES READS YOUR DIRECTOR'S NOTES ALOUD, OR REJECTS THE REQUEST. Google documents this: 'Vague prompts may fail to trigger the speech synthesis classifier, resulting in a rejected request (PROHIBITED_CONTENT) or causing the model to read your style instructions and director's notes aloud.' Their prescribed fix is mandatory in an automated pipeline: open with an explicit preamble ('Synthesize speech for the transcript below. Do not read these instructions aloud.') and explicitly label where the spoken text begins ('### TRANSCRIPT'). At lesson scale you will render hundreds of short lines — short, bland lines are exactly the vague prompts that trip this. Add an automated check that output duration is plausible for the transcript's word count, or a bad take ships silently into a class.
- RANDOM 500s ARE EXPECTED, NOT A BUG IN YOUR CODE. Documented: 'The model occasionally returns text tokens instead of audio tokens, causing the server to fail the request with a 500 error... you should implement automated retry logic.' Build retry with backoff into the render worker from day one. This is also the strongest argument for the Batch path at authoring time — batchStats.failedRequestCount plus per-request keys turns this into a clean re-queue list instead of a silent hole in a lesson.
- TWO PUBLISHED LIMITS CONTRADICT EACH OTHER — build to the smaller one. The TTS guide says 'a context window limit of 32k tokens'; ListModels on gemini-3.1-flash-tts-preview says inputTokenLimit 8192, outputTokenLimit 16384. Plan against 8192 input. And remember your Audio Profile / Scene / Director's Notes block is spent from that same 8192 as the transcript — a rich persona block of 400 tokens repeated on every segment is a real tax at lesson scale. Separately, outputTokenLimit 16384 caps one request at ~8.5 min of audio, but Google warns quality 'may begin to drift' past 'a few minutes' — so chunk at 1-3 minutes on quality grounds long before you hit any hard limit.
- GOOGLE HAS STOPPED PUBLISHING RPM/RPD PER MODEL. The rate-limits page now says only 'Rate limits depend on a variety of factors (such as your usage tier) and can be viewed in Google AI Studio' and adds 'Specified rate limits are not guaranteed and actual capacity may vary.' There is no primary number for gemini-3.1-flash-tts-preview anywhere. Anything you read online (3 RPM / 15 RPD is the commonly cited free-tier figure for the older 2.5 TTS model) is third-party and about a different model. Read your project's real numbers in AI Studio, and design the authoring renderer to survive a 429 with backoff rather than to a number you believe.
- FREE TIER TRAINS ON YOUR DATA — and you are building for Class 6-12. The pricing table says, for both free-tier TTS models, 'Used to improve our products: Yes' on Free and 'No' on Paid. Free TTS is genuinely free of charge, which makes it tempting for the whole pre-render. But the moment student-authored text touches a TTS prompt — a doubt read back, a personalised line with a child's name — free tier means that text is used to improve Google's products. Move to paid (Tier 1 is just linking a billing account) before any student-derived text reaches the API. At ~$1.15/hour of narration via Batch this is a trivially cheap decision and an expensive one to get wrong.
- YOUR DOC PATH IS NOW LABELLED LEGACY. The page for :generateContent TTS is titled 'Gemini Generate Content API (Legacy)', and the primary TTS doc has been rewritten around the new Interactions API (POST /v1beta/interactions with input / response_format:{type:'audio'} / generation_config.speech_config:[{voice:'Kore'}] — note speech_config is an ARRAY there, and multi-speaker is just [{speaker,voice},{speaker,voice}]). Nothing is deprecated and your call still works, and Batch is currently generateContent-only so you cannot move the pre-render anyway. But when you search for help you will land on Interactions-shaped examples that will not fit your code. Pin the legacy URL in your own docs so the next person does not paste the wrong shape.
- AUDIO TAGS AND PAUSES ARE SUGGESTIONS, NOT INSTRUCTIONS. '[short pause]' is Google's own example, but there is no guaranteed duration and 'There is no exhaustive list on what tags do and don't work.' Never rely on a model-generated pause to line narration up with a diagram appearing on the canvas — synthesise per beat and insert exact silence in your own timeline. Related: 'The model's output may not always strictly match the selected speaker.' Keep the written tone of the transcript consistent with the persona, or a warm teacher voice will drift.
- THE 30 VOICE NAMES CARRY NO ETHNICITY. Sulafat is 'Warm', not 'Indian'. If someone on the team goes hunting for an Indian-sounding voice name they will waste a day. Accent comes from the Director's Notes ('Indian English as spoken by an educated schoolteacher in Delhi' — Google is explicit that specific beats generic), optionally reinforced by speechConfig.languageCode:'en-IN'. Whether that field actually moves the accent on generateContent TTS is untested — the TTS guide says language is auto-detected and the Live guide says native-audio ignores the field entirely. Verify with one A/B before you write it into the pipeline as load-bearing.

## SOURCES
- https://ai.google.dev/gemini-api/docs/generate-content/speech-generation — TTS on the :generateContent path (page title: 'Gemini Generate Content API (Legacy)'). Source of the exact single-speaker and multi-speaker REST shapes, the 30-voice list, the 91-language table, the audio-tag list, the Director's Notes prompting structure, the streaming section, and the Limitations list. Raw markdown read at https://ai.google.dev/gemini-api/docs/generate-content/speech-generation.md.txt
- https://ai.google.dev/gemini-api/docs/speech-generation — current TTS guide, rewritten around the Interactions API. Confirms 'up to 2' speakers, the 32k context claim, and the 3.1-only streaming note. Raw markdown at .../speech-generation.md.txt
- https://ai.google.dev/api/generate-content — REST reference. Authoritative field definitions for SpeechConfig (voiceConfig, multiSpeakerVoiceConfig, languageCode with the full valid-value list including en-IN and hi-IN), VoiceConfig, PrebuiltVoiceConfig.voiceName, MultiSpeakerVoiceConfig.speakerVoiceConfigs[], SpeakerVoiceConfig.speaker, and the AUDIO response modality. Also confirms wordTimestamp is a speech-RECOGNITION field, not a TTS output.
- https://ai.google.dev/gemini-api/docs/pricing — exact price rows for gemini-3.1-flash-tts-preview ($1.00 in / $20.00 out standard; $0.50 / $10.00 batch; free tier 'Free of charge'), gemini-2.5-flash-preview-tts ($0.50 / $10.00), gemini-2.5-pro-preview-tts (no free tier, $1.00 / $20.00), the 'Used to improve our products' Yes-on-free/No-on-paid rows, and the '25 tokens per second of audio' footnote.
- https://ai.google.dev/gemini-api/docs/rate-limits — confirms per-model RPM/TPM/RPD tables have been REMOVED in favour of AI Studio; source of the usage-tier table, spend-based limits (T1 $10 / T2 $50 / T3 $200 per 10 min), Batch API limits (100 concurrent, 2GB input file, 20GB storage), and the Batch enqueued-token caps for the 2.5 TTS models.
- https://ai.google.dev/gemini-api/docs/batch-api — 50% pricing, 24h SLO, 48h job expiry, 6-week result retention, 20MB inline cap, JSONL request shape, 'only available with the generateContent API', and 'supported modalities for Batch API are the same as ... the interactive API'.
- https://ai.google.dev/gemini-api/docs/live-api/capabilities — the Live speechConfig shape, 'Native audio output models support any of the voices available for our Text-to-Speech (TTS) models', the contradictory 'the set of available voices is slightly different' note, and 'Native audio output models automatically choose the appropriate language and don't support explicitly setting the language code'. Raw markdown at .../capabilities.md.txt
- https://ai.google.dev/gemini-api/docs/models — current model IDs: gemini-3.1-flash-tts-preview, gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts, gemini-3.1-flash-live-preview, gemini-3.5-live-translate-preview.
- ListModels API dump (models.json, 50 models, captured in this session's scratchpad at C:/Users/HP/AppData/Local/Temp/claude/c--Users-HP-Ai-Tutor/797e7caa-c3ef-4621-9bed-7be70f80434d/scratchpad/models.json) — gemini-3.1-flash-tts-preview: inputTokenLimit 8192, outputTokenLimit 16384, supportedGenerationMethods ['generateContent','countTokens','batchGenerateContent']; gemini-2.5-flash-preview-tts lacks batchGenerateContent; both current Live models are bidiGenerateContent-only.
- https://docs.cloud.google.com/text-to-speech/docs/gemini-tts — corroborating only, and a DIFFERENT product (Cloud Text-to-Speech's Gemini-TTS, not the Generative Language API). Confirms the same prompt-based steering philosophy and has its own 4,000-byte-per-field limits that do NOT apply to the Gemini API path. Cited so nobody confuses the two.