/**
 * The image generation boundary. Nano Banana today; any other model behind the
 * same interface tomorrow. Authoring time only — nothing here ever runs in the
 * student app.
 */

export interface GeneratedImage {
  base64: string;
  mimeType: string;
}

export interface ImageModel {
  generate(prompt: string): Promise<GeneratedImage>;
}

export interface NanoBananaOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Model choice, cheapest-that-works first.
 *
 * `nano-banana-pro-preview` is the best quality but has the tightest free-tier
 * quota; the flash image models are the practical default for bulk authoring.
 * Override with IMAGE_MODEL when quality matters more than quota.
 */
const DEFAULT_MODEL = 'gemini-3.1-flash-image';

function resolveKey(explicit?: string): string {
  const key = explicit ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) {
    throw new Error(
      'No API key. Set GEMINI_API_KEY (or GOOGLE_API_KEY) — get one free at https://aistudio.google.com/apikey',
    );
  }
  return key;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

/** Pull the image out of a reply. Text parts often precede it, so scan for the first inlineData. */
export function extractImage(json: unknown): GeneratedImage {
  const doc = json as {
    error?: { message?: string; status?: string };
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  };

  if (doc.error) {
    throw new Error(`Image API error: ${doc.error.status ?? ''} ${doc.error.message ?? ''}`.trim());
  }

  const candidate = doc.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const image = parts.find((p) => p.inlineData?.data);

  if (!image?.inlineData) {
    // A refusal or a text-only reply is a real outcome worth naming precisely,
    // so the author can fix the prompt rather than guess.
    const text = parts.map((p) => p.text ?? '').join(' ').trim();
    const reason = candidate?.finishReason ? ` (finishReason: ${candidate.finishReason})` : '';
    throw new Error(
      `Model returned no image${reason}${text ? `. It said: "${text.slice(0, 200)}"` : '.'}`,
    );
  }

  return { base64: image.inlineData.data, mimeType: image.inlineData.mimeType };
}

export function createNanoBanana(opts: NanoBananaOptions = {}): ImageModel {
  const model = opts.model ?? process.env.IMAGE_MODEL ?? DEFAULT_MODEL;

  return {
    async generate(prompt: string): Promise<GeneratedImage> {
      const key = resolveKey(opts.apiKey);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        },
      );

      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (json as { error?: { message?: string } }).error?.message ?? res.statusText;
        // 429 is the one an author hits constantly on the free tier — say so plainly.
        const hint =
          res.status === 429
            ? ' — free-tier image quota exhausted; wait for the reset or enable billing'
            : '';
        throw new Error(`Image API ${res.status}: ${err}${hint}`);
      }
      return extractImage(json);
    },
  };
}
