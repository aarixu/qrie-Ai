/**
 * BUILD ONE TEACHER'S STYLE CARD.
 *
 *   npm run style-card -- --transcript clone-source/derived/ap-sir.txt \
 *                         --board "notes on what their board looks like" \
 *                         --out clone-source/derived/ap-sir.card.json
 *
 * TWO KINDS OF EVIDENCE, AND WHY BOTH.
 *
 * The transcript says how they TALK — their words, their language mix, their
 * questions. It says nothing at all about the board, because a transcript
 * cannot see one. And for these two teachers the board is half the lesson:
 * one of them fills a divided whiteboard with numbered cases, labelled ray
 * diagrams and boxed results; the other writes a title and then draws, live,
 * while he speaks.
 *
 * So the board evidence comes in separately, written by whoever WATCHED the
 * video. Free, and more accurate than a vision model guessing from four
 * sampled frames.
 *
 * The card goes into the planner (`styleBrief`), never to the student.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseStyleCard, STYLE_SYSTEM, styleBrief, styleUser } from '@ai-tutor/teacher-clone';

/** The model that reads a transcript. The planner's own, so one bill, one behaviour. */
const MODEL = 'google/gemini-3.7-flash';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function keyFromEnvFile(): string {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const found = /OPENROUTER_API_KEY=(\S+)/.exec(fs.readFileSync(envPath, 'utf8'));
  if (!found) throw new Error('No OPENROUTER_API_KEY in .env.local');
  return found[1];
}

async function complete(system: string, user: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${keyFromEnvFile()}`,
      'X-Title': 'Curie',
    },
    body: JSON.stringify({
      model: MODEL,
      // Capped for the same reason the dev relay caps: OpenRouter
      // pre-authorises the model's whole context, and an open request 402s
      // on a low balance even though the reply is a few hundred tokens.
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(data.error.message ?? 'unknown LLM error');
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('The model replied with nothing.');
  return text;
}

async function main(): Promise<void> {
  const transcriptPath = arg('transcript');
  const outPath = arg('out');
  const boardNote = arg('board');
  if (!transcriptPath || !outPath) {
    throw new Error('Usage: --transcript <file> --out <file> [--board "<what their board looks like>"]');
  }

  const transcript = fs.readFileSync(path.resolve(transcriptPath), 'utf8').trim();
  if (transcript.length < 200) {
    throw new Error(`That transcript is ${transcript.length} characters. Something went wrong upstream.`);
  }

  const user = boardNote
    ? `${styleUser(transcript)}\n\nWHAT THEIR BOARD LOOKS LIKE — written by someone who watched the video, since a transcript cannot see a board. Use this for the "board" field:\n\n${boardNote}`
    : styleUser(transcript);

  process.stdout.write(`Reading ${transcript.split(/\s+/).length} words of teaching…\n`);
  const card = parseStyleCard(await complete(STYLE_SYSTEM, user));

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(card, null, 2)}\n`);

  process.stdout.write(`\n${styleBrief(card)}\n\nWritten to ${outPath}\n`);
}

void main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
});
