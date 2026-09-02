/**
 * THE ONE GATE, and it lives on the SERVER side of the wall.
 *
 * Every picture in a class is inlined into the page with
 * `dangerouslySetInnerHTML`, so it runs in our origin with our student's
 * browser. The posture is: REJECTED, never sanitised. A drawing we do not
 * fully understand is one we do not show, and redrawing is cheap.
 *
 * WHY IT MOVED HERE. It used to live in @ai-tutor/class-prep and was called
 * from the diagram verifier and the icon artist — both of which run in the
 * BROWSER, during preparation. A class is then POSTed to /api/class and served
 * to every later student who opens that topic, and the relay checked file
 * paths, sizes and field types but never the markup. So the gate protected
 * only the traffic that chose to walk through it.
 *
 * That was demonstrated, not theorised: an anonymous identity (free, by
 * design) posted a class whose assets.json held `<svg><g><script>…` and the
 * relay answered 200. The file came back from public storage with the script
 * intact. Any student later opening that topic would have run it, with their
 * own session in the same origin.
 *
 * class-prep re-exports this so there is still exactly one implementation. It
 * is in packages/relay because that is what the Supabase function deploys.
 */

export function unsafeMarkup(src: string): string[] {
  const problems: string[] = [];

  if (/<script[\s>]/i.test(src)) problems.push('contains <script>');
  if (/<foreignObject[\s>]/i.test(src)) problems.push('contains <foreignObject>');
  if (/<(iframe|object|embed|use|image)[\s>]/i.test(src)) problems.push('contains an embedding tag');
  // A tokenizer ends an attribute on whitespace OR a slash, so
  // `<circle r="2"/onclick="x()">` is a live handler that a whitespace-only
  // check walks straight past.
  if (/[\s/]on[a-z]+\s*=/i.test(src)) problems.push('contains an inline event handler');
  if (/javascript:/i.test(src)) problems.push('contains a javascript: URL');

  // A stylesheet can fetch, and it can do it in ways that look nothing like a
  // link: @import, url(), even a font face. We never need one — the board's
  // own styling is ours — so the whole element is refused.
  if (/<style[\s>]/i.test(src)) problems.push('contains <style>');
  if (/@import/i.test(src)) problems.push('contains an @import');

  // An external reference would leak the student's IP to whoever the model
  // decided to link, and would break the moment that host went away. A
  // reference INTO the same document is how gradients and clip paths work, so
  // `#name` stays allowed and everything else does not.
  // Quoted or not: an unquoted href is an ordinary attribute to a parser,
  // and the quoted-only check let one straight through.
  if (/(href|src)\s*=\s*(?:["'](?!#)|(?!["'#\s>]))/i.test(src))
    problems.push('references an external resource');
  if (/url\(\s*["']?(?!#)/i.test(src)) problems.push('references an external resource');

  return problems;
}

/**
 * The only file paths a prepared class is allowed to hold.
 *
 * An allow-list rather than a deny-list, because the deny-list was already
 * one: it refused `..`, a leading slash and a backslash, and let through every
 * extension there is. `saveable()` writes exactly three shapes and nothing
 * else, so anything outside them did not come from this app.
 *
 * `.svg` is deliberately NOT here. The storage bucket serves it as
 * image/svg+xml, which a browser will execute scripts inside if it is ever
 * opened directly — and this app never needs one: diagram markup travels
 * inside assets.json, where the gate above reads it.
 */
const ALLOWED_PATH = /^(lesson\.json|assets\.json|generated\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp))$/;

export const isAllowedClassPath = (path: string): boolean => ALLOWED_PATH.test(path);
