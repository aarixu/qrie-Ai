import { MODEL_VERSION, emptyConceptState, emptyModel, type ConceptState, type LearnerModel } from './types.ts';

/**
 * A STORED MODEL FROM AN OLDER VERSION, BROUGHT FORWARD RATHER THAN WIPED.
 *
 * `foldSession` starts a model of another version from empty, which is right
 * when the ledger is there to rebuild it from. On a device with no cloud — or
 * a rebuild that failed — that empty model was then SAVED over the only copy
 * of the student's history (overnight review #14). This is the fallback when a
 * rebuild is not possible: keep every number the old model held and give the
 * fields it did not have their empty defaults.
 *
 * What it cannot undo: a v1 model credited hinted answers at full weight, and
 * that credit stays until a rebuild from the ledger replaces it. Keeping an
 * over-credited history is the lesser loss than keeping none.
 *
 * Returns the model unchanged when it is already current, and an empty one for
 * anything that is not a model at all, or comes from a NEWER version (an older
 * app must not guess at a shape it has never seen).
 */
export function migrateModel(stored: unknown): LearnerModel {
  if (!stored || typeof stored !== 'object') return emptyModel();
  const model = stored as Partial<LearnerModel>;
  if (model.version === MODEL_VERSION) return model as LearnerModel;
  if (typeof model.version !== 'number' || model.version > MODEL_VERSION || !model.states || typeof model.states !== 'object') {
    return emptyModel();
  }
  const states: Record<string, ConceptState> = {};
  for (const [id, raw] of Object.entries(model.states)) {
    if (!raw || typeof raw !== 'object') continue;
    states[id] = { ...emptyConceptState(id), ...(raw as Partial<ConceptState>), outcomeId: id };
  }
  return {
    states,
    foldedThrough: model.foldedThrough ?? null,
    helpInFlight: null,
    version: MODEL_VERSION,
  };
}
