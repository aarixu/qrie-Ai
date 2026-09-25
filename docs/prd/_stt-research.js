export const meta = {
  name: 'curie-stt-options',
  description: 'Find the best no-GPU STT for Hinglish: Indian APIs, Indic-tuned open models, server-CPU inference, usage-shaping - priced against the Rs 5 ceiling, then synthesised into a decision table',
  phases: [
    { title: 'Research', detail: 'five independent lenses, web + repo' },
    { title: 'Synthesise', detail: 'one decision table wired to Rs 5, adversarially checked' },
  ],
}

const GROUND = [
'CONTEXT. Qrie is an AI tutor for Class 6-12 India; students ANSWER BY VOICE',
'in Hinglish (Hindi-English code-switching, Latin script mostly): lines like',
'"wo lamba wala", "B hoga na", "mujhe lagta hai plasma carries karta hai".',
'The ear today: the app records ~10s WAV per answer, POSTs to a relay, relay',
'sends to Deepgram nova-3 (language=multi) via OpenRouter. Measured cost:',
'Rs 0.27 per class of 40 STT-seconds = Rs 0.00675/sec = about Rs 24.3 per',
'hour of AUDIO. A student-hour is 16.55 classes = ~11 min of audio =',
'Rs 4.47/student-hour - which is 90% of the ENTIRE Rs 5/student-hour cash',
'ceiling once every other line is self-hosted or on credits.',
'',
'THE QUESTION: the best ear that needs NO GPU and is best-in-class FOR',
'HINGLISH. Two shapes qualify: (a) self-hosted on a server CPU (a 4-vCPU',
'Piper VPS at ~Rs 2,000/mo already exists in the plan; a bigger box is',
'allowed if priced), (b) a cheaper/better API, especially Indian vendors',
'built for code-switching. Anchor: an API at or under ~Rs 8 per audio-hour',
'puts the ear at or under ~Rs 1.5/student-hour and the ceiling holds easily.',
'',
'MEASURED BASELINES the repo already has (tools/speech/README.md):',
'faster-whisper small-ish on a LAPTOP CPU: 0.30x realtime, Hinglish garbage',
'(avg_logprob -0.79, language misdetected pa at -3.59); Moonshine-tiny:',
'empty strings, English-only; Deepgram nova-3: works, is the Rs 4.47.',
'Confidence thresholds worth preserving in any option: -0.22 good / -0.79',
'bad / -3.59 hopeless - the judge REFUSES unclear rather than guessing,',
'because telling a child who answered right that they are wrong is the worst',
'thing this product can do.',
'',
'HARD REQUIREMENTS for any candidate: (1) real Hinglish code-switch quality,',
'evidence not vibes; (2) a per-utterance confidence signal the caller can',
'refuse on; (3) batch transcription of a ~10s clip in well under ~3s wall',
'time at pilot concurrency (500-student school, bursty); (4) children\'s',
'data - where does audio go, is there a data-processing story compatible',
'with India DPDP and a school acting as fiduciary; (5) price in Rs per',
'audio-hour, written down with its source and date.',
'',
'RULES: cite sources with URLs for every web claim; mark NOT VERIFIED where',
'a number could not be confirmed; prices move - record the as-of date. Do',
'not edit any repo file. Do not call any paid API. Your report is data.',
].join('\n')

const R_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', description: 'api | open-model-cpu | technique' },
          hinglishEvidence: { type: 'string', description: 'Concrete: benchmark, paper, demo, user report - with URL. Or NOT VERIFIED.' },
          priceRsPerAudioHour: { type: 'string', description: 'Rs figure with source+date, or the VPS sizing that replaces it, or NOT VERIFIED.' },
          rsPerStudentHour: { type: 'string', description: 'Derived: price x 11 min audio per student-hour, arithmetic shown.' },
          confidenceSignal: { type: 'string' },
          latency: { type: 'string' },
          childrenData: { type: 'string', description: 'Where audio goes; DPDP posture.' },
          verdict: { type: 'string' },
        },
        required: ['name', 'kind', 'hinglishEvidence', 'priceRsPerAudioHour', 'rsPerStudentHour', 'confidenceSignal', 'latency', 'childrenData', 'verdict'],
      },
    },
    surprises: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['lens', 'candidates', 'surprises', 'summary'],
}

const LENSES = [
  {
    key: 'indian-apis',
    prompt: [
'LENS: INDIAN STT APIs, built for Indian languages and code-switching. This is',
'where best-in-class for Hinglish most plausibly lives. Investigate at least:',
'Sarvam AI (Saarika/Saaras STT), Reverie, Gnani.ai, CoRover/BharatGPT-adjacent',
'offerings, Krutrim (Ola), and any Bhashini-ecosystem commercial APIs. For',
'each: Hinglish/code-mix quality evidence (their own benchmarks AND third',
'party - the AI4Bharat Vistaar benchmark ranks many), price per audio-hour in',
'Rs with source+date, free tiers, confidence/logprob availability in the API',
'response schema (read their API docs, not marketing), latency for ~10s batch',
'clips, data residency (India region?) and DPDP/processor posture, and',
'anything about minors. Also check: does Bhashini itself offer free/subsidised',
'ASR API access for Indian startups, and what are its real rate limits?',
    ].join('\n'),
  },
  {
    key: 'global-apis',
    prompt: [
'LENS: GLOBAL STT APIs on Hindi/Hinglish, priced. ElevenLabs Scribe (note: an',
'ELEVENLABS_API_KEY already sits unused in this project\'s env - so somebody',
'once considered them), OpenAI transcription APIs, Groq-hosted whisper-large-v3',
'(their per-audio-hour price is known to be very low - verify current),',
'Deepgram nova-3 (the incumbent - what is its REAL list price per audio hour,',
'and is the repo overpaying via the OpenRouter middleman?), AssemblyAI, Google',
'Chirp, Azure. For each: Hindi/code-switch benchmark evidence, Rs per',
'audio-hour, confidence fields in the response, batch latency, data residency',
'and children/DPDP posture. CRITICAL comparison: several of these are cheaper',
'than what Qrie pays today through OpenRouter - quantify the middleman tax if',
'there is one, from public prices.',
    ].join('\n'),
  },
  {
    key: 'open-indic-models',
    prompt: [
'LENS: OPEN MODELS TUNED FOR INDIC SPEECH, runnable WITHOUT a GPU. AI4Bharat',
'IndicWhisper and IndicConformer (and their Vistaar benchmark paper - pull the',
'actual Hindi WER numbers and how vanilla Whisper compares), any',
'Hinglish/code-switch fine-tunes on HuggingFace with real eval numbers,',
'shrunk/quantised variants (CTranslate2/ONNX/int8) and their sizes, licences',
'(commercial use?), and what hardware their authors report for CPU inference.',
'Also: Sarvam\'s open-weights releases if any, IIT/IIIT lab models. Be ruthless',
'about evidence: a model card claiming multilingual is not Hinglish evidence;',
'a WER table on Hindi/code-mix test sets is. Note each model\'s output',
'confidence story (CTC/logprob availability).',
    ].join('\n'),
  },
  {
    key: 'cpu-inference',
    prompt: [
'LENS: SERVER-CPU INFERENCE ENGINEERING - can whisper-large-v3 or medium run',
'fast enough WITHOUT a GPU? The repo measured 0.30x realtime, but on a laptop,',
'apparently unquantised, single stream. Find published benchmarks (whisper.cpp',
'and faster-whisper/CTranslate2 issues, blogs, HF discussions) for int8/int5',
'quantised large-v3 / distil-large-v3 / medium on real server CPUs (16-32 vCPU',
'AMD EPYC / Intel, the kind a Rs 2,000-6,000/mo VPS buys - price such VPSes at',
'Hetzner/OVH/Contabo/DO in Rs). Compute: at measured RTF x, with ~11 min of',
'audio per student-hour and a 500-student school\'s bursty timetable, how many',
'concurrent streams does the box sustain and what is the Rs/student-hour of',
'the box amortised at pilot load (2,500 student-hours/mo)? Include VAD',
'trimming (silero) as a technique - the 40s includes silence padding worth',
'cutting. Also quantisation\'s ACCURACY cost on multilingual/code-mix - find',
'evidence, not assumption. And distil-whisper\'s Hindi story specifically',
'(distillation was English-heavy - verify).',
    ].join('\n'),
  },
  {
    key: 'product-shape',
    prompt: [
'LENS: THE REPO, NOT THE WEB. You may read (never edit) the Qrie repo at cwd.',
'Recompute the ear\'s economics from source: tools/measure/model-cost.mjs and',
'last-class.json (EAR_SEC, the 40s), packages/relay/src/gate.ts (0.69',
'units/sec pricing), apps/classroom/src/lib/ear.ts (when the mic opens, the',
'2-miss rule, graceMs), packages/relay/src/relays.ts /api/hear (WAV-only, 2MB',
'cap, language=multi constant). Then quantify the USAGE-SHAPING levers that',
'work with ANY engine: (1) mic on 1 ask instead of 4 - exact Rs/student-hour',
'at vendor price and at a hypothetical Rs 8/audio-hour API; (2) VAD/silence',
'trimming client-side before upload - estimate the real speech fraction of the',
'40s from ear.ts\'s endpointer behaviour (graceMs padding etc.) and state what',
'is measurable vs guessed; (3) opus/16k mono upload instead of WAV - does',
'/api/hear\'s audio/wav-only check block this today, what would change, and',
'does the vendor price by duration or bytes (duration - so this saves',
'bandwidth not money - say so honestly); (4) the tap-first fallback already in',
'the product. Also: what does the judge actually NEED from a transcript',
'(packages/tutor-judge, matchSpokenAnswer) - would a slightly worse transcript',
'with an honest confidence be acceptable given the refuse-on-unclear design?',
'Every number derived, arithmetic shown, file:line cited.',
    ].join('\n'),
  },
]

const SYNTH_SCHEMA = {
  type: 'object',
  properties: {
    table: {
      type: 'array',
      description: 'The decision table, best options first, across all lenses.',
      items: {
        type: 'object',
        properties: {
          option: { type: 'string' },
          rsPerStudentHour: { type: 'string' },
          hinglishConfidence: { type: 'string', description: 'high | medium | low | unknown, with the single best piece of evidence' },
          opsBurden: { type: 'string' },
          dpdpPosture: { type: 'string' },
          killedBy: { type: 'string', description: 'The one fact that would eliminate this option, and whether it is verified.' },
        },
        required: ['option', 'rsPerStudentHour', 'hinglishConfidence', 'opsBurden', 'dpdpPosture', 'killedBy'],
      },
    },
    recommendation: { type: 'string', description: 'Primary + fallback, with the reasoning and what must be benched before committing.' },
    benchAdditions: { type: 'array', items: { type: 'string' }, description: 'Exactly what to add to tools/stt-spike so ONE bench compares the shortlist - CPU lane, API lanes, same corpus, same output format.' },
    contradictions: { type: 'array', items: { type: 'string' }, description: 'Where the five lenses disagreed, and your adjudication.' },
    notVerified: { type: 'array', items: { type: 'string' }, description: 'Every load-bearing claim that still needs checking, so nobody mistakes research for measurement.' },
    summary: { type: 'string' },
  },
  required: ['table', 'recommendation', 'benchAdditions', 'contradictions', 'notVerified', 'summary'],
}

log('Five lenses on the no-GPU Hinglish ear, then one adversarially-checked decision table.')

phase('Research')

const reports = await parallel(
  LENSES.map((l) => () =>
    agent([GROUND, '', l.prompt, '', 'Return 4-8 candidates for your lens (fewer only if the space is genuinely thin), each row complete. surprises = anything that changes the framing of the whole question.'].join('\n'), {
      label: 'stt:' + l.key,
      phase: 'Research',
      schema: R_SCHEMA,
      effort: 'high',
    }),
  ),
)

const found = reports.filter(Boolean)
log(found.length + '/5 lenses reported.')

phase('Synthesise')

const synth = await agent(
  [
GROUND,
'',
'You are the synthesiser and the adversary in one. Five researchers reported',
'below. Build ONE decision table across all of them, priced in Rs/student-hour',
'using the anchor arithmetic (11 min audio per student-hour), and be hostile to',
'every number: recompute each rsPerStudentHour yourself from the quoted',
'per-audio-hour price, flag any price without a source+date as NOT VERIFIED,',
'and where two lenses disagree, adjudicate with reasons. Weight Hinglish',
'EVIDENCE above price - a cheap ear that mishears a child is the worst outcome',
'this product has (the judge tells a child who answered right that they are',
'wrong). Respect the DPDP lens: audio of identifiable children leaving India',
'or entering a vendor with no processor story is a real cost, price it as',
'risk. End with: primary recommendation + fallback, what tools/stt-spike must',
'grow so one bench settles it (the spike already has run.py with the',
'comparable output format, make-corpus.mjs, and the confidence thresholds),',
'and the honest notVerified list.',
'',
'THE FIVE REPORTS:',
JSON.stringify(found, null, 2),
  ].join('\n'),
  { label: 'stt:synthesis', phase: 'Synthesise', schema: SYNTH_SCHEMA, effort: 'high' },
)

return { lenses: found, synthesis: synth }
