// Public surface of @ai-tutor/class-prep. See README.md for the contract.
export { prepareClass, assemble, parsePlan, type LlmAdapter, type PrepOptions } from './prepare';
export { verifySvg } from './verify';
export { PLANNER_SYSTEM, ARTIST_SYSTEM, plannerUser, artistUser, repairUser } from './prompts';
export type {
  Blueprint,
  VisualBrief,
  VisualOutcome,
  PrepReport,
  PrepResult,
  PrepPhase,
  PrepProgress,
} from './types';
export { pickIcons, ICON_PICKER_SYSTEM, iconPickerUser, type IconOption, type IconChoice } from './icons';
export { drawMissingIcons, verifyIconSvg, ICON_ARTIST_SYSTEM, iconArtistUser } from './drawIcon';
export { unsafeMarkup } from './safety';
