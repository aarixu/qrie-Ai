/**
 * THE ONE GATE.
 *
 * Every picture in a class is written by a model and inlined into the page, so
 * it runs in our origin with our student's browser. The posture is the same
 * everywhere: REJECTED, never sanitised. A drawing we do not fully understand
 * is one we do not show, and redrawing is cheap.
 *
 * This lived in two places — the diagram verifier and the icon artist — and
 * the two had already drifted: a `<style>` block carrying `@import` or a
 * `url()` sailed through both, because each had been written thinking about
 * tags and attributes rather than about every way markup reaches the network.
 * One gate, one place to fix, both callers safer than either was.
 */

export function unsafeMarkup(src: string): string[] {
  const problems: string[] = [];

  if (/<script[\s>]/i.test(src)) problems.push('contains <script>');
  if (/<foreignObject[\s>]/i.test(src)) problems.push('contains <foreignObject>');
  if (/<(iframe|object|embed|use|image)[\s>]/i.test(src)) problems.push('contains an embedding tag');
  if (/\son[a-z]+\s*=/i.test(src)) problems.push('contains an inline event handler');
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
  if (/(href|src)\s*=\s*["'](?!#)/i.test(src)) problems.push('references an external resource');
  if (/url\(\s*["']?(?!#)/i.test(src)) problems.push('references an external resource');

  return problems;
}
