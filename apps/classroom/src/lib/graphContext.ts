import type { GraphIndex, ModelParams } from '@ai-tutor/knowledge-graph';
import { loadDiagnosticDataFor } from './diagnosticData';
import { modelStore } from '../stores/model';
import { profileStore } from '../stores/profile';
import { settingsStore } from '../stores/settings';
import { klassOf } from '../stores/settings';

/**
 * THE MAP AND THE CALIBRATION THIS STUDENT IS BEING MODELLED AGAINST.
 *
 * `lib/adaptPlan.ts` and the placement screen each assembled these three lines
 * for themselves. The learner model needs the same pair on every recorded
 * event, and a third copy of the same reasoning is how the four different
 * class-resolution strategies already in this app came about — so it is one
 * function now, and the two existing callers can move onto it whenever they are
 * next touched.
 *
 * Null when the student's class is unknown or their map is not loadable. That
 * is an ordinary state and not an error: a free-text topic and a brought file
 * both teach for real and have no outcomes behind them.
 */
export function currentIndex(): GraphIndex | null {
  const profile = profileStore.get();
  const klass = klassOf(settingsStore.get(), profile);
  if (klass === null) return null;
  const data = loadDiagnosticDataFor(klass, profile.subjects);
  return data ? (data.index as GraphIndex) : null;
}

/**
 * The trained slip and guess per probe, and edge trust. Empty until a placement
 * test has trained it, which is the honest default: `emptyParams()` means "use
 * the priors", and the priors are the file's own stated position that these are
 * numbers we are prepared to be wrong about.
 */
export function currentParams(): ModelParams {
  return modelStore.get();
}
