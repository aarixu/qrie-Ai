/**
 * THE DRY-RUN ARITHMETIC — PRD-6's numbers, restated, never re-derived.
 *
 * A measured class with three or four generated pictures runs Rs 26 to Rs 32;
 * PRD-4 planned on Rs 25-40. The reconciled planning number the PRDs share is
 * Rs 30 a topic with Rs 26-40 as the uncertainty band (docs/prd/
 * 6-cost-monetisation-ops.md, "the planning number this PRD uses is Rs 30 a
 * topic"). The dry run prints the band, not a fresh opinion: warming Class
 * 9-10 science (~274 topics) should read as roughly Rs 8,200, the same figure
 * the PRDs carry.
 */
export const PER_TOPIC_INR = { low: 26, plan: 30, high: 40 };

export function estimate(count) {
  return {
    count,
    low: count * PER_TOPIC_INR.low,
    plan: count * PER_TOPIC_INR.plan,
    high: count * PER_TOPIC_INR.high,
  };
}
