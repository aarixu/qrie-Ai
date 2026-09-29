-- PRICES FOR THE MODELS QRIE ACTUALLY CALLS.
--
-- This is operator data, not a migration: prices are a fact about somebody
-- else's contract, and the person who pays the bill is the person who
-- confirms them. Read it, change the rate or a number if the provider page
-- says otherwise today, then apply it one of two ways — paste it into the
-- Supabase SQL editor, or run `node tools/bin/apply-prices.mjs`, which reads
-- THIS file, shows the diff against the live table, and inserts nothing
-- until you type --yes. Neither path decides a number; both carry yours.
-- Every applied row is a NEW row (effective_from is part of the key), so
-- re-applying after a price change re-prices only what comes after —
-- history keeps the price it was billed at. (tools/prewarm reads this file
-- too, to price the token counts the relay reports into its per-topic
-- spend line.)
--
-- Sources, checked 2026-09-13:
--   gemini-3.7-flash   $0.75 / $3.75 per M tokens (intro; DOUBLES 2027-01-01)
--                      cloudzero.com/blog/google-vertex-ai-pricing
--   gemini-3.8-flash   $0.75 / $3.75 per M (list $1.50 / $7.50)
--                      requesty.ai/models/vertex/gemini-3.8-flash
--   gemini-3.1-flash-lite  $0.25 / $1.50 per M
--   gemini-3.1-flash-image $0.50 / $2.00 per M text tokens
--                      requesty.ai/models/vertex/gemini-3.1-flash-image
--   deepgram/aura-2    $30 per M characters      openrouter.ai/deepgram/aura-2
--   deepgram/nova-3    $0.0043 per audio minute   openrouter.ai/deepgram/nova-3
--   USD/INR            95.6 on 2026-09-11         bookmyforex.com, bloomberg.com
--
-- Thinking tokens are billed AS OUTPUT on Gemini 3.x ("reason internally
-- before answering, at full output rates"), so thought_token rows equal the
-- output rate. The relay records them separately so the split stays visible.
--
-- THE IMAGE MODEL IS THE OPEN QUESTION. No page lists a per-image price for
-- gemini-3.1-flash-image; Gemini image models have historically billed a
-- generated picture as output tokens (roughly 1,300 per image), in which case
-- the output_token row already carries it and an `image` row would DOUBLE
-- COUNT. The relay records both `images` and `output_tokens`, so the first
-- real class through the deployed relay settles it: if candidatesTokenCount
-- jumps by ~1,300 per picture, leave the image row at 0. The measured figure
-- before any of this was about Rs 5.75 per picture, which is what the credit
-- price should assume until the row is confirmed.
--
-- Note the Vertex spend is drawn from Google Cloud CREDITS today. These rows
-- price what a class WOULD cost, which is the right number to price a credit
-- against; it is not yet what is being paid.

\set rate 95.6

insert into public.model_price (provider, model, unit, inr_per_unit, note) values
  -- Gemini 3.7 Flash — the planner, the artist, the vision check, the judge
  ('vertex', 'gemini-3.7-flash', 'prompt_token',  0.75 / 1e6 * :rate, 'intro rate; doubles 2027-01-01'),
  ('vertex', 'gemini-3.7-flash', 'output_token',  3.75 / 1e6 * :rate, 'intro rate; doubles 2027-01-01'),
  ('vertex', 'gemini-3.7-flash', 'thought_token', 3.75 / 1e6 * :rate, 'thinking is billed as output'),

  -- Gemini 3.8 Flash — allowed by the relay, not yet used by the app
  ('vertex', 'gemini-3.8-flash', 'prompt_token',  0.75 / 1e6 * :rate, 'discounted from $1.50 list'),
  ('vertex', 'gemini-3.8-flash', 'output_token',  3.75 / 1e6 * :rate, 'discounted from $7.50 list'),
  ('vertex', 'gemini-3.8-flash', 'thought_token', 3.75 / 1e6 * :rate, 'thinking is billed as output'),

  -- Gemini 3.1 Flash Lite — the icon picker
  ('vertex', 'gemini-3.1-flash-lite', 'prompt_token',  0.25 / 1e6 * :rate, null),
  ('vertex', 'gemini-3.1-flash-lite', 'output_token',  1.50 / 1e6 * :rate, null),
  ('vertex', 'gemini-3.1-flash-lite', 'thought_token', 1.50 / 1e6 * :rate, 'thinking is billed as output'),

  -- Gemini 3.1 Flash Image — the pictures on the board
  ('vertex', 'gemini-3.1-flash-image', 'prompt_token', 0.50 / 1e6 * :rate, null),
  ('vertex', 'gemini-3.1-flash-image', 'output_token', 2.00 / 1e6 * :rate, 'a generated picture is believed to be billed HERE, as tokens'),
  ('vertex', 'gemini-3.1-flash-image', 'image',        0,                    'ZERO on purpose - see the header; raise only if measurement shows images are not token-billed'),

  -- Gemini 3.1 Flash TTS — her voice, on Vertex (the only voice since 2026-09-28)
  -- (packages/relay/src/vertexSpeech.ts). $1/M text in, $20/M audio out,
  -- checked 2026-09-28 (openrouter.ai/google/gemini-3.1-flash-tts-preview,
  -- getmaxim.ai/bifrost Vertex calculator). Measured ~32 audio tokens/second.
  ('vertex', 'gemini-3.1-flash-tts-preview', 'prompt_token', 1.00 / 1e6 * :rate, 'her voice; text in'),
  ('vertex', 'gemini-3.1-flash-tts-preview', 'output_token', 20.00 / 1e6 * :rate, 'her voice; audio out, ~32 tokens/s'),

  -- Speech, through OpenRouter (Vertex is credits; this is real money)
  ('openrouter', 'deepgram/aura-2', 'character',    30 / 1e6 * :rate,        'the tutor voice, per character of text'),
  ('openrouter', 'deepgram/nova-3', 'audio_second', 0.0043 / 60 * :rate,     'the ear, per second of audio; multilingual is $0.0052/min');

-- What the relay records the OpenRouter llm fallback as. Only the dev server
-- reaches it (Vertex serves students), so it is priced at zero rather than
-- guessed, and it shows as unpriced-by-choice in the report.
-- (No rows: an absent price is reported as UNPRICED, which is the honest state.)

select provider, model, unit, round(inr_per_unit, 9) as inr_per_unit, note
  from public.model_price
 order by provider, model, unit;
