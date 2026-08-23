/**
 * Provider adapters for the lesson designer. The rest of the tool only ever
 * needs `complete(system, user) → string`, so swapping providers is an env
 * var, never a code change (ARCHITECTURE.md: every external dependency sits
 * behind an adapter). Runs at authoring time only under Node >= 24 — global
 * fetch, no SDK dependency to install.
 */

export interface LlmAdapter {
  complete(system: string, user: string): Promise<string>;
}

/**
 * Models wrap JSON in markdown fences even when told not to. Stripping at the
 * adapter boundary keeps design.ts's contract simple: the reply IS the JSON
 * string, and a parse failure there is a genuine model mistake worth a repair.
 */
export function stripJsonFences(reply: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(reply.trim());
  return fenced ? fenced[1].trim() : reply.trim();
}

export class GeminiAdapter implements LlmAdapter {
  private readonly key: string;
  private readonly model: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY;
    if (!key) throw new Error('GeminiAdapter: set GOOGLE_API_KEY or GEMINI_API_KEY');
    this.key = key;
    this.model = env.GEMINI_MODEL ?? 'gemini-3.7-flash';
  }

  async complete(system: string, user: string): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        // The designer only ever wants JSON; asking the API to enforce the
        // mime type cuts down on fenced or chatty replies before they happen.
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    if (!text) throw new Error('Gemini API: reply contained no candidate text');
    return stripJsonFences(text);
  }
}

export class AnthropicAdapter implements LlmAdapter {
  private readonly key: string;
  private readonly model: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('AnthropicAdapter: set ANTHROPIC_API_KEY');
    this.key = key;
    this.model = env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
  }

  async complete(system: string, user: string): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        // A full lesson is a few thousand tokens; generous headroom while
        // staying inside non-streaming request timeouts.
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (!text) throw new Error('Anthropic API: reply contained no text blocks');
    return stripJsonFences(text);
  }
}

/** Provider choice is an env decision: LLM_PROVIDER = 'gemini' (default) | 'anthropic'. */
export function createAdapterFromEnv(env: NodeJS.ProcessEnv = process.env): LlmAdapter {
  const provider = env.LLM_PROVIDER ?? 'gemini';
  if (provider === 'gemini') return new GeminiAdapter(env);
  if (provider === 'anthropic') return new AnthropicAdapter(env);
  throw new Error(`LLM_PROVIDER must be "gemini" or "anthropic", got "${provider}"`);
}
