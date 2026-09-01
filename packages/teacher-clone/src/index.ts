// Public surface of @ai-tutor/teacher-clone — one real teacher, cloned.
//
// Three clones make a teacher, and this package holds the two that are pure
// data:
//   the STYLE   (style.ts)    — how they teach, read out of their transcript
//                               and handed to the planner, so the lesson is
//                               PLANNED in their voice, not merely spoken in it
//   the TAKE    (manifest.ts) — which lip-dubbed clip belongs to which beat,
//                               with the recording's own hash discipline
//
// The third clone — their voice — needs no code of its own: whatever wins the
// bake-off goes behind the `TtsAdapter` the classroom already speaks through.
//
// Nothing here renders, fetches or plays. The renderer lives in the app
// (avatar/VideoAvatar.tsx) and the GPU service lives on the VM, so this
// package stays readable by someone who has neither.

export {
  CLIP_DIR,
  CLIP_MANIFEST_FILE,
  clipFileName,
  parseClipManifest,
  type ClipEntry,
  type ClipManifest,
} from './manifest';

export {
  STYLE_SYSTEM,
  parseStyleCard,
  styleBrief,
  styleUser,
  type StyleCard,
} from './style';
