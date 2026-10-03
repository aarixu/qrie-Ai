# The avatar: switched off (2026-10-03)

Aarav, 2026-10-03: "avatar side ko delete mat karna, ise baad me use kar sakte
hain; bas abhi disable karke sirf bloub ka use karo."

No screen a student reaches renders any face in this folder or
`ui/TutorTile.tsx`. The Bloub (`src/bloub/Bloub.tsx`) stands in for her on
every screen that showed one of them (listed below). The code, its tests and its
assets are kept as they were, for later.

## What is kept

| File | What it is |
|---|---|
| `HumanAvatar.tsx` | Meera in 3D (Rocketbox F02, three.js). Assets: `content/avatars/f02/`. |
| `CartoonAvatar.tsx` | The penguin. |
| `PhotoAvatar.tsx` | A photo face. Nothing imported it even before the switch-off. |
| `VideoAvatar.tsx`, `clips.ts` | A real teacher, lip-dubbed (`@ai-tutor/teacher-clone`). |
| `visemes.ts`, `rig.ts`, `microMotion.ts` | Lip-sync, blinks and sway for the faces. |
| `../ui/TutorTile.tsx` | The tile that framed a face. Its room: `content/avatars/backgrounds/room3d.webp`. |

The assets are still published under `/app/avatars/`, because `content/` is the
site's publicDir. Nothing requests them while the faces are not rendered, and the
service worker does not precache them.

## What is NOT switched off

`avatarBus.ts` is her voice's own audio context and analyser:

- `unlockAudio` unlocks audio on the first tap (`main.tsx`).
- `avatarPcmOutput` and `announceLine` are used by `lib/lessonVoice.ts`.
- `level` is read by the Bloub.

Her voice plays through it, so it stays live.

## Where the faces were shown, to bring them back

- **The class** (`screens/ClassRoom.tsx`): `TutorTile` as `pip`, `rail` or `fill`, last in `3e0cd62` and removed in `847b1ab` (with the `clone` prop and the `tile` value it passed). The full-screen board layout that replaced it has no slot for a tile, so bringing it back there is layout work, not a switch.
- **The trial page** (`screens/contest/TrialConsent.tsx`) and **enrol** (`screens/contest/Enrol.tsx`): `<TutorTile mode="teaching" variant="pip" />`.
- **Sign-in** (`screens/SignIn.tsx`): `<CartoonAvatar pose={awaiting ? 'point' : 'greet'} />`.

`/avatar-lab` (`screens/AvatarLab.tsx`) still renders the penguin and Meera in 3D, for working on them. The route exists only in dev builds (`App.tsx`, `import.meta.env.DEV`), and no screen links to it.
