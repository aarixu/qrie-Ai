# Gemini Live, measured — the facts driver A is built on

Measured 2026-09-30 against the real Gemini API (AI Studio key, `GEMINI_API_KEY`) by
`tools/live-sim/probe-live.mjs`. Five runs: two with the tool response held back 1.5 s
(to catch audio the model did not wait for), three with it sent at once (a turn the way
a conductor in the page would run it). All input was typed text (`clientContent`); all
output was voice (`responseModalities: ['AUDIO']`, voice Sulafat). The script's own
estimate of the spend, from the usageMetadata frames at the published rates, summed
every frame as a delta: US$0.2484 in all (0.0136 + 0.0868 + 0.0749 + 0.0388 + 0.0343).
The billing console was not checked.

"n" below is the number of turns a figure rests on. Anything not measured says
UNVERIFIED.

## The answer, short

- **Model for driver A: `gemini-3.8-live`, with `behavior: 'BLOCKING'` on `next_move`**,
  and the model id kept as a lab setting so `gemini-3.1-flash-live-preview` can be heard
  beside it.
  - 3.8 is the stable model; the models page calls 3.1 "Legacy Live API preview model".
    Both are on one price row.
  - With BLOCKING, 3.8 behaves on the wire exactly like 3.1: the student turn stays
    open through the tool call, and one turnComplete and one usageMetadata come after
    her reply.
  - Without `behavior`, 3.8 closes a turn at the call itself: generationComplete +
    turnComplete + its own usageMetadata within 2 ms of the toolCall, with ids
    `call_<7 digits>` where BLOCKING and 3.1 give `fc_` and a long number.
    - That turnComplete can arrive *after* a fast toolResponse. Measured: response sent
      at 16353 ms, the call's turnComplete at 16355 ms, her reply's first audio at
      17132 ms.
    - A driver that reads turnComplete as "she has finished" would start listening
      while her reply is still coming.
  - What 3.8 costs against 3.1 here:
    - about 0.2–0.4 s more per turn (medians below);
    - one skipped tool call in 9 BLOCKING turns;
    - one hallucinated output transcription (below);
    - 15–24 literal `{}` frames per turn.
  - What 3.1 did worse: its replies ran over `max_sentences: 2` in 5 of 15 (3.8: 0 of
    15), and it drifted from `say_this` once.
- **"Call the tool before every reply" works on both models, but not every time.**
  - No audio came before a `next_move` call or while a response was outstanding, in 32
    student turns. That includes 12 turns with a 1.5 s hold: 3.8 without behavior 4,
    3.8 BLOCKING 3, 3.1 without 3, 3.1 BLOCKING 2.
  - 3.8 skipped the call once in 17 turns with tools: "Hmm, I don't know." went straight
    to speech, first audio at 796 ms. 3.1 called it 15 of 15.
  - The driver has to notice a reply that came with no call.
- **She speaks first on both models** when a `[CONDUCTOR]` user turn is sent after
  setupComplete: 18 of 18 openers.
  - This contradicts the comment in `apps/classroom/src/lib/liveAgent.ts` that
    "every path that makes a model speak first is blocked on 3.1 somewhere". That
    comment is now false for the clientContent path on this key; it was not changed
    here.
- **Ephemeral tokens work.**
  - Mint: `POST v1beta/auth_tokens`.
  - Connect: `wss://…v1beta…BidiGenerateContentConstrained?access_token=`.
  - The page's own systemInstruction and tools are honoured **only if the token carries
    a `fieldMask`**. Without one, they are silently dropped.
- **Hinglish comes back in Roman script**: 0 Devanagari characters in 12 of 12 output
  transcriptions.
- **Cost per student turn** early in a class, with the two-pass tool design: US$0.0046–
  0.0066, or Rs 0.44–0.63 at Rs 95.6/$ (the rate in `tools/sql/model_price.sql`).
  - Every generation re-reads the whole context, her own past speech included, as
    audio. The per-turn cost therefore grows with the class (section 5).

## 1. Ephemeral token

**Models this key can use for Live** (`GET v1beta/models`, every model with
`bidiGenerateContent`):
- `gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview`
- `gemini-2.5-flash-native-audio-latest`, `-preview-09-2025`, `-preview-12-2025`
- `gemini-3.5-transcribe-live`, `gemini-3.5-live-translate-preview`,
  `gemini-robotics-er-2-streaming-preview`

Both target ids exist. Input limit is 131072 and output limit 65536 for both.

**Mint** (header `x-goog-api-key`, never a query param):

```
POST https://generativelanguage.googleapis.com/v1beta/auth_tokens      -> 200 (v1alpha: also 200)
{
  "uses": 1,
  "expireTime": "2026-09-30T17:26:37.988Z",
  "newSessionExpireTime": "2026-09-30T17:18:37.988Z",
  "bidiGenerateContentSetup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": { "responseModalities": ["AUDIO"] }
  },
  "fieldMask": "model,generationConfig.responseModalities"
}
-> { "name": "<token: 76 chars, starts \"auth_tokens/\">" }        (the only field returned)
```

- Mint time: 420–792 ms (n=11).
- The docs' REST sample shape `{"liveConnectConstraints": {...}}` is refused:
  `HTTP 400 Invalid JSON payload received. Unknown name "liveConnectConstraints" at 'auth_token': Cannot find field.`
  That name is the SDK's; the REST field is `bidiGenerateContentSetup`.

**Connect:**
- The URL is
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<name>`.
- setupComplete arrived 1142–1821 ms after the socket was created (n=8). The `v1alpha`
  path also reached setupComplete (1195 ms).
- On a raw key, setupComplete took 604–1150 ms (n=18).

**Does the page's own setup survive the token?** The page sent the full setup frame
from section 6 on each token:

| Token body | setupComplete | Her name when asked | `next_move` called | Runs |
|---|---|---|---|---|
| `bidiGenerateContentSetup`, **no fieldMask** | yes | "My name is Gemini." / "I am your AI assistant." | no | 2 of 2 |
| `bidiGenerateContentSetup` + `fieldMask` | yes | "Hello! I am Meera, your science tutor for today." (and the same again) | yes: `{"class":"wrong","misconception_id":"breathing-is-respiration",…}` | 2 of 2 |

- The prompt counts confirm it. In the no-mask session the first turn's prompt was
  319 TEXT tokens; in the fieldMask session it was 764 TEXT tokens (the brief is about
  450).
- The no-mask session still produced outputTranscription frames and a
  sessionResumptionUpdate. So not every page field was dropped. Which fields survive
  is UNVERIFIED beyond those two.
- **The lock holds.** A fieldMask token locked to AUDIO, with a page setup asking for
  `responseModalities: ['TEXT']`, still answered in audio: 11 chunks, no text parts.
- **A one-use token cannot open a second connection.** The socket closed `1011 "Token
  has been used too many times"`, 639–977 ms after the socket was created.
  - A reconnect after goAway, or a resumption, therefore needs a fresh token (or
    `uses` > 1). Resumption with a token was not tried (UNVERIFIED).

## 2. Per model

The setup frame is in section 6. The held question and two misconceptions are in the
brief; each `[CONDUCTOR]` turn is a user turn with `turnComplete: true`.

### Latency (ms, from the send; ≥10 ms of voice = the first chunk of 480+ bytes)

| | 3.8, no `behavior` | 3.8, BLOCKING | 3.1, no `behavior` | 3.1, BLOCKING |
|---|---|---|---|---|
| (a) opener sent → her first voice | 866–1184 (n=3, median 907) | 882–1096 (n=6, median 993) | 567–676 (n=6, median 640) | 596–633 (n=3, median 612) |
| (b) student text sent → toolCall | 510–943 (n=6, median 617) | 528–939 (n=8, median 703) | 486–587 (n=9, median 542) | 500–537 (n=6, median 523) |
| toolResponse sent → first audio | 645–1359 (n=5, median 667) | 586–2162 (n=8, median 755) | 603–1518 (n=9, median 655) | 605–768 (n=6, median 654) |
| whole student turn, response sent at once: sent → her first voice | 1364–1954 (n=3, median 1385) | 1209–2731 (n=5, median 1548) | 1164–2105 (n=6, median 1201) | 1177–1254 (n=4, median 1240) |
| `next_move` called on a student turn | 6/6 | 8/9 | 9/9 | 6/6 |
| audio before the call / while a response was outstanding | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

Notes on the table:
- **Two further 3.8 turns** (no `behavior`) come from the token sessions: toolCall at
  590 and 570 ms, then first audio 909 and 624 ms after the response.
- **One 3.8 turn is missing from its column** (no `behavior`, run 3). The probe's own
  end-of-turn rule cut it short. In its frames the reply's first audio arrived 779 ms
  after the response. The rule was fixed before the last two runs.
- **The tool round costs about 0.5–0.6 s per turn.** Compare the medians: an opener (no
  tool) against a student turn with the call, on the same model and behavior. Her one
  student reply without a call (3.8's skip) started at 796 ms.
- **UNVERIFIED — spoken input.** All input here was typed. With the mic, the server's
  end-of-speech detection adds its own delay, which was not measured.
- **Frame timing.**
  - Replies often begin with a 3-byte audio chunk. The first real chunk follows within
    100 ms.
  - `generationComplete` comes well before her voice would end. For the openers it came
    1.8–2.8 s after the send, for lines of 4.4–6.8 s of audio.
  - `turnComplete` comes at about first audio + audio length, as if paced to real time.
    Examples: 3.1 opener 577 + 4441 = 5018, turnComplete at 5020; 3.8 opener 866 + 4640
    = 5506, turnComplete at 5592.

### What she said

(a) Opener, all 18 of 18 spoke. For example:
- 3.8: "Hello there! When you sprint for a bus, why do you breathe so hard?"
- 3.1: "Hi there! When you sprint for a bus, why do you breathe so hard?"

(b) Classification. Every call classified sensibly, and `student_words` was verbatim
every time:
- "I think breathing gives us energy directly." →
  `{"class":"wrong","misconception_id":"breathing-is-respiration","student_words":"I think breathing gives us energy directly."}`
  on every call.
- "Hmm, I don't know." → `{"class":"dontKnow","student_words":"Hmm, I don't know."}` on
  every call.

After `{move:"probeWhy", say_this:"Ask why they think breathing itself gives energy — do not explain yet.", max_sentences:2}`:
- 3.8: "What makes you think that breathing itself is what provides the energy?" (every
  3.8 reply was one sentence, 13 of 13 outside the token sessions)
- 3.1: "That's interesting! Why do you think breathing gives you energy directly?"
  - 3.1 opens with an acknowledgement.
  - It ran to 3 sentences in 5 of 15 replies, counting on `.?!`.
  - Once, "No problem. Think about what your muscles are doing when you sprint, and what
    they need to do that work. Does that give you a clue?", it drifted from the hint's
    `say_this`.

The 3.8 skip (BLOCKING, "Hmm, I don't know."): no toolCall; she said "Let's think about
it: what do you think our body does with the air we take in?"

### 3.8 without `behavior` versus BLOCKING, frame by frame

Without `behavior` (async) — the call closes its own turn:
```
16353 IN  {"toolCall":{"functionCalls":[{"name":"next_move","args":{"student_words":"Hmm, I don't know.","class":"dontKnow"},"id":"call_1904018"}]}}
16353 IN  {"serverContent":{"generationComplete":true}}
16353 OUT {"toolResponse":{"functionResponses":[{"id":"call_1904018","name":"next_move","response":{"move":"hint","say_this":"…","max_sentences":2}}]}}
16355 IN  {"serverContent":{"turnComplete":true},"usageMetadata":{"promptTokenCount":1526,"responseTokenCount":28,…,"thoughtsTokenCount":67}}
17132 IN  {"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"<6720 bytes>"}}]},"outputTranscription":{"text":"Let's think about "}}}
```

BLOCKING — one open turn. This is 3.1 BLOCKING in run 5; 3.8 BLOCKING and 3.1 without
`behavior` have the same shape:
```
8706  IN  {"toolCall":{"functionCalls":[{"name":"next_move","args":{…},"id":"fc_10038976891777517354"}]}}
8717  OUT {"toolResponse":{"functionResponses":[{"id":"fc_10038976891777517354","name":"next_move","response":{…}}]}}
9338… IN  audio + outputTranscription
10596 IN  {"serverContent":{"generationComplete":true}}
13759 IN  {"serverContent":{"turnComplete":true},"usageMetadata":{"promptTokenCount":2261,"responseTokenCount":158,…}}
```

- 3.1 accepted `behavior: 'BLOCKING'` with no error, so one declaration serves both
  models.
- The docs' `scheduling` field (on the function response) was never sent (UNVERIFIED).

## 3. Hinglish

The brief asked for "Hinglish … Roman script (English letters) only — never Devanagari".
The student turn was `mujhe lagta hai saans lene se energy milti hai`.

- **Script: 0 Devanagari characters** in all 12 output transcriptions (3.8 BLOCKING ×3
  sessions, 3.1 ×3, two turns each).
  - 3.8: "Aapko aisa kyun lagta hai ki sirf saans lene se energy banti hai?"
  - 3.1: "Acha, par saans lene se hi energy kaise milti hai? Thoda aur batao."
  - 3.1's Hinglish was lighter once: "Hey! Batao, when you sprint for a bus, why do you
    breathe so hard?"
- She classified the Hinglish turn `wrong` / `breathing-is-respiration` 6 of 6, with
  `student_words` kept in Roman script.
- **Input transcription:** typed `clientContent` produced **0 inputTranscription
  frames** in every class and Hinglish session (18). `inputAudioTranscription` only
  transcribes audio, so a typed turn's text is whatever the page sent.
- Whether spoken Hinglish input is transcribed in Roman or Devanagari was not measured
  (UNVERIFIED).

## 4. Frames seen

**Top-level keys:** `setupComplete`, `serverContent`, `toolCall`, `usageMetadata`,
`sessionResumptionUpdate`.

**serverContent keys:** `modelTurn`, `outputTranscription`, `generationComplete`,
`turnComplete`.

**Never seen:** `goAway` (every session was under 30 s), `toolCallCancellation`,
`interrupted`, `inputTranscription`.

**Specific frames:**
- `setupComplete` is `{"setupComplete":{}}`.
- Audio mime type is `audio/pcm;rate=24000`.
- A toolCall comes in its own frame, with no serverContent.
- **3.8 sends literal `{}` frames**: raw text `{}\n`, 15–24 per full turn (median 18–19).
  3.1 sent none. `parseServerMessage` already returns no events for them.

**sessionResumptionUpdate** — always `{"newHandle":"<36 chars>","resumable":true}`:
- 3.8 sent **one per session**, about 250–280 ms after the first turn was sent.
- 3.1 sent **3–5 per session**, one after each generation or so.
- Whether 3.8's single early handle resumes the later context is UNVERIFIED, since
  resumption was not exercised.

**usageMetadata** comes with each turnComplete, one frame per generation. Run 2's
frames, whole:

```
3.8, no behavior (opener, then 2 frames per student turn: the call, then the reply)
{"promptTokenCount":1071,"responseTokenCount":120,"totalTokenCount":1191,"promptTokensDetails":[{"modality":"TEXT","tokenCount":779},{"modality":"AUDIO","tokenCount":187}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":120}],"thoughtsTokenCount":90}
{"promptTokenCount":1232,"responseTokenCount":43,"totalTokenCount":1275,"promptTokensDetails":[{"modality":"TEXT","tokenCount":804},{"modality":"AUDIO","tokenCount":307}],"thoughtsTokenCount":114}
{"promptTokenCount":1319,"responseTokenCount":118,"totalTokenCount":1437,"promptTokensDetails":[{"modality":"TEXT","tokenCount":859},{"modality":"AUDIO","tokenCount":307}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":118}],"thoughtsTokenCount":45}
{"promptTokenCount":1475,"responseTokenCount":28,"totalTokenCount":1503,"promptTokensDetails":[{"modality":"TEXT","tokenCount":881},{"modality":"AUDIO","tokenCount":425}],"thoughtsTokenCount":55}
{"promptTokenCount":1558,"responseTokenCount":123,"totalTokenCount":1681,"promptTokensDetails":[{"modality":"TEXT","tokenCount":936},{"modality":"AUDIO","tokenCount":425}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":123}],"thoughtsTokenCount":78}

3.8, BLOCKING (opener, then 1 frame per student turn)
{"promptTokenCount":1071,"responseTokenCount":157,"totalTokenCount":1228,"promptTokensDetails":[{"modality":"TEXT","tokenCount":779},{"modality":"AUDIO","tokenCount":187}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":157}],"thoughtsTokenCount":65}
{"promptTokenCount":2743,"responseTokenCount":139,"totalTokenCount":2882,"promptTokensDetails":[{"modality":"TEXT","tokenCount":1769},{"modality":"AUDIO","tokenCount":688}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":96}],"thoughtsTokenCount":135}
{"promptTokenCount":3163,"responseTokenCount":129,"totalTokenCount":3292,"promptTokensDetails":[{"modality":"TEXT","tokenCount":1909},{"modality":"AUDIO","tokenCount":880}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":101}],"thoughtsTokenCount":137}

3.1, no behavior (no thoughtsTokenCount on 3.1)
{"promptTokenCount":913,"responseTokenCount":112,"totalTokenCount":1025,"promptTokensDetails":[{"modality":"TEXT","tokenCount":607},{"modality":"AUDIO","tokenCount":201}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":112}]}
{"promptTokenCount":2243,"responseTokenCount":154,"totalTokenCount":2397,"promptTokensDetails":[{"modality":"TEXT","tokenCount":1319},{"modality":"AUDIO","tokenCount":626}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":111}]}
{"promptTokenCount":2733,"responseTokenCount":152,"totalTokenCount":2885,"promptTokensDetails":[{"modality":"TEXT","tokenCount":1475},{"modality":"AUDIO","tokenCount":848}],"responseTokensDetails":[{"modality":"AUDIO","tokenCount":124}]}
```

Every usageMetadata frame of every run is in the `--out` JSON. Those files stayed in the
session scratchpad and are not committed.

**What the counts show:**
- **Frames are per generation, not running totals.** responseTokenCount matches that
  turn's audio at about 25 tokens/s: 4640 ms of audio came as 120 tokens.
- **promptTokenCount is the whole context, re-read on every generation:**
  1071 → 1232 → 1319 → 1475 → 1558.
- **Her own past speech stays in the context as AUDIO prompt tokens:** 187 → 307 (+120,
  the opener she just spoke) → 425 (+118).
- **Tokens the details leave out:**
  - The opener's first prompt has 187 (3.8) / 201 (3.1) AUDIO tokens, although no
    audio was sent. Where they come from is UNVERIFIED.
  - 105–153 prompt tokens per frame are in no modality. On the first frame,
    1071 − 779 − 187 = 105.
- **Two passes per student turn.**
  - Without `behavior`, 3.8 reports the call and the reply separately.
  - BLOCKING 3.8 and 3.1 report one frame per student turn. Its promptTokenCount
    (2743, 2243) is close to the two passes added together (1232 + 1319 = 2551). That
    it sums both passes is inferred, UNVERIFIED.
  - A call pass's response tokens (28–43) carry no modality breakdown.
- **Thinking:** 3.8 reports `thoughtsTokenCount` 45–137 per frame, outside
  `totalTokenCount`: 1071 + 120 = 1191. 3.1 reports none.

## 5. Cost

These are the published paid-tier rates per 1M tokens, one row for 3.8 Live and 3.1
Flash Live: text in $0.75, audio in $3.00, text out $4.50, audio out $12.00. Thinking
is priced as text out, which is UNVERIFIED for Live.

| Measured at the start of a class | US$ |
|---|---|
| Opener turn | 0.0025–0.0038 |
| Each student turn (call + reply), context 1–3k tokens | 0.0046–0.0066 (Rs 0.44–0.63 at Rs 95.6/$) |

The student-turn range leaves out one session: its last usage frame never arrived,
because the socket was closed first.

**Projection (UNVERIFIED, a straight-line extrapolation from three turns):**
- **Context growth.** Each typed student turn grew the context by about 243 tokens:
  1232 → 1475 on 3.8's call passes. About 120 of those were her reply's audio.
- **Spoken input** would add about 25 tokens per second of the student's audio, per the
  docs.
- **Two passes per turn.** Every student turn re-reads the context twice. Forty student
  turns re-read about 2 × Σ(1,232 + 243(k−1)) ≈ 0.48M prompt tokens if typed, or about
  0.67M with 5 s of speech per turn.
- **Audio share.** Audio is a rising share of those tokens: 27% after three typed turns.
- **Result.** That comes to **roughly US$0.9–1.5 per 40-turn class (Rs 85–145)** with
  the outputs. That is far over the Rs 5/student-hour ceiling.
- `contextWindowCompression: {slidingWindow: {}}` has a default trigger at 80% of 131k
  tokens (per the docs), so it does not bound this. A low `triggerTokens` would, but
  that was not tried.

## 6. The setup frame that worked

It worked on both models, with and without `behavior`, over both a raw key and a
fieldMask token.

- **No secrets in the frame.** The key rides in the URL (`?key=`) or the token in
  `?access_token=`.
- **Brief.** The systemInstruction text is `brief('en')` in `probe-live.mjs`. The
  Hinglish brief adds a LANGUAGE paragraph.
- **What was left out.** `safetySettings` (which `liveAgent.ts` sends) and
  `temperature` were not in the frame. Whether 3.8 accepts `safetySettings` is
  UNVERIFIED.

```json
{
  "setup": {
    "model": "models/gemini-3.8-live",
    "generationConfig": {
      "responseModalities": ["AUDIO"],
      "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Sulafat" } } }
    },
    "systemInstruction": { "parts": [{ "text": "You are Meera, a warm, patient science tutor for a Class 10 student in India. … After EVERY student message you MUST call the function next_move FIRST, before you say a single word. … Say nothing until next_move answers. Then say ONLY what its `say_this` tells you to, in at most `max_sentences` sentences … THE QUESTION NOW HELD: \"When you sprint for a bus, why do you breathe so hard?\" Known misconceptions for it: - breathing-is-respiration: … - oxygen-is-energy: …" }] },
    "tools": [{ "functionDeclarations": [{
      "name": "next_move",
      "description": "Call this FIRST after every student turn, before saying anything. It reports how you read the turn; its response tells you exactly what to say next.",
      "parameters": {
        "type": "OBJECT",
        "properties": {
          "class": { "type": "STRING", "enum": ["right","partly","wrong","dontKnow","question","hintRequest","explainRequest","offTopic","unclear","chat","stop"], "description": "What the student's turn was, read against the held question." },
          "misconception_id": { "type": "STRING", "description": "For class \"wrong\": the id of the known misconception it matches, if any." },
          "student_words": { "type": "STRING", "description": "What the student said, word for word." }
        },
        "required": ["class"]
      },
      "behavior": "BLOCKING"
    }] }],
    "inputAudioTranscription": {},
    "outputAudioTranscription": {},
    "sessionResumption": {},
    "contextWindowCompression": { "slidingWindow": {} }
  }
}
```

**The turn frames that worked:**
- `{"clientContent":{"turns":[{"role":"user","parts":[{"text":"…"}]}],"turnComplete":true}}`
- `{"toolResponse":{"functionResponses":[{"id":"<call id>","name":"next_move","response":{"move":"probeWhy","say_this":"…","max_sentences":2}}]}}`

## 7. Errors and oddities

1. **REST 400** on the `liveConnectConstraints` token body (section 1).
2. **Token reuse:** close `1011 "Token has been used too many times"`.
3. **No-mask token:** the page's systemInstruction and tools were silently dropped, with
   no error.
4. **3.8 skipped `next_move`** once in 17 turns with tools.
5. **3.8 hallucinated an output transcription** (run 3, BLOCKING opener).
   - After "…why do you breathe so hard?", one frame with **no audio** carried
     `outputTranscription` text of a French paragraph about snake venom: " acides, mais
     il n'est pas le seul. La plupart des espèces de serpents dits "venimeux"…", 518
     characters.
   - The whole turn held 6.4 s of audio, too short for that paragraph as well as the
     English line, so it was not spoken.
   - Captions, and any check that reads her transcript, must not treat
     outputTranscription as a faithful record. 1 of 33 3.8 turns; none in 24 on 3.1.
6. **3.8 joined words** in a transcription once: "…reaches your musclesis there…".

## What driver A should take from this

These follow from the measurements above. How to build each one is not measured.

- Put `behavior: 'BLOCKING'` on every declaration, and make the model id a setting.
- Treat a reply whose first audio arrives with no toolCall since the student's turn as
  the conductor being skipped: note it on the panel, and decide what to do about it.
  Cutting her off with a `turnComplete: true` clientContent and re-asking is what the
  3.8 model page says "unconditionally interrupts"; its effect is UNVERIFIED.
- `generationComplete` means the words are done. `turnComplete` comes about when her
  voice would finish at real-time pace from the first chunk. How that lines up with
  the player's 60 ms lead is UNVERIFIED.
- The relay has to mint the token: `uses: 1` plus a fieldMask, and a fresh token for
  every reconnect.

## Re-running

```
node tools/live-sim/probe-live.mjs --models --env <main checkout>/.env.local          # free
node tools/live-sim/probe-live.mjs --spend --env <…> --out <dir>                       # everything, 1.5 s hold
node tools/live-sim/probe-live.mjs --spend --only 3.8,3.1 --tool-delay 0 --env <…> --out <dir>
```

- One full run cost about US$0.09 by the script's estimate.
- The script starts no new turn once its estimate passes US$0.40.
