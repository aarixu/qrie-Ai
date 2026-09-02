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

/**
 * MOVED. The gate now lives in @ai-tutor/relay, because the browser was the
 * wrong side of the wall for it: a class prepared here is POSTed to /api/class
 * and served to every later student, and a hand-made POST never ran this code
 * at all. Re-exported so there is still exactly one implementation and the
 * prep-time callers keep working unchanged.
 */
export { unsafeMarkup } from '../../relay/src/markup.ts';
