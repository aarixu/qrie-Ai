import { useEffect, useMemo, useRef } from 'react';
import type { Probe } from '@ai-tutor/knowledge-graph';
import { closeSession, logAnswer, openSession } from '../stores/ledger';

/**
 * THE PLACEMENT TEST, WRITTEN DOWN.
 *
 * Like a quiz and unlike a class, this is the UNASSISTED case: no hints, no
 * retries, no tutor talking anybody through it, and deliberately no right/wrong
 * feedback — the screen is measuring, not teaching. So every answer here stands
 * at rung 0, and rung 0 is the only rung that can confirm mastery.
 *
 * It also carries the one lookup this product has always known how to do and
 * has never actually stored. `Probe.misconceptions` is aligned to `options` by
 * index, with an empty string at the correct one, so the distractor a student
 * chose names the wrong idea they hold. `persona`'s StudentContext has had a
 * `namedMisconception` field the whole time, documented as coming from exactly
 * this lookup — and nothing performed it. The map recorded THAT the answer was
 * wrong and never WHY.
 */

export interface DiagnosticLedger {
  answered(probe: Probe, chosenIndex: number | null, ms: number): void;
  finish(): void;
}

/**
 * The wrong idea behind the option they picked.
 *
 * Undefined for a right answer, for a skip, and where the bank names none —
 * the arrays are optional and older banks predate them.
 */
export function misconceptionFor(probe: Probe, chosenIndex: number | null): string | undefined {
  if (chosenIndex === null || chosenIndex === probe.correctIndex) return undefined;
  const named = probe.misconceptions?.[chosenIndex];
  return named && named.trim() !== '' ? named : undefined;
}

export function useDiagnosticLedger(topicRef?: string): DiagnosticLedger {
  const startedAt = useRef(Date.now());
  const closed = useRef(false);

  useEffect(() => {
    openSession({ source: 'diagnostic', topicRef });
    return () => {
      // A placement test abandoned halfway is still evidence about the
      // questions that were answered. Closing it as incomplete keeps those
      // answers attributable to a sitting instead of leaving a session that
      // never ends.
      if (!closed.current) {
        closed.current = true;
        closeSession({ activeMs: Date.now() - startedAt.current, completed: false });
      }
    };
    // One session per mounted test; the screen is mounted once per placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo<DiagnosticLedger>(
    () => ({
      answered(probe, chosenIndex, ms) {
        logAnswer({
          surface: 'tap',
          outcomeIds: [probe.nodeId],
          topicRef,
          probeId: probe.id,
          chosenIndex,
          correct: chosenIndex === probe.correctIndex,
          ms,
          attempt: 1,
          assistanceRung: 0,
          hintsShown: 0,
          // A skip is weak evidence AGAINST rather than no evidence, which is
          // how the belief math already treats it — so it is recorded as a
          // wrong answer that names no misconception, not left out.
          verdict: chosenIndex === probe.correctIndex ? 'right' : 'wrong',
          misconceptionId: misconceptionFor(probe, chosenIndex),
        });
      },
      finish() {
        if (closed.current) return;
        closed.current = true;
        closeSession({ activeMs: Date.now() - startedAt.current, completed: true });
      },
    }),
    [topicRef],
  );
}
