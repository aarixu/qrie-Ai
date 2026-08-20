# AI Tutor — Design Spec

**Date:** 2026-08-20
**Status:** Approved for planning

## Vision

A live class, not a chatbot. A student joins what feels like a video call. An AI teacher is already there. She explains using a 3D stage — rotating and slicing open a human heart, writing notes, pointing at structures — while speaking naturally, handling interruptions, and choosing *how* to explain based on what the student understands.

## v1 Scope

One complete lesson, end to end: **Human Heart & Circulation**, NEET-track Class 11–12 biology, ~20–30 minutes, deliverable to a real student.

Delivery language: English with Hinglish register.

## Locked Decisions

| Decision | Choice | Why |
|---|---|---|
| Subject wedge | Biology / anatomy | Plays to TRELLIS.2 + Z-Anatomy interior-structure strength; most visually differentiated |
| Learner | Class 11–12, NEET-track | Fixed enumerable scope, clear success metric, correct depth |
| Approach | **B — scored lesson, live performance** | Visual spine authored (always correct), delivery live (always feels alive). Lesson #2 becomes authoring, not engineering |
| Devices | Responsive — phone + desktop | NEET market in India is phone-heavy |
| Avatar | Viseme, self-hosted | Managed avatar APIs cost ₹185–975/class; unviable at Indian price points |
| Modalities in v1 | 3 — 3D structural, Notes page, Socratic | Scoped for speed. Quantitative is a ~half-day add later, no architecture change |
| Student camera | **None** | Focus tracking dropped, so the video track has no purpose. Saves battery, bandwidth, privacy exposure, screen space |

## Architecture

```
BROWSER (student)                    SERVER                      EXTERNAL
classroom-shell  <---WebRTC--->  LiveKit SFU
 |- teacher tile (viseme avatar)
 |- captions                     tutor-agent (Python)  <----->  Gemini Live
 |- mic indicator                 |- beat-sheet runner          gemini-3.1-
 |- THE STAGE                     |- tool handlers              flash-live-preview
     |- 3D viewport (Three.js)    |- stage-state mirror
     |- image / notes layer       |- checkpoint capture
     |- anchor registry
     |- annotation layer   <--DataChannel-->
     |- caption overlay

                                 Asset CDN -- pre-baked glTF + images
```

Offline pipeline (authoring time only, never at runtime):

```
Z-Anatomy .blend -> cull -> glTF w/ named nodes -> Draco -> CDN
TRELLIS.2 -------> long-tail props -----------> glTF -----> CDN
Nano Banana Pro -> notes pages, illustrations -> WebP -----> CDN
```

### Core principles

1. **The Stage is a state machine, not a command sink.** The agent calls `focus("left_ventricle")`, never `draw_circle(340, 210)`. Invalid states are unrepresentable — she cannot point at nothing.
2. **State flows both ways.** A compact mirror (`STAGE: heart.glb | cam=anterior | cut=coronal | lit=[LV_wall] | notes=3 lines`) is kept in her context. Without it she says "as you can see" to a blank screen.
3. **Visual leads, voice follows.** Declared transitions fire ~300ms *before* the cue phrase. Chasing her voice loses on a 200–500ms round trip.
4. **Zero generation at runtime.** All heavy assets pre-baked. During class, everything is a CDN fetch.
5. **One thing moves at a time.** Pedagogical, not technical. Simultaneous motion means nothing is emphasised.
6. **Beats declare intent, not layout.** `intent: compare` resolves to SPLIT on desktop and two sequential moments on phone. One beat sheet, both devices.

## Components

| Component | Responsibility | Depends on |
|---|---|---|
| `stage-client` | Layered canvas, anchors, annotation, transitions | `stage-protocol` |
| `classroom-shell` | LiveKit room, tiles, captions (fork LiveKit Meet) | LiveKit JS |
| `tutor-agent` | Live model session, beat runner, tool handlers | `stage-protocol`, `lesson-format` |
| `stage-protocol` | Shared tool schema + state-mirror format | — |
| `lesson-format` | Beat sheet schema + Heart & Circulation lesson | — |
| `asset-pipeline` | Offline mesh/image bake -> CDN | — |
| `avatar` | Viseme lip-sync behind a swappable interface | — |

`stage-protocol` is the keystone: the only thing `stage-client` and `tutor-agent` share, so both can be built and tested against it independently.

## The Stage

Six composited layers:

```
5  CAPTIONS + EQUATIONS   (DOM, KaTeX)
4  ANNOTATION             (SVG - pointer, arrows, highlight)
3  HANDWRITING            (SVG stroke animation, Kalam font)
2  NOTES / IMAGES         (Nano Banana, composed by us)
1  3D VIEWPORT            (Three.js WebGL)
0  PAPER / BACKDROP
```

Four modes: `EXPLORE` (3D dominant), `NOTES` (notes dominant, 3D as PiP), `SPLIT` (side by side), `FOCUS` (one thing fullscreen). Phone collapses SPLIT into sequential FOCUS moments. Transitions ~400ms.

### Unified anchor space

Everything on the stage is an anchor, regardless of source:

```
left_ventricle      -> mesh:heart.glb#LV
notes.diagram.aorta -> image:notes_p1.webp @ bbox
notes.line_3        -> text-run
```

`focus(id)` works from any mode. If the anchor is not currently visible, the Stage transitions mode automatically. This is why `point_at` can never fail.

### Notes pages are composed, not flat

| Element | Produced by | Why |
|---|---|---|
| Paper texture, ruling | Nano Banana, once | Reused across all lessons |
| Hand-drawn diagram | Nano Banana, per lesson | What it is genuinely best at |
| **Labels and text** | **Us, handwriting font** | Spelling must be correct every time |
| Layout / placement | **Us** | So we know where everything is, for pointing |

A NEET student memorising `tricupsid` instead of `tricuspid` is active harm. Text is never generated.

## Lesson Format: concepts with multiple explanations

The beat sheet is not a linear script. Each **concept** carries several **explanations** in different modalities, and the live model chooses which to reach for based on what it just heard.

```yaml
concept:
  id: lv_wall_thickness
  objective: "Student can explain why the LV wall is thicker than the RV wall"
  must_hit: true

  explanations:
    - id: structural_3d
      modality: 3d_structural
      stage: { cut: coronal, compare: [LV_wall, RV_wall] }
      points: ["Same blood volume, different distance"]

    - id: notes_circuit
      modality: notes_page
      stage: { image: notes_circulation.webp }
      points: ["Systemic loop vs pulmonary loop"]

    - id: socratic
      modality: dialogue
      stage: { hold }
      points: ["Ask: what if the RV wall were just as thick?"]

  strategy:
    default:     structural_3d
    on_confused: [notes_circuit, socratic]
    on_wrong:    [socratic, notes_circuit]

  checkpoint:
    ask: "So why is the LV wall thicker?"
    accepts:
      - "has to pump to the whole body"
      - "needs higher pressure"
      - "systemic circulation is longer"
```

`points` are bullets, not a script. She speaks in her own words. **What appears is fixed. How she says it is live.**

This is *improvisation within a validated repertoire* — flexible, but it cannot go wrong. It also delivers the original "adapts teaching style" ambition without focus tracking or any ML engine.

### Agent loop

```
BEFORE CLASS
  1. Load beat sheet
  2. Push asset manifest to client -> browser prefetches during lobby
  3. Build system prompt: persona + lesson overview + first concept
  4. Wait for student

PER CONCEPT
  5. Inject concept into agent context
  6. Stage silently establishes prereq state before she speaks
  7. She talks, in her own words
  8. Cue phrase approaching -> stage fires action with lead_ms
  9. Stage -> agent: state mirror updated
 10. Checkpoint: she asks, waits
 11. Student answers -> she calls record_checkpoint(id, verdict)
 12. PASS -> next concept | WRONG/CONFUSED -> strategy branch

ANYTIME
  - Student interrupts -> Gemini Live barge-in -> she answers -> resume
  - Stage frozen during interruption
```

Checkpoint judging is semantic, done in-context by the live model (it just heard the answer — cheapest and most natural judge). Transcripts are logged for later batch re-scoring and analytics.

## Assets & Licensing

| Asset | Licence | Obligation |
|---|---|---|
| Z-Anatomy meshes | **CC-BY-SA 4.0** | Attribution + modified meshes stay CC-BY-SA. **Does not touch our code** |
| TRELLIS.2 | MIT | None |
| Nano Banana output | Google gen-AI terms | SynthID watermark embedded; commercial use fine |
| Kalam / Caveat fonts | SIL OFL | Free, commercial OK. Kalam covers Devanagari |
| NCERT content | **Not openly licensed** | Teach the concepts, never reproduce text or diagrams verbatim. Facts are not copyrightable; expression is |
| Past NEET questions | NTA copyright | Write original questions in NEET pattern; do not reproduce |

Z-Anatomy's ShareAlike is a deliberate accepted trade: our modified heart meshes are redistributable by others; the app, code, beat sheets, and notes pages remain ours. Meshes are commodity; the teaching system is not.

A mapping table translates Terminologia Anatomica node names (`Ventriculus sinister`) to NCERT anchor IDs (`left_ventricle`).

## Error Handling

| Failure | Behaviour |
|---|---|
| Asset load fails | Stage falls back (notes page instead of 3D), she adapts. **Never a blank screen** |
| Gemini Live disconnects | Stage freezes, reconnect with context replay, "one second..." |
| Anchor fails to resolve | Stage returns error to agent, she covers verbally. **Never points at nothing** |
| Student silent at checkpoint | ~8s timeout -> gentle prompt -> then she supplies the answer |
| Slow network | Lobby prefetch, mobile LOD |
| Malformed tool call | Schema validation rejects, error returned to model |

## Testing

1. **Stage protocol unit tests** — every tool call to expected state. No AI, deterministic, milliseconds.
2. **Anchor coverage test** — every anchor in every beat sheet must resolve in the real glTF. Catches the primary failure mode at build time. Most important test in the suite.
3. **Beat sheet lint** — every concept has >=1 explanation, every branch target exists, every referenced asset is in the manifest.
4. **Replay harness** — record real sessions (tool calls + timestamps), replay headlessly, assert stage states. Regression testing without live API spend.
5. **Scripted student** — a second agent playing *confused* / *distracted* / *already knows it*, running the class end to end. Proves branching works.
6. **Human run-through** — no substitute.

## Out of Scope for v1

Focus/attention tracking · Curriculum engine · Multi-lesson adaptation · Student accounts, auth, payments · Multiple students per room · Lesson authoring UI (beat sheets are hand-written YAML) · Photoreal avatar · Regional languages · The other 7 modalities · Progress dashboards

## Open Risks

| Risk | Mitigation |
|---|---|
| **Z-Anatomy heart may lack interior geometry** — the entire cutaway demo depends on it | 2-hour spike in Blender before anything else. Fallback: TRELLIS.2 or a paid model |
| Narration/visual sync feels off despite lead_ms | Tune per-cue; worst case, pre-declare longer leads |
| Gemini Live cost per 30-min class | Measure in Phase 2; approach C (pre-rendered spine) held in reserve as a cost lever |
| Mobile thermal throttling over 30 min | 30fps cap, 50k LOD, no student video track |
