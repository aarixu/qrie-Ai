import type { ImageAdapter, VisionAdapter } from '@ai-tutor/class-prep';

/**
 * The browser's side of the two picture calls: drawing one, and looking at it.
 *
 * Both go through `/api/llm` on our own origin, like everything else — no key
 * ever reaches the bundle. They are here rather than in `browserLlm` because
 * neither is a text completion: one returns an image, the other is given one.
 */

interface Reply {
  choices?: {
    message?: { content?: string; images?: { image_url?: { url?: string } }[] };
  }[];
  error?: { message?: string };
}

async function ask(body: unknown): Promise<Reply> {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Reply;
  if (!res.ok) throw new Error(`LLM ${res.status}: ${data.error?.message ?? res.statusText}`);
  // OpenRouter reports upstream failures as a 200 with an error body.
  if (data.error) throw new Error(data.error.message ?? 'unknown LLM error');
  return data;
}

/**
 * Draws a picture and hands back a `data:` URL.
 *
 * Null rather than a throw when the model answered but drew nothing: that is a
 * class with one fewer picture, which the caller already knows how to survive.
 */
export function createBrowserImageArtist(model: string): ImageAdapter {
  return {
    async draw(prompt: string): Promise<string | null> {
      const data = await ask({ model, messages: [{ role: 'user', content: prompt }] });
      return data.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? null;
    },
  };
}

/**
 * Looks at a picture and answers about it.
 *
 * The picture goes back up as the `data:` URL it already is. It is half a
 * megabyte over a loopback connection, which costs nothing worth counting, and
 * it means nothing has to be stored anywhere to be looked at.
 */
export function createBrowserVision(model: string): VisionAdapter {
  return {
    async look(imageUrl: string, system: string, user: string): Promise<string> {
      const data = await ask({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: user },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      });
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) throw new Error('The model looked and said nothing.');
      return text;
    },
  };
}
