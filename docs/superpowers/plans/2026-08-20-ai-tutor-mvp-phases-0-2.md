# AI Tutor MVP (Phases 0–2) Implementation Plan

> **Not the current plan.** Since 2026-09-26 the one final plan and the living
> status are [`docs/handoff/2026-09-26-state-of-play.md`](../../handoff/2026-09-26-state-of-play.md). Where this file
> disagrees with it, that file wins. Kept as a record.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the eye-catcher MVP — a live AI biology teacher who narrates a 3D human heart, slices it open in sync with her speech, and answers interruptions.

**Architecture:** A React web app hosts *the Stage* — a Three.js viewport driven by a pure state machine. A Python LiveKit agent runs Gemini Live and emits `StageCommand` messages over a LiveKit data channel; the client reduces them into `StageState` and renders. A JSON Schema in `protocol/` is the single source of truth for both sides, so a malformed command is rejected before it can produce an invalid stage.

**Tech Stack:** Vite · React 18 · TypeScript · Three.js · Vitest · Python 3.11 · livekit-agents · livekit-plugins-google · Gemini Live (`gemini-3.1-flash-live-preview`) · Blender 4.x (headless, asset pipeline only) · pytest

**Spec:** `docs/superpowers/specs/2026-08-20-ai-tutor-design.md`

## Global Constraints

- **Node.js ≥ 20**, **Python 3.11+**. Dev machine is Windows; every shell command below is given for **Git Bash** (the repo's default shell). PowerShell venv activation is `.\.venv\Scripts\Activate.ps1`.
- **The Stage is a state machine, not a command sink.** No task may add a rendering call that bypasses `applyCommand`. Commands name anchors (`"left_ventricle"`), never coordinates.
- **Anchor IDs are NCERT-style snake_case** (`left_ventricle`), never Terminologia Anatomica Latin (`Ventriculus sinister`). The mapping lives in exactly one file: `assets/heart.anchors.json`.
- **`protocol/schema/*.json` is the single source of truth.** TypeScript types are generated from it; Python validates against it. Never hand-edit generated types.
- **Mesh budget:** desktop LOD ≤ 150k triangles. (Mobile LOD is Phase 5 — out of scope here.)
- **Licence obligation:** Z-Anatomy is CC-BY-SA 4.0. `assets/ATTRIBUTION.md` must exist and name it before any exported mesh is committed.
- **`assets/raw/` and `assets/build/` are gitignored.** Large binaries never enter git history. Exported `.glb` files are build artifacts.
- Commit after every task. Conventional-commit prefixes (`feat:`, `test:`, `chore:`, `spike:`).

---

## File Structure

```
ai-tutor/
├── protocol/
│   ├── schema/
│   │   ├── stage-command.schema.json   # what the agent may send
│   │   └── stage-state.schema.json     # what the client reports back
│   ├── fixtures/                       # shared payloads — both sides test against these
│   │   ├── valid/*.json
│   │   └── invalid/*.json
│   └── README.md
│
├── web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── protocol/generated.ts       # generated — do not edit
│       ├── stage/
│       │   ├── state.ts                # StageState, initialState, applyCommand  (pure)
│       │   ├── anchors.ts              # AnchorRegistry — id -> glTF node
│       │   ├── viewport.ts             # Three.js scene, camera, clipping  (imperative)
│       │   ├── labels.ts               # 3D anchor -> screen-space label placement
│       │   └── Stage.tsx               # React component binding state -> viewport
│       ├── transport/
│       │   └── dataChannel.ts          # LiveKit data channel <-> StageCommand
│       ├── dev/
│       │   └── SoloStage.tsx           # Phase 1 page: sliders, no AI
│       └── main.tsx
│   └── tests/
│
├── agent/
│   ├── pyproject.toml
│   ├── src/tutor_agent/
│   │   ├── __init__.py
│   │   ├── protocol.py                 # StageCommand builders + schema validation
│   │   ├── stage.py                    # StageBridge: publish commands, hold mirror
│   │   ├── lesson.py                   # the one hardcoded concept (Phase 2)
│   │   └── main.py                     # LiveKit entrypoint + Gemini Live session
│   └── tests/
│
├── tools/blender/
│   ├── inspect_heart.py                # Phase 0 spike — discovery report
│   └── export_heart.py                 # Phase 1 — .blend -> heart.glb
│
└── assets/
    ├── ATTRIBUTION.md
    ├── heart.anchors.json              # anchor id -> glTF node name (committed)
    ├── raw/                            # gitignored — Z-Anatomy source
    └── build/                          # gitignored — heart.glb
```

**Why this shape:** `stage/state.ts` is pure and holds every rule, so the entire Stage is unit-testable without a browser or GPU. `viewport.ts` is imperative and dumb — it only reflects state. `protocol/` sits outside both apps because it belongs to neither.

---

# PHASE 0 — Go / No-Go Spike

**This phase is a spike.** Its output is an answer and a decision, not code we keep. `inspect_heart.py` survives only because Task 3 reuses it.

**The question:** does the Z-Anatomy heart contain interior geometry — separate chamber meshes, endocardial surfaces — or is it a hollow outer shell? The entire cutaway demo depends on the answer.

---

### Task 1: Acquire Z-Anatomy and report what the heart actually contains

**Files:**
- Create: `tools/blender/inspect_heart.py`
- Create: `assets/ATTRIBUTION.md`
- Create: `docs/superpowers/spikes/2026-08-20-z-anatomy-interior.md`

**Interfaces:**
- Produces: `assets/build/heart-inspection.json` — the discovery report consumed by Task 3's anchor mapping.

- [ ] **Step 1: Install Blender and confirm headless Python works**

Download Blender 4.x from https://www.blender.org/download/ (default install path).

Run:
```bash
"/c/Program Files/Blender Foundation/Blender 4.2/blender.exe" --version
```
Expected: prints `Blender 4.2.x`. If the path differs, note your actual path — every Blender command below uses it. Export it once per shell:
```bash
export BLENDER="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
```

- [ ] **Step 2: Download the Z-Anatomy source**

```bash
mkdir -p assets/raw
git clone --depth 1 https://github.com/Z-Anatomy/The-blend.git assets/raw/z-anatomy
ls -lh assets/raw/z-anatomy/
```
Expected: a `.blend` file of roughly 1–3 GB. If the repo uses Git LFS and files come down as ~130-byte pointers, run `git lfs install && git lfs pull` inside `assets/raw/z-anatomy/`.

**Verify you got real data, not pointers:**
```bash
find assets/raw/z-anatomy -name "*.blend" -size +100M
```
Expected: at least one path printed. Empty output means LFS did not fetch — fix before continuing.

- [ ] **Step 3: Write the inspection script**

This script is *discovery-oriented* — we do not yet know Z-Anatomy's object naming, so it reports rather than assumes. Interior detection works by testing whether one mesh's bounding box sits wholly inside another's.

Create `tools/blender/inspect_heart.py`:

```python
"""Headless Blender: report what the Z-Anatomy heart actually contains.

Usage:
    blender <file.blend> --background --python tools/blender/inspect_heart.py -- <out.json>
"""
import json
import sys
import bpy
from mathutils import Vector

# Terminologia Anatomica and common-English fragments that indicate heart parts.
HEART_TERMS = [
    "cor", "heart", "ventricul", "ventricle", "atri", "auricul",
    "myocard", "endocard", "epicard", "pericard",
    "valva", "valve", "cuspid", "septum", "chorda", "papillar",
    "aorta", "pulmonal", "pulmonary", "vena cava", "truncus",
]


def world_bbox(obj):
    """Axis-aligned bounding box in world space."""
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    lo = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    hi = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return lo, hi


def contains(outer, inner, tol=1e-4):
    """True if `inner` bbox sits wholly within `outer` bbox."""
    (olo, ohi), (ilo, ihi) = outer, inner
    return all(olo[i] - tol <= ilo[i] and ihi[i] <= ohi[i] + tol for i in range(3))


def tri_count(obj):
    mesh = obj.data
    return sum(max(0, len(p.vertices) - 2) for p in mesh.polygons)


def main(out_path):
    matches = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        name_lc = obj.name.lower()
        if not any(term in name_lc for term in HEART_TERMS):
            continue
        lo, hi = world_bbox(obj)
        matches.append({
            "name": obj.name,
            "triangles": tri_count(obj),
            "vertices": len(obj.data.vertices),
            "bbox_lo": list(lo),
            "bbox_hi": list(hi),
            "volume": (hi.x - lo.x) * (hi.y - lo.y) * (hi.z - lo.z),
            "hidden": obj.hide_get() or obj.hide_viewport,
        })

    # Nesting: which meshes sit inside which. Non-empty => interior geometry exists.
    boxes = {m["name"]: (Vector(m["bbox_lo"]), Vector(m["bbox_hi"])) for m in matches}
    nesting = []
    for outer_name, outer_box in boxes.items():
        for inner_name, inner_box in boxes.items():
            if outer_name == inner_name:
                continue
            if contains(outer_box, inner_box):
                nesting.append({"outer": outer_name, "inner": inner_name})

    report = {
        "total_mesh_objects_in_file": sum(1 for o in bpy.data.objects if o.type == "MESH"),
        "heart_matches": len(matches),
        "total_triangles": sum(m["triangles"] for m in matches),
        "nested_pairs": len(nesting),
        "objects": sorted(matches, key=lambda m: -m["triangles"]),
        "nesting": nesting[:200],
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(f"\n{'=' * 60}")
    print(f"heart meshes found : {report['heart_matches']}")
    print(f"total triangles    : {report['total_triangles']:,}")
    print(f"nested pairs       : {report['nested_pairs']}   <-- >0 means INTERIOR GEOMETRY")
    print(f"{'=' * 60}\n")
    for m in report["objects"][:25]:
        print(f"  {m['triangles']:>9,}  {m['name']}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    main(argv[0] if argv else "heart-inspection.json")
```

- [ ] **Step 4: Run the inspection**

```bash
mkdir -p assets/build
BLEND=$(find assets/raw/z-anatomy -name "*.blend" -size +100M | head -1)
"$BLENDER" "$BLEND" --background --python tools/blender/inspect_heart.py -- assets/build/heart-inspection.json
```

Expected: a table of mesh names with triangle counts, and a `nested pairs` number.

**This is the go/no-go gate:**

| Result | Meaning | Action |
|---|---|---|
| `nested pairs > 0` **and** names include `ventricul`/`atri` variants | Interior geometry exists | **GO** — continue to Task 2 |
| `nested pairs == 0` but ≥ 4 distinct chamber meshes | Chambers are separate but not nested; a cut will still reveal them | **GO** — continue to Task 2 |
| Only 1–2 large meshes, no chamber names | Hollow shell | **NO-GO** — see Step 6 |

- [ ] **Step 5: Render a bisected view for visual proof**

Confirm it with your eyes, not just the numbers. Open Blender normally, open the `.blend`, isolate the heart objects, add a **Bisect** (Edit Mode → Mesh → Bisect) or a Boolean-difference cube through the middle, and screenshot.

Save as `docs/superpowers/spikes/heart-cutaway-proof.png`.

- [ ] **Step 6: Record the decision**

Create `docs/superpowers/spikes/2026-08-20-z-anatomy-interior.md`:

```markdown
# Spike: Does the Z-Anatomy heart have interior geometry?

**Date:** 2026-08-20
**Question:** The MVP's centrepiece is slicing the heart open. Does the source
mesh contain chambers and inner surfaces, or only an outer shell?

## Method
Headless Blender scan (`tools/blender/inspect_heart.py`) over all mesh objects
whose names match heart-related Terminologia Anatomica fragments. Interior
geometry is inferred from bounding-box nesting, then confirmed visually with a
Bisect render.

## Result
- Heart meshes found: <N>
- Total triangles: <N>
- Nested pairs: <N>
- Visual proof: `heart-cutaway-proof.png`

**Verdict: GO / NO-GO**

## If NO-GO — fallbacks, in order
1. **BodyParts3D** (CC-BY-SA, https://lifesciencedb.jp/bp3d/) — Z-Anatomy's own
   upstream source; may retain interior meshes Z-Anatomy merged away.
2. **NIH 3D** (https://3d.nih.gov) — largely public domain, several cardiac models.
3. **TRELLIS.2** — generate from a labelled cutaway illustration. Per its project
   page it handles enclosed interior structures. ~17s at 1024³ on an H100.
4. **Paid model** — Sketchfab / TurboSquid cardiac cutaway, ~$50–150.

Fallbacks 1–3 keep the CC-BY-SA / MIT licence posture; 4 needs licence review.
```

Fill in the `<N>` values and the verdict from your actual run.

- [ ] **Step 7: Write the attribution file**

Create `assets/ATTRIBUTION.md`:

```markdown
# Asset Attribution

## Z-Anatomy
Human anatomy meshes derived from **Z-Anatomy** (https://www.z-anatomy.com/),
itself derived from **BodyParts3D** (© The Database Center for Life Science).

Licensed under **Creative Commons Attribution-ShareAlike 4.0 International**
(CC BY-SA 4.0) — https://creativecommons.org/licenses/by-sa/4.0/

Meshes in `assets/build/` are modified (culled, decimated, renamed, re-exported)
from Z-Anatomy sources and are therefore **also licensed CC BY-SA 4.0**.

This obligation applies to the mesh files only. Application source code, lesson
beat sheets, and generated notes pages are not derivative works of Z-Anatomy and
remain separately licensed.
```

- [ ] **Step 8: Commit**

```bash
git add tools/blender/inspect_heart.py assets/ATTRIBUTION.md docs/superpowers/spikes/
git commit -m "spike: verify Z-Anatomy heart interior geometry"
```

---

### Task 2: Gate — stop or proceed

**Files:** none (decision point)

- [ ] **Step 1: Read your own verdict**

Open `docs/superpowers/spikes/2026-08-20-z-anatomy-interior.md`.

**If GO:** continue to Task 3.

**If NO-GO: stop and report to the user.** Do not start Phase 1 against a hollow mesh. Present the fallback options from the spike doc and let the user choose the source before any Stage code is written. A wrong asset choice here invalidates Tasks 3–8.

---

# PHASE 1 — The Heart, Cut Open (no AI)

Ends with a URL you can send someone. They rotate a heart and slice it open with a slider. Zero AI dependencies, so a bad result here is a purely visual problem with a purely visual fix.

---

### Task 3: Export heart.glb with stable node names

**Files:**
- Create: `tools/blender/export_heart.py`
- Create: `assets/heart.anchors.json`

**Interfaces:**
- Consumes: `assets/build/heart-inspection.json` (Task 1)
- Produces: `assets/build/heart.glb` — Draco-compressed, ≤150k triangles, node names matching the `node` values in `assets/heart.anchors.json`.

- [ ] **Step 1: Write the export script**

Node names must survive the round trip, so the script renames objects to our snake_case anchor IDs *before* export. Blender writes object names directly as glTF node names.

Create `tools/blender/export_heart.py`:

```python
"""Headless Blender: cull to heart objects, decimate, rename, export glTF.

Usage:
    blender <file.blend> --background --python tools/blender/export_heart.py -- <anchors.json> <out.glb>
"""
import json
import sys
import bpy

TRIANGLE_BUDGET = 150_000


def load_anchor_map(path):
    """anchors.json -> {source_object_name: anchor_id}"""
    with open(path, encoding="utf-8") as fh:
        anchors = json.load(fh)["anchors"]
    return {a["source"]: a["node"] for a in anchors}


def tri_count(obj):
    return sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons)


def main(anchors_path, out_path):
    mapping = load_anchor_map(anchors_path)

    # 1. Delete everything not named in the anchor map.
    keep = set(mapping.keys())
    missing = keep - {o.name for o in bpy.data.objects}
    if missing:
        raise SystemExit(f"ERROR: anchors.json references objects absent from the .blend: {sorted(missing)}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(bpy.data.objects):
        if obj.name not in keep:
            obj.select_set(True)
    bpy.ops.object.delete()

    # 2. Un-hide and un-parent survivors so the export is flat and predictable.
    for obj in bpy.data.objects:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        if obj.parent:
            obj.matrix_world = obj.matrix_world.copy()
            obj.parent = None

    total = sum(tri_count(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"triangles before decimation: {total:,}")

    # 3. Decimate proportionally if over budget.
    if total > TRIANGLE_BUDGET:
        ratio = TRIANGLE_BUDGET / total
        print(f"decimating to ratio {ratio:.3f}")
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            mod = obj.modifiers.new(name="decimate", type="DECIMATE")
            mod.ratio = ratio
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.modifier_apply(modifier=mod.name)

    # 4. Rename to anchor node names. Rename last — decimation is name-agnostic,
    #    and renaming first would break the `keep` lookup above.
    for source_name, node_name in mapping.items():
        bpy.data.objects[source_name].name = node_name

    final = sum(tri_count(o) for o in bpy.data.objects if o.type == "MESH")
    print(f"triangles after decimation:  {final:,}")
    if final > TRIANGLE_BUDGET * 1.05:
        raise SystemExit(f"ERROR: {final:,} triangles exceeds budget {TRIANGLE_BUDGET:,}")

    # 5. Export.
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_apply=True,
        export_yup=True,
    )
    print(f"wrote {out_path}")


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:]
    main(argv[0], argv[1])
```

**Note:** `export_scene.gltf` argument names differ slightly across Blender versions. If the call errors with an unexpected keyword, run `"$BLENDER" --background --python-expr "import bpy; help(bpy.ops.export_scene.gltf)"` and match the names for your version.

- [ ] **Step 2: Write the anchor map from your inspection report**

Open `assets/build/heart-inspection.json` and pick the objects that matter for the lesson. Create `assets/heart.anchors.json` — `source` is the Z-Anatomy object name from the report, `node` is our stable ID:

```json
{
  "asset": "heart.glb",
  "attribution": "Z-Anatomy, CC BY-SA 4.0",
  "anchors": [
    { "node": "left_ventricle",  "source": "<from report>", "ta": "Ventriculus sinister", "label": "Left Ventricle" },
    { "node": "right_ventricle", "source": "<from report>", "ta": "Ventriculus dexter",   "label": "Right Ventricle" },
    { "node": "left_atrium",     "source": "<from report>", "ta": "Atrium sinistrum",     "label": "Left Atrium" },
    { "node": "right_atrium",    "source": "<from report>", "ta": "Atrium dextrum",       "label": "Right Atrium" },
    { "node": "aorta",           "source": "<from report>", "ta": "Aorta",                "label": "Aorta" },
    { "node": "pulmonary_trunk", "source": "<from report>", "ta": "Truncus pulmonalis",   "label": "Pulmonary Trunk" }
  ]
}
```

Replace every `<from report>` with a real object name. The export script fails loudly if any is wrong — that is intentional.

- [ ] **Step 3: Run the export**

```bash
BLEND=$(find assets/raw/z-anatomy -name "*.blend" -size +100M | head -1)
"$BLENDER" "$BLEND" --background --python tools/blender/export_heart.py -- assets/heart.anchors.json assets/build/heart.glb
ls -lh assets/build/heart.glb
```
Expected: prints triangle counts before/after, then `wrote ...heart.glb`. File should be roughly 2–15 MB.

- [ ] **Step 4: Verify node names survived the export**

```bash
node -e "const fs=require('fs');const b=fs.readFileSync('assets/build/heart.glb');const len=b.readUInt32LE(12);const j=JSON.parse(b.slice(20,20+len).toString('utf8'));console.log(j.nodes.map(n=>n.name).join('\n'))"
```
Expected: prints exactly the six `node` values from `heart.anchors.json`. If names are mangled or suffixed (`left_ventricle.001`), fix the rename step before continuing — every later task depends on these strings.

- [ ] **Step 5: Commit**

```bash
git add tools/blender/export_heart.py assets/heart.anchors.json
git commit -m "feat: export heart.glb with stable anchor node names"
```

---

### Task 4: Web app scaffold

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx`
- Test: `web/tests/smoke.test.ts`

**Interfaces:**
- Produces: a Vite dev server on port 5173 and a working `npm test` (Vitest) that later tasks add to.

- [ ] **Step 1: Scaffold and install**

```bash
mkdir -p web && cd web
npm create vite@latest . -- --template react-ts
npm install
npm install three
npm install -D @types/three vitest
```

- [ ] **Step 2: Write the failing smoke test**

Create `web/tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { appName } from '../src/App';

describe('scaffold', () => {
  it('exports an app name', () => {
    expect(appName).toBe('AI Tutor');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Add to `web/package.json` scripts: `"test": "vitest run"`, then:
```bash
npm test
```
Expected: FAIL — `appName` is not exported from `../src/App`.

- [ ] **Step 4: Make it pass**

Replace `web/src/App.tsx`:

```tsx
export const appName = 'AI Tutor';

export default function App() {
  return <div>{appName}</div>;
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```
Expected: PASS, 1 test.

- [ ] **Step 6: Serve assets in dev**

The heart lives in gitignored `assets/build/`, outside `web/`. Point Vite at it. Replace `web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  publicDir: path.resolve(__dirname, '../assets/build'),
  server: { port: 5173 },
});
```

Verify:
```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" http://localhost:5173/heart.glb
kill %1
```
Expected: `200` and a byte count matching `heart.glb`.

- [ ] **Step 7: Commit**

```bash
cd .. && git add web/ && git commit -m "chore: scaffold web app with vite, three, vitest"
```

---

### Task 5: Stage state machine (pure, no rendering)

**Files:**
- Create: `web/src/stage/state.ts`
- Test: `web/tests/stage/state.test.ts`

**Interfaces:**
- Produces:
  - `type StageMode = 'EXPLORE' | 'NOTES' | 'SPLIT' | 'FOCUS'`
  - `type CutPlane = 'none' | 'coronal' | 'sagittal' | 'transverse'`
  - `type CameraPreset = 'anterior' | 'posterior' | 'left' | 'right' | 'superior'`
  - `interface StageState { asset: string | null; mode: StageMode; camera: CameraPreset; cut: { plane: CutPlane; offset: number }; highlighted: string[]; labelsVisible: boolean }`
  - `type StageCommand` (discriminated union on `type`)
  - `const initialState: StageState`
  - `function applyCommand(state: StageState, cmd: StageCommand, knownAnchors: ReadonlySet<string>): { ok: true; state: StageState } | { ok: false; error: string }`

This is the heart of the whole system and it is pure — no Three.js, no DOM, no network. Every rule about what the Stage may do lives here and is tested in milliseconds.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/stage/state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyCommand, initialState, type StageState } from '../../src/stage/state';

const ANCHORS = new Set(['left_ventricle', 'right_ventricle', 'aorta']);

function apply(state: StageState, cmd: Parameters<typeof applyCommand>[1]) {
  const r = applyCommand(state, cmd, ANCHORS);
  if (!r.ok) throw new Error(`unexpected rejection: ${r.error}`);
  return r.state;
}

describe('applyCommand', () => {
  it('loads an asset', () => {
    const s = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    expect(s.asset).toBe('heart.glb');
  });

  it('rejects highlighting an unknown anchor', () => {
    const loaded = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    const r = applyCommand(loaded, { type: 'highlight', anchors: ['spleen'] }, ANCHORS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('spleen');
  });

  it('rejects any command before an asset is loaded', () => {
    const r = applyCommand(initialState, { type: 'highlight', anchors: ['aorta'] }, ANCHORS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('no asset');
  });

  it('cuts open and records the plane', () => {
    let s = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    s = apply(s, { type: 'cut_open', plane: 'coronal' });
    expect(s.cut).toEqual({ plane: 'coronal', offset: 0 });
  });

  it('close_cut returns to plane none', () => {
    let s = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    s = apply(s, { type: 'cut_open', plane: 'coronal' });
    s = apply(s, { type: 'close_cut' });
    expect(s.cut.plane).toBe('none');
  });

  it('clamps cut offset to [-1, 1]', () => {
    let s = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    s = apply(s, { type: 'cut_open', plane: 'coronal', offset: 5 });
    expect(s.cut.offset).toBe(1);
  });

  it('highlight replaces rather than accumulates', () => {
    let s = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    s = apply(s, { type: 'highlight', anchors: ['aorta'] });
    s = apply(s, { type: 'highlight', anchors: ['left_ventricle'] });
    expect(s.highlighted).toEqual(['left_ventricle']);
  });

  it('never mutates the input state', () => {
    const loaded = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    const before = structuredClone(loaded);
    apply(loaded, { type: 'highlight', anchors: ['aorta'] });
    expect(loaded).toEqual(before);
  });

  it('rejects an unknown command type', () => {
    const loaded = apply(initialState, { type: 'load_asset', asset: 'heart.glb' });
    // deliberately malformed — this is the agent-sends-garbage path
    const r = applyCommand(loaded, { type: 'explode' } as never, ANCHORS);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd web && npm test
```
Expected: FAIL — cannot resolve `../../src/stage/state`.

- [ ] **Step 3: Implement**

Create `web/src/stage/state.ts`:

```typescript
export type StageMode = 'EXPLORE' | 'NOTES' | 'SPLIT' | 'FOCUS';
export type CutPlane = 'none' | 'coronal' | 'sagittal' | 'transverse';
export type CameraPreset = 'anterior' | 'posterior' | 'left' | 'right' | 'superior';

export interface StageState {
  asset: string | null;
  mode: StageMode;
  camera: CameraPreset;
  cut: { plane: CutPlane; offset: number };
  highlighted: string[];
  labelsVisible: boolean;
}

export type StageCommand =
  | { type: 'load_asset'; asset: string }
  | { type: 'set_camera'; preset: CameraPreset }
  | { type: 'cut_open'; plane: Exclude<CutPlane, 'none'>; offset?: number }
  | { type: 'close_cut' }
  | { type: 'highlight'; anchors: string[] }
  | { type: 'clear_highlight' }
  | { type: 'set_labels'; visible: boolean };

export type ApplyResult =
  | { ok: true; state: StageState }
  | { ok: false; error: string };

export const initialState: StageState = {
  asset: null,
  mode: 'EXPLORE',
  camera: 'anterior',
  cut: { plane: 'none', offset: 0 },
  highlighted: [],
  labelsVisible: true,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function applyCommand(
  state: StageState,
  cmd: StageCommand,
  knownAnchors: ReadonlySet<string>,
): ApplyResult {
  // Every command except load_asset requires something on stage.
  if (cmd.type !== 'load_asset' && state.asset === null) {
    return { ok: false, error: `cannot apply "${cmd.type}": no asset loaded` };
  }

  switch (cmd.type) {
    case 'load_asset':
      return { ok: true, state: { ...initialState, asset: cmd.asset } };

    case 'set_camera':
      return { ok: true, state: { ...state, camera: cmd.preset } };

    case 'cut_open':
      return {
        ok: true,
        state: { ...state, cut: { plane: cmd.plane, offset: clamp(cmd.offset ?? 0, -1, 1) } },
      };

    case 'close_cut':
      return { ok: true, state: { ...state, cut: { plane: 'none', offset: 0 } } };

    case 'highlight': {
      const unknown = cmd.anchors.filter((a) => !knownAnchors.has(a));
      if (unknown.length > 0) {
        return { ok: false, error: `unknown anchor(s): ${unknown.join(', ')}` };
      }
      return { ok: true, state: { ...state, highlighted: [...cmd.anchors] } };
    }

    case 'clear_highlight':
      return { ok: true, state: { ...state, highlighted: [] } };

    case 'set_labels':
      return { ok: true, state: { ...state, labelsVisible: cmd.visible } };

    default:
      return { ok: false, error: `unknown command type: ${(cmd as { type: string }).type}` };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/ && git commit -m "feat: pure stage state machine with anchor validation"
```

---

### Task 6: Anchor registry

**Files:**
- Create: `web/src/stage/anchors.ts`
- Test: `web/tests/stage/anchors.test.ts`, `web/tests/stage/anchor-coverage.test.ts`

**Interfaces:**
- Consumes: `assets/heart.anchors.json` (Task 3)
- Produces:
  - `interface AnchorEntry { node: string; source: string; ta: string; label: string }`
  - `class AnchorRegistry` with `static fromJson(json: unknown): AnchorRegistry`, `.ids(): ReadonlySet<string>`, `.label(id: string): string`, `.has(id: string): boolean`, `.all(): readonly AnchorEntry[]`

- [ ] **Step 1: Write the failing tests**

Create `web/tests/stage/anchors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { AnchorRegistry } from '../../src/stage/anchors';

const JSON_FIXTURE = {
  asset: 'heart.glb',
  anchors: [
    { node: 'left_ventricle', source: 'Ventriculus sinister', ta: 'Ventriculus sinister', label: 'Left Ventricle' },
    { node: 'aorta', source: 'Aorta', ta: 'Aorta', label: 'Aorta' },
  ],
};

describe('AnchorRegistry', () => {
  it('exposes anchor ids as a set', () => {
    const r = AnchorRegistry.fromJson(JSON_FIXTURE);
    expect(r.ids()).toEqual(new Set(['left_ventricle', 'aorta']));
  });

  it('resolves human labels', () => {
    const r = AnchorRegistry.fromJson(JSON_FIXTURE);
    expect(r.label('left_ventricle')).toBe('Left Ventricle');
  });

  it('reports membership', () => {
    const r = AnchorRegistry.fromJson(JSON_FIXTURE);
    expect(r.has('aorta')).toBe(true);
    expect(r.has('spleen')).toBe(false);
  });

  it('throws on duplicate node ids', () => {
    const dup = { asset: 'x', anchors: [
      { node: 'aorta', source: 'a', ta: 'a', label: 'A' },
      { node: 'aorta', source: 'b', ta: 'b', label: 'B' },
    ] };
    expect(() => AnchorRegistry.fromJson(dup)).toThrow(/duplicate/i);
  });

  it('throws on a malformed document', () => {
    expect(() => AnchorRegistry.fromJson({ nope: true })).toThrow(/anchors/i);
  });

  it('throws when label is requested for an unknown id', () => {
    const r = AnchorRegistry.fromJson(JSON_FIXTURE);
    expect(() => r.label('spleen')).toThrow(/spleen/);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd web && npm test
```
Expected: FAIL — cannot resolve `../../src/stage/anchors`.

- [ ] **Step 3: Implement**

Create `web/src/stage/anchors.ts`:

```typescript
export interface AnchorEntry {
  node: string;
  source: string;
  ta: string;
  label: string;
}

export class AnchorRegistry {
  private readonly byId: ReadonlyMap<string, AnchorEntry>;

  private constructor(entries: AnchorEntry[]) {
    const map = new Map<string, AnchorEntry>();
    for (const e of entries) {
      if (map.has(e.node)) throw new Error(`duplicate anchor node id: ${e.node}`);
      map.set(e.node, e);
    }
    this.byId = map;
  }

  static fromJson(json: unknown): AnchorRegistry {
    const doc = json as { anchors?: unknown };
    if (!Array.isArray(doc?.anchors)) {
      throw new Error('malformed anchor document: expected an "anchors" array');
    }
    return new AnchorRegistry(doc.anchors as AnchorEntry[]);
  }

  ids(): ReadonlySet<string> {
    return new Set(this.byId.keys());
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  label(id: string): string {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`unknown anchor: ${id}`);
    return entry.label;
  }

  all(): readonly AnchorEntry[] {
    return [...this.byId.values()];
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: PASS, 15 tests total.

- [ ] **Step 5: Add the anchor coverage test**

The spec calls this the most important test in the suite. It is the one that catches "she points at nothing" at build time rather than mid-class. It reads the real `heart.glb` and asserts every anchor in `heart.anchors.json` exists as a glTF node.

Create `web/tests/stage/anchor-coverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AnchorRegistry } from '../../src/stage/anchors';

const ROOT = path.resolve(__dirname, '../../..');
const GLB = path.join(ROOT, 'assets/build/heart.glb');
const ANCHORS = path.join(ROOT, 'assets/heart.anchors.json');

/** Read node names straight from the GLB's embedded JSON chunk. */
function gltfNodeNames(file: string): string[] {
  const buf = fs.readFileSync(file);
  const jsonLength = buf.readUInt32LE(12);          // header is 12 bytes, then chunk length
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  return (json.nodes ?? []).map((n: { name?: string }) => n.name).filter(Boolean);
}

// The GLB is a gitignored build artifact, so skip rather than fail on a fresh clone.
const available = fs.existsSync(GLB) && fs.existsSync(ANCHORS);

describe.skipIf(!available)('anchor coverage', () => {
  it('every anchor id resolves to a node in heart.glb', () => {
    const registry = AnchorRegistry.fromJson(JSON.parse(fs.readFileSync(ANCHORS, 'utf8')));
    const nodes = new Set(gltfNodeNames(GLB));
    const missing = [...registry.ids()].filter((id) => !nodes.has(id));
    expect(missing, `anchors absent from heart.glb: ${missing.join(', ')}`).toEqual([]);
  });

  it('no glTF node was silently renamed with a .001 suffix', () => {
    const suffixed = gltfNodeNames(GLB).filter((n) => /\.\d{3}$/.test(n));
    expect(suffixed, `Blender de-duplicated these names: ${suffixed.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 6: Run it against the real asset**

```bash
npm test
```
Expected: PASS, 17 tests. If the coverage tests are *skipped*, `assets/build/heart.glb` is missing — re-run Task 3 Step 3. If they *fail*, the anchor map and the export disagree; fix `heart.anchors.json` and re-export before going further, because every later task trusts these names.

- [ ] **Step 7: Commit**

```bash
cd .. && git add web/ && git commit -m "feat: anchor registry with build-time glTF coverage test"
```

---

### Task 7: Three.js viewport with clipping-plane cutaway

**Files:**
- Create: `web/src/stage/viewport.ts`

**Interfaces:**
- Consumes: `StageState`, `CutPlane`, `CameraPreset` from `stage/state.ts`; `AnchorRegistry` from `stage/anchors.ts`
- Produces: `class Viewport` with `constructor(canvas: HTMLCanvasElement)`, `async load(url: string): Promise<void>`, `sync(state: StageState): void`, `worldPositionOf(anchorId: string): THREE.Vector3 | null`, `project(v: THREE.Vector3): { x: number; y: number; visible: boolean }`, `dispose(): void`

This file is imperative and deliberately dumb — it only reflects state. It carries no rules.

**The critical detail:** meshes must use `side: THREE.DoubleSide`. With default front-face rendering, slicing through a mesh shows nothing, because you are looking at culled back faces. This single line is the difference between "the heart opens up" and "the heart vanishes."

- [ ] **Step 1: Implement the viewport**

Create `web/src/stage/viewport.ts`:

```typescript
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { StageState, CutPlane, CameraPreset } from './state';

const CAMERA_DIRECTIONS: Record<CameraPreset, THREE.Vector3> = {
  anterior: new THREE.Vector3(0, 0, 1),
  posterior: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  superior: new THREE.Vector3(0, 1, 0),
};

const PLANE_NORMALS: Record<Exclude<CutPlane, 'none'>, THREE.Vector3> = {
  coronal: new THREE.Vector3(0, 0, -1),
  sagittal: new THREE.Vector3(-1, 0, 0),
  transverse: new THREE.Vector3(0, -1, 0),
};

const HIGHLIGHT_COLOR = new THREE.Color(0xffb347);

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
  private readonly nodes = new Map<string, THREE.Mesh>();
  private readonly baseColors = new Map<string, THREE.Color>();

  private root: THREE.Object3D | null = null;
  private radius = 1;
  private frame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Required for per-material clipping planes.
    this.renderer.localClippingEnabled = true;

    this.scene.background = new THREE.Color(0x0f1116);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-3, -1, -2);
    this.scene.add(fill);

    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderLoop();
  }

  async load(url: string): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);

    const gltf = await loader.loadAsync(url);
    this.root = gltf.scene;

    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const material = obj.material as THREE.MeshStandardMaterial;
      // Without DoubleSide, a clipped mesh renders as nothing — you are looking
      // at culled back faces. This is what makes "cut open" actually show an inside.
      material.side = THREE.DoubleSide;
      material.clippingPlanes = [];
      material.clipShadows = true;
      this.nodes.set(obj.name, obj);
      this.baseColors.set(obj.name, material.color.clone());
    });

    // Frame the model.
    const box = new THREE.Box3().setFromObject(this.root);
    const center = box.getCenter(new THREE.Vector3());
    this.radius = box.getSize(new THREE.Vector3()).length() / 2;
    this.root.position.sub(center);
    this.scene.add(this.root);

    this.controls.target.set(0, 0, 0);
    this.applyCamera('anterior');
  }

  /** Reflect state. Contains no rules — every decision was made in applyCommand. */
  sync(state: StageState): void {
    this.applyCamera(state.camera);
    this.applyCut(state.cut.plane, state.cut.offset);
    this.applyHighlight(state.highlighted);
  }

  worldPositionOf(anchorId: string): THREE.Vector3 | null {
    const mesh = this.nodes.get(anchorId);
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    return box.getCenter(new THREE.Vector3());
  }

  /** World point -> normalised screen coords, plus whether it faces the camera. */
  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    const toPoint = v.clone().sub(this.camera.position).normalize();
    const facing = this.camera.getWorldDirection(new THREE.Vector3());
    return {
      x: (p.x * 0.5 + 0.5) * this.canvas.clientWidth,
      y: (-p.y * 0.5 + 0.5) * this.canvas.clientHeight,
      visible: p.z < 1 && toPoint.dot(facing) > 0,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private applyCamera(preset: CameraPreset): void {
    const dir = CAMERA_DIRECTIONS[preset];
    const distance = this.radius / Math.tan((this.camera.fov * Math.PI) / 360) * 1.4;
    this.camera.position.copy(dir).multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  private applyCut(plane: CutPlane, offset: number): void {
    const active = plane !== 'none';
    if (active) {
      this.clipPlane.normal.copy(PLANE_NORMALS[plane]);
      this.clipPlane.constant = offset * this.radius;
    }
    for (const mesh of this.nodes.values()) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.clippingPlanes = active ? [this.clipPlane] : [];
      material.needsUpdate = true;
    }
  }

  private applyHighlight(ids: readonly string[]): void {
    const lit = new Set(ids);
    for (const [name, mesh] of this.nodes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      const base = this.baseColors.get(name);
      if (!base) continue;
      material.color.copy(lit.has(name) ? HIGHLIGHT_COLOR : base);
      material.emissive.setHex(lit.has(name) ? 0x442200 : 0x000000);
      material.opacity = lit.size === 0 || lit.has(name) ? 1 : 0.25;
      material.transparent = lit.size > 0 && !lit.has(name);
    }
  }

  private resize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private renderLoop = (): void => {
    this.frame = requestAnimationFrame(this.renderLoop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors. (`Viewport` needs a real WebGL context, so it is exercised visually in Task 8, not in Vitest. The rules it would otherwise contain are already unit-tested in Task 5 — this is why the state machine is pure.)

- [ ] **Step 3: Commit**

```bash
cd .. && git add web/ && git commit -m "feat: three.js viewport with clipping-plane cutaway"
```

---

### Task 8: Solo stage page — the Phase 1 deliverable

**Files:**
- Create: `web/src/dev/SoloStage.tsx`
- Create: `web/src/stage/labels.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `Viewport` (Task 7), `AnchorRegistry` (Task 6), `applyCommand`/`initialState` (Task 5)
- Produces: `function LabelLayer(props: { viewport: Viewport | null; registry: AnchorRegistry | null; state: StageState }): JSX.Element` from `stage/labels.tsx`. Both refs are nullable because the page renders before the glTF finishes loading.

- [ ] **Step 1: Write the label layer**

Create `web/src/stage/labels.tsx` — it must be `.tsx`, not `.ts`, because it contains JSX. Importers still write `from './labels'` with no extension:

```tsx
import { useEffect, useState } from 'react';
import type { Viewport } from './viewport';
import type { AnchorRegistry } from './anchors';
import type { StageState } from './state';

interface Placed {
  id: string;
  label: string;
  x: number;
  y: number;
}

export function LabelLayer({
  viewport,
  registry,
  state,
}: {
  viewport: Viewport | null;
  registry: AnchorRegistry | null;
  state: StageState;
}) {
  const [placed, setPlaced] = useState<Placed[]>([]);

  useEffect(() => {
    if (!viewport || !registry || !state.labelsVisible) {
      setPlaced([]);
      return;
    }
    let raf = 0;
    const tick = () => {
      const shown = state.highlighted.length > 0 ? state.highlighted : registry.all().map((a) => a.node);
      const next: Placed[] = [];
      for (const id of shown) {
        const world = viewport.worldPositionOf(id);
        if (!world) continue;
        const p = viewport.project(world);
        if (!p.visible) continue;
        next.push({ id, label: registry.label(id), x: p.x, y: p.y });
      }
      setPlaced(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewport, registry, state.labelsVisible, state.highlighted]);

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {placed.map((p) => (
        <div
          key={p.id}
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            transform: 'translate(-50%, -50%)',
            padding: '2px 8px',
            borderRadius: 4,
            background: 'rgba(15,17,22,0.82)',
            border: '1px solid rgba(255,179,71,0.5)',
            color: '#ffd9a0',
            font: '12px/1.4 system-ui, sans-serif',
            whiteSpace: 'nowrap',
          }}
        >
          {p.label}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the solo page**

Create `web/src/dev/SoloStage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Viewport } from '../stage/viewport';
import { AnchorRegistry } from '../stage/anchors';
import { LabelLayer } from '../stage/labels';
import { applyCommand, initialState, type StageState, type CameraPreset } from '../stage/state';

const CAMERAS: CameraPreset[] = ['anterior', 'posterior', 'left', 'right', 'superior'];

export default function SoloStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [registry, setRegistry] = useState<AnchorRegistry | null>(null);
  const [state, setState] = useState<StageState>(initialState);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const vp = new Viewport(canvasRef.current);
    let cancelled = false;

    (async () => {
      const reg = AnchorRegistry.fromJson(await (await fetch('/heart.anchors.json')).json());
      await vp.load('/heart.glb');
      if (cancelled) return;
      setRegistry(reg);
      setViewport(vp);
      const r = applyCommand(initialState, { type: 'load_asset', asset: 'heart.glb' }, reg.ids());
      if (r.ok) setState(r.state);
    })().catch((e) => setError(String(e)));

    return () => {
      cancelled = true;
      vp.dispose();
    };
  }, []);

  // The only path from command to render. Nothing bypasses this.
  const dispatch = (cmd: Parameters<typeof applyCommand>[1]) => {
    if (!registry) return;
    const r = applyCommand(state, cmd, registry.ids());
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setState(r.state);
  };

  useEffect(() => {
    viewport?.sync(state);
  }, [viewport, state]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0f1116' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <LabelLayer viewport={viewport} registry={registry} state={state} />

      <div style={{ position: 'absolute', top: 16, left: 16, display: 'grid', gap: 10, color: '#cfd4dc', font: '13px system-ui' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {CAMERAS.map((c) => (
            <button key={c} onClick={() => dispatch({ type: 'set_camera', preset: c })}>{c}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => dispatch({ type: 'cut_open', plane: 'coronal' })}>cut coronal</button>
          <button onClick={() => dispatch({ type: 'cut_open', plane: 'sagittal' })}>cut sagittal</button>
          <button onClick={() => dispatch({ type: 'close_cut' })}>close</button>
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          slice depth: {state.cut.offset.toFixed(2)}
          <input
            type="range" min={-1} max={1} step={0.01} value={state.cut.offset}
            disabled={state.cut.plane === 'none'}
            onChange={(e) =>
              dispatch({
                type: 'cut_open',
                plane: state.cut.plane === 'none' ? 'coronal' : state.cut.plane,
                offset: Number(e.target.value),
              })
            }
          />
        </label>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxWidth: 380 }}>
          {registry?.all().map((a) => (
            <button key={a.node} onClick={() => dispatch({ type: 'highlight', anchors: [a.node] })}>{a.label}</button>
          ))}
          <button onClick={() => dispatch({ type: 'clear_highlight' })}>clear</button>
        </div>

        {error && <div style={{ color: '#ff8080' }}>{error}</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Mount it**

Replace `web/src/App.tsx`:

```tsx
import SoloStage from './dev/SoloStage';

export const appName = 'AI Tutor';

export default function App() {
  return <SoloStage />;
}
```

- [ ] **Step 4: Confirm the existing tests still pass**

```bash
cd web && npm test
```
Expected: PASS, 17 tests. (`appName` is still exported, so the smoke test holds.)

- [ ] **Step 5: Look at it — this is the actual gate**

```bash
npm run dev
```
Open http://localhost:5173 and verify, by eye:

- [ ] The heart loads and orbits smoothly on drag
- [ ] Camera preset buttons snap to each view
- [ ] **"cut coronal" reveals chambers — an inside, not a hollow void**
- [ ] The slice-depth slider sweeps the plane through the model
- [ ] Clicking an anchor button highlights that structure and dims the rest
- [ ] Labels track their structures as you orbit, and hide when they rotate behind

If the cut shows nothing, check `material.side = THREE.DoubleSide` in `viewport.ts` first — that is the usual cause.

- [ ] **Step 6: Capture the deliverable**

Record a 20-second screen capture: orbit, cut open, sweep the slider, highlight the left ventricle. Save to `docs/superpowers/spikes/phase1-cutaway.mp4`. **This is the Phase 1 deliverable — send it to someone and watch their reaction before building Phase 2.**

- [ ] **Step 7: Commit**

```bash
cd .. && git add web/ docs/ && git commit -m "feat: solo stage page with cutaway, highlights and labels"
```

---

# PHASE 2 — She Speaks, and It Moves

The MVP. A LiveKit room, a Gemini Live agent, and one hardcoded concept where narration and visuals land together.

---

### Task 9: Stage protocol schema and fixtures

**Files:**
- Create: `protocol/schema/stage-command.schema.json`
- Create: `protocol/fixtures/valid/*.json`, `protocol/fixtures/invalid/*.json`
- Create: `protocol/README.md`
- Test: `web/tests/protocol/fixtures.test.ts`

**Interfaces:**
- Produces: a JSON Schema both runtimes validate against, and fixture files both test suites read. Task 12's Python validator loads the same schema file.

- [ ] **Step 1: Write the schema**

Create `protocol/schema/stage-command.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://ai-tutor.local/schema/stage-command.json",
  "title": "StageCommand",
  "type": "object",
  "required": ["type"],
  "oneOf": [
    {
      "properties": {
        "type": { "const": "load_asset" },
        "asset": { "type": "string", "minLength": 1 }
      },
      "required": ["type", "asset"],
      "additionalProperties": false
    },
    {
      "properties": {
        "type": { "const": "set_camera" },
        "preset": { "enum": ["anterior", "posterior", "left", "right", "superior"] }
      },
      "required": ["type", "preset"],
      "additionalProperties": false
    },
    {
      "properties": {
        "type": { "const": "cut_open" },
        "plane": { "enum": ["coronal", "sagittal", "transverse"] },
        "offset": { "type": "number", "minimum": -1, "maximum": 1 }
      },
      "required": ["type", "plane"],
      "additionalProperties": false
    },
    {
      "properties": { "type": { "const": "close_cut" } },
      "required": ["type"],
      "additionalProperties": false
    },
    {
      "properties": {
        "type": { "const": "highlight" },
        "anchors": {
          "type": "array",
          "items": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
          "minItems": 1
        }
      },
      "required": ["type", "anchors"],
      "additionalProperties": false
    },
    {
      "properties": { "type": { "const": "clear_highlight" } },
      "required": ["type"],
      "additionalProperties": false
    },
    {
      "properties": {
        "type": { "const": "set_labels" },
        "visible": { "type": "boolean" }
      },
      "required": ["type", "visible"],
      "additionalProperties": false
    }
  ]
}
```

- [ ] **Step 2: Write the fixtures**

```bash
mkdir -p protocol/fixtures/valid protocol/fixtures/invalid

cat > protocol/fixtures/valid/load_asset.json      <<< '{"type":"load_asset","asset":"heart.glb"}'
cat > protocol/fixtures/valid/cut_coronal.json     <<< '{"type":"cut_open","plane":"coronal"}'
cat > protocol/fixtures/valid/cut_with_offset.json <<< '{"type":"cut_open","plane":"coronal","offset":0.4}'
cat > protocol/fixtures/valid/highlight_lv.json    <<< '{"type":"highlight","anchors":["left_ventricle"]}'
cat > protocol/fixtures/valid/close_cut.json       <<< '{"type":"close_cut"}'
cat > protocol/fixtures/valid/set_labels.json      <<< '{"type":"set_labels","visible":false}'

cat > protocol/fixtures/invalid/unknown_type.json     <<< '{"type":"explode"}'
cat > protocol/fixtures/invalid/cut_bad_plane.json    <<< '{"type":"cut_open","plane":"diagonal"}'
cat > protocol/fixtures/invalid/cut_offset_range.json <<< '{"type":"cut_open","plane":"coronal","offset":5}'
cat > protocol/fixtures/invalid/highlight_empty.json  <<< '{"type":"highlight","anchors":[]}'
cat > protocol/fixtures/invalid/highlight_caps.json   <<< '{"type":"highlight","anchors":["LeftVentricle"]}'
cat > protocol/fixtures/invalid/extra_field.json      <<< '{"type":"close_cut","force":true}'

ls protocol/fixtures/valid protocol/fixtures/invalid
```
Expected: 6 valid, 6 invalid files.

- [ ] **Step 3: Write the failing contract test**

```bash
cd web && npm install -D ajv
```

Create `web/tests/protocol/fixtures.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import fs from 'node:fs';
import path from 'node:path';
import schema from '../../../protocol/schema/stage-command.schema.json';
import { applyCommand, initialState, type StageCommand } from '../../src/stage/state';

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
const dir = (kind: string) => path.resolve(__dirname, '../../../protocol/fixtures', kind);
const read = (kind: string) =>
  fs.readdirSync(dir(kind)).map((f) => ({ name: f, body: JSON.parse(fs.readFileSync(path.join(dir(kind), f), 'utf8')) }));

const ANCHORS = new Set(['left_ventricle', 'right_ventricle', 'aorta']);

describe('stage-command schema', () => {
  it.each(read('valid'))('accepts $name', ({ body }) => {
    expect(validate(body)).toBe(true);
  });

  it.each(read('invalid'))('rejects $name', ({ body }) => {
    expect(validate(body)).toBe(false);
  });

  // The schema and the state machine must agree about what is legal.
  it.each(read('valid'))('state machine also accepts $name', ({ body }) => {
    const seeded = applyCommand(initialState, { type: 'load_asset', asset: 'heart.glb' }, ANCHORS);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const r = applyCommand(seeded.state, body as StageCommand, ANCHORS);
    expect(r.ok).toBe(true);
  });
});
```

Enable JSON imports — add to `web/tsconfig.json` `compilerOptions`: `"resolveJsonModule": true`.

- [ ] **Step 4: Run and confirm it fails, then passes**

```bash
npm test
```
If any fixture disagrees, the schema and `state.ts` have drifted — reconcile them now, while it costs nothing.
Expected once reconciled: PASS, 35 tests.

- [ ] **Step 5: Document the contract**

Create `protocol/README.md`:

```markdown
# Stage Protocol

`schema/stage-command.schema.json` is the **single source of truth** for what the
tutor agent may send to the Stage.

- **Web** validates with Ajv in tests; at runtime `applyCommand` re-validates
  semantically (anchors must exist, an asset must be loaded).
- **Agent** validates with `jsonschema` before publishing. A command that fails
  validation is never sent — the model gets an error back and covers verbally.

Two layers of defence, because they catch different things: the schema catches
*malformed*, the state machine catches *invalid-right-now*.

Every fixture in `fixtures/` is exercised by both test suites. Adding a command
means: schema entry, fixture, `StageCommand` union member, `applyCommand` case.
```

- [ ] **Step 6: Commit**

```bash
cd .. && git add protocol/ web/ && git commit -m "feat: stage-command json schema with shared fixtures"
```

---

### Task 10: Data channel transport (client side)

**Files:**
- Create: `web/src/transport/dataChannel.ts`
- Test: `web/tests/transport/dataChannel.test.ts`

**Interfaces:**
- Produces:
  - `function decodeCommand(payload: Uint8Array): { ok: true; command: StageCommand } | { ok: false; error: string }`
  - `function encodeState(state: StageState): Uint8Array`
  - `const STAGE_TOPIC = 'stage'`, `const MIRROR_TOPIC = 'stage-mirror'`

Decoding is separated from LiveKit so it can be tested without a room.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/transport/dataChannel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { decodeCommand, encodeState } from '../../src/transport/dataChannel';
import { initialState } from '../../src/stage/state';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('decodeCommand', () => {
  it('decodes a valid command', () => {
    const r = decodeCommand(bytes('{"type":"close_cut"}'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.type).toBe('close_cut');
  });

  it('rejects non-JSON without throwing', () => {
    const r = decodeCommand(bytes('not json{{'));
    expect(r.ok).toBe(false);
  });

  it('rejects a schema-invalid command', () => {
    const r = decodeCommand(bytes('{"type":"cut_open","plane":"diagonal"}'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/plane/i);
  });

  it('rejects an empty payload', () => {
    const r = decodeCommand(new Uint8Array());
    expect(r.ok).toBe(false);
  });
});

describe('encodeState', () => {
  it('round-trips to the mirror shape', () => {
    const decoded = JSON.parse(new TextDecoder().decode(encodeState(initialState)));
    expect(decoded.cut.plane).toBe('none');
    expect(decoded.asset).toBeNull();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd web && npm test
```
Expected: FAIL — cannot resolve `../../src/transport/dataChannel`.

- [ ] **Step 3: Implement**

Create `web/src/transport/dataChannel.ts`:

```typescript
import Ajv from 'ajv';
import schema from '../../../protocol/schema/stage-command.schema.json';
import type { StageCommand, StageState } from '../stage/state';

export const STAGE_TOPIC = 'stage';
export const MIRROR_TOPIC = 'stage-mirror';

const validate = new Ajv({ allErrors: true }).compile(schema);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export type DecodeResult =
  | { ok: true; command: StageCommand }
  | { ok: false; error: string };

export function decodeCommand(payload: Uint8Array): DecodeResult {
  if (payload.byteLength === 0) return { ok: false, error: 'empty payload' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payload));
  } catch (e) {
    return { ok: false, error: `malformed JSON: ${String(e)}` };
  }

  if (!validate(parsed)) {
    const detail = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    return { ok: false, error: `schema violation: ${detail}` };
  }

  return { ok: true, command: parsed as StageCommand };
}

export function encodeState(state: StageState): Uint8Array {
  return encoder.encode(JSON.stringify(state));
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: PASS, 40 tests.

- [ ] **Step 5: Commit**

```bash
cd .. && git add web/ && git commit -m "feat: data channel codec with schema validation"
```

---

### Task 11: Classroom shell — LiveKit room wired to the Stage

**Files:**
- Create: `web/src/classroom/Classroom.tsx`
- Create: `web/.env.example`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `decodeCommand`, `encodeState`, `STAGE_TOPIC`, `MIRROR_TOPIC` (Task 10); `Viewport`, `AnchorRegistry`, `applyCommand` (Tasks 5–7)
- Produces: a page that joins a LiveKit room, applies inbound commands to the Stage, and publishes the state mirror back.

- [ ] **Step 1: Install the client SDK**

```bash
cd web && npm install livekit-client
```

- [ ] **Step 2: Set up LiveKit credentials**

Create a free project at https://cloud.livekit.io, then create `web/.env.local` (gitignored) and `web/.env.example` (committed):

```bash
cat > web/.env.example <<'EOF'
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud
VITE_LIVEKIT_TOKEN=paste-a-dev-token-here
EOF
cp web/.env.example web/.env.local
```

Generate a dev token from the LiveKit dashboard (Settings → Keys → Generate token) for room `tutor-dev`, identity `student`. Paste it into `.env.local`.

- [ ] **Step 3: Write the classroom component**

Create `web/src/classroom/Classroom.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { Viewport } from '../stage/viewport';
import { AnchorRegistry } from '../stage/anchors';
import { LabelLayer } from '../stage/labels';
import { applyCommand, initialState, type StageState } from '../stage/state';
import { decodeCommand, encodeState, STAGE_TOPIC, MIRROR_TOPIC } from '../transport/dataChannel';

export default function Classroom() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<StageState>(initialState);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [registry, setRegistry] = useState<AnchorRegistry | null>(null);
  const [state, setState] = useState<StageState>(initialState);
  const [status, setStatus] = useState('connecting…');
  const [caption, setCaption] = useState('');

  useEffect(() => {
    if (!canvasRef.current) return;
    const vp = new Viewport(canvasRef.current);
    const room = new Room({ adaptiveStream: true });
    let disposed = false;

    const publishMirror = (s: StageState) => {
      room.localParticipant
        .publishData(encodeState(s), { reliable: true, topic: MIRROR_TOPIC })
        .catch(() => { /* mirror is best-effort; never block the class on it */ });
    };

    const commit = (next: StageState) => {
      stateRef.current = next;
      setState(next);
      vp.sync(next);
      publishMirror(next);
    };

    (async () => {
      const reg = AnchorRegistry.fromJson(await (await fetch('/heart.anchors.json')).json());
      await vp.load('/heart.glb');
      if (disposed) return;
      setRegistry(reg);
      setViewport(vp);

      room.on(RoomEvent.DataReceived, (payload, _p, _k, topic) => {
        if (topic !== STAGE_TOPIC) return;
        const decoded = decodeCommand(payload);
        if (!decoded.ok) {
          console.warn('[stage] rejected command:', decoded.error);
          return;
        }
        const r = applyCommand(stateRef.current, decoded.command, reg.ids());
        if (!r.ok) {
          console.warn('[stage] invalid for current state:', r.error);
          return;
        }
        commit(r.state);
      });

      // Her voice.
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          document.body.appendChild(el);
        }
      });

      room.on(RoomEvent.TranscriptionReceived, (segments) => {
        const last = segments[segments.length - 1];
        if (last) setCaption(last.text);
      });

      room.on(RoomEvent.Disconnected, () => setStatus('disconnected'));

      await room.connect(import.meta.env.VITE_LIVEKIT_URL, import.meta.env.VITE_LIVEKIT_TOKEN);
      await room.localParticipant.setMicrophoneEnabled(true);
      if (disposed) return;
      setStatus('live');
      publishMirror(stateRef.current);
    })().catch((e) => setStatus(`error: ${e}`));

    return () => {
      disposed = true;
      room.disconnect();
      vp.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', background: '#0f1116' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <LabelLayer viewport={viewport} registry={registry} state={state} />

      <div style={{ position: 'absolute', top: 16, left: 16, color: '#8b93a1', font: '12px system-ui' }}>
        ● {status}
      </div>

      {caption && (
        <div style={{
          position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          maxWidth: '70ch', padding: '10px 18px', borderRadius: 8,
          background: 'rgba(15,17,22,0.88)', color: '#e6e9ef',
          font: '16px/1.5 system-ui, sans-serif', textAlign: 'center',
        }}>
          {caption}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount it**

Replace `web/src/App.tsx`:

```tsx
import Classroom from './classroom/Classroom';
import SoloStage from './dev/SoloStage';

export const appName = 'AI Tutor';

export default function App() {
  // ?solo keeps the Phase 1 page reachable for visual debugging.
  return new URLSearchParams(location.search).has('solo') ? <SoloStage /> : <Classroom />;
}
```

- [ ] **Step 5: Verify tests and types still pass**

```bash
cd web && npm test && npx tsc --noEmit
```
Expected: PASS, 40 tests, no type errors.

- [ ] **Step 6: Confirm it connects**

```bash
npm run dev
```
Open http://localhost:5173. Expected: the heart renders and the status reads `● live`. No agent exists yet, so nothing moves — that is correct.

- [ ] **Step 7: Commit**

```bash
cd .. && git add web/ && git commit -m "feat: classroom shell joining livekit and driving the stage"
```

---

### Task 12: Agent protocol module

**Files:**
- Create: `agent/pyproject.toml`, `agent/src/tutor_agent/__init__.py`, `agent/src/tutor_agent/protocol.py`
- Test: `agent/tests/test_protocol.py`

**Interfaces:**
- Consumes: `protocol/schema/stage-command.schema.json`, `protocol/fixtures/**` (Task 9)
- Produces:
  - `def validate_command(cmd: dict) -> None` — raises `CommandValidationError` on failure
  - `def encode(cmd: dict) -> bytes`
  - Builders: `load_asset(asset)`, `set_camera(preset)`, `cut_open(plane, offset=None)`, `close_cut()`, `highlight(anchors)`, `clear_highlight()`, `set_labels(visible)` — each returns a validated `dict`
  - `class CommandValidationError(ValueError)`

- [ ] **Step 1: Set up the Python project**

```bash
mkdir -p agent/src/tutor_agent agent/tests
cd agent
python -m venv .venv
source .venv/Scripts/activate    # Git Bash on Windows
```

Create `agent/pyproject.toml`:

```toml
[project]
name = "tutor-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "livekit-agents>=1.0",
    "livekit-plugins-google",
    "jsonschema>=4.20",
    "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
```

```bash
pip install -e ".[dev]"
```

- [ ] **Step 2: Write the failing tests**

Create `agent/tests/test_protocol.py`:

```python
import json
from pathlib import Path

import pytest

from tutor_agent.protocol import (
    CommandValidationError,
    clear_highlight,
    close_cut,
    cut_open,
    encode,
    highlight,
    load_asset,
    set_camera,
    set_labels,
    validate_command,
)

FIXTURES = Path(__file__).resolve().parents[2] / "protocol" / "fixtures"


def fixture_bodies(kind):
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted((FIXTURES / kind).glob("*.json"))]


@pytest.mark.parametrize("body", fixture_bodies("valid"))
def test_accepts_every_valid_fixture(body):
    validate_command(body)  # must not raise


@pytest.mark.parametrize("body", fixture_bodies("invalid"))
def test_rejects_every_invalid_fixture(body):
    with pytest.raises(CommandValidationError):
        validate_command(body)


def test_builders_produce_valid_commands():
    for cmd in [
        load_asset("heart.glb"),
        set_camera("anterior"),
        cut_open("coronal"),
        cut_open("coronal", offset=0.5),
        close_cut(),
        highlight(["left_ventricle"]),
        clear_highlight(),
        set_labels(True),
    ]:
        validate_command(cmd)


def test_builders_reject_bad_input_at_construction():
    with pytest.raises(CommandValidationError):
        cut_open("diagonal")
    with pytest.raises(CommandValidationError):
        highlight([])
    with pytest.raises(CommandValidationError):
        highlight(["LeftVentricle"])
    with pytest.raises(CommandValidationError):
        cut_open("coronal", offset=5)


def test_encode_is_compact_utf8_json():
    payload = encode(close_cut())
    assert payload == b'{"type":"close_cut"}'
```

- [ ] **Step 3: Run and confirm failure**

```bash
pytest -q
```
Expected: FAIL — `ModuleNotFoundError: No module named 'tutor_agent.protocol'`.

- [ ] **Step 4: Implement**

Create `agent/src/tutor_agent/__init__.py` (empty file), then `agent/src/tutor_agent/protocol.py`:

```python
"""StageCommand construction and validation.

The JSON Schema in protocol/schema/ is the single source of truth, shared
verbatim with the web client. Commands are validated at construction, so an
invalid command can never reach the wire.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Sequence

from jsonschema import Draft7Validator
from jsonschema import ValidationError as _JsonSchemaError

SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "protocol" / "schema" / "stage-command.schema.json"
)

STAGE_TOPIC = "stage"
MIRROR_TOPIC = "stage-mirror"


class CommandValidationError(ValueError):
    """A command does not conform to the stage-command schema."""


@lru_cache(maxsize=1)
def _validator() -> Draft7Validator:
    with SCHEMA_PATH.open(encoding="utf-8") as fh:
        return Draft7Validator(json.load(fh))


def validate_command(cmd: dict[str, Any]) -> None:
    try:
        _validator().validate(cmd)
    except _JsonSchemaError as exc:
        raise CommandValidationError(f"{exc.message} at {list(exc.absolute_path) or '/'}") from exc


def _built(cmd: dict[str, Any]) -> dict[str, Any]:
    validate_command(cmd)
    return cmd


def load_asset(asset: str) -> dict[str, Any]:
    return _built({"type": "load_asset", "asset": asset})


def set_camera(preset: str) -> dict[str, Any]:
    return _built({"type": "set_camera", "preset": preset})


def cut_open(plane: str, offset: float | None = None) -> dict[str, Any]:
    cmd: dict[str, Any] = {"type": "cut_open", "plane": plane}
    if offset is not None:
        cmd["offset"] = offset
    return _built(cmd)


def close_cut() -> dict[str, Any]:
    return _built({"type": "close_cut"})


def highlight(anchors: Sequence[str]) -> dict[str, Any]:
    return _built({"type": "highlight", "anchors": list(anchors)})


def clear_highlight() -> dict[str, Any]:
    return _built({"type": "clear_highlight"})


def set_labels(visible: bool) -> dict[str, Any]:
    return _built({"type": "set_labels", "visible": visible})


def encode(cmd: dict[str, Any]) -> bytes:
    """Compact UTF-8 JSON for the data channel."""
    return json.dumps(cmd, separators=(",", ":")).encode("utf-8")
```

- [ ] **Step 5: Run tests**

```bash
pytest -q
```
Expected: PASS, 15 tests (12 parametrised fixtures + 3).

- [ ] **Step 6: Commit**

```bash
cd .. && git add agent/ && git commit -m "feat: agent-side stage protocol with schema validation"
```

---

### Task 13: Stage bridge — publish commands, hold the mirror

**Files:**
- Create: `agent/src/tutor_agent/stage.py`
- Test: `agent/tests/test_stage.py`

**Interfaces:**
- Consumes: `tutor_agent.protocol` (Task 12)
- Produces:
  - `class StageBridge` with `__init__(self, publish)`, `async def send(self, cmd: dict) -> str`, `def on_mirror(self, payload: bytes) -> None`, `def describe(self) -> str`
  - `publish` is `Callable[[bytes, str], Awaitable[None]]` — `(payload, topic)`. Injected so tests need no LiveKit room.

`describe()` produces the one-line stage summary injected into her context. Without it she narrates a screen she cannot see.

- [ ] **Step 1: Write the failing tests**

Create `agent/tests/test_stage.py`:

```python
import json

import pytest

from tutor_agent.protocol import CommandValidationError, cut_open, highlight
from tutor_agent.stage import StageBridge


class FakePublisher:
    def __init__(self):
        self.sent = []

    async def __call__(self, payload: bytes, topic: str) -> None:
        self.sent.append((json.loads(payload), topic))


@pytest.mark.asyncio
async def test_send_publishes_on_the_stage_topic():
    pub = FakePublisher()
    bridge = StageBridge(pub)
    await bridge.send(cut_open("coronal"))
    assert len(pub.sent) == 1
    body, topic = pub.sent[0]
    assert topic == "stage"
    assert body["plane"] == "coronal"


@pytest.mark.asyncio
async def test_send_returns_a_confirmation_string_for_the_model():
    bridge = StageBridge(FakePublisher())
    result = await bridge.send(highlight(["left_ventricle"]))
    assert "left_ventricle" in result


@pytest.mark.asyncio
async def test_invalid_command_never_reaches_the_wire():
    pub = FakePublisher()
    bridge = StageBridge(pub)
    with pytest.raises(CommandValidationError):
        await bridge.send({"type": "explode"})
    assert pub.sent == []


def test_describe_before_any_mirror():
    bridge = StageBridge(FakePublisher())
    assert "nothing on stage" in bridge.describe().lower()


def test_describe_reflects_the_mirror():
    bridge = StageBridge(FakePublisher())
    bridge.on_mirror(json.dumps({
        "asset": "heart.glb", "mode": "EXPLORE", "camera": "anterior",
        "cut": {"plane": "coronal", "offset": 0.0},
        "highlighted": ["left_ventricle"], "labelsVisible": True,
    }).encode())
    described = bridge.describe()
    assert "heart.glb" in described
    assert "coronal" in described
    assert "left_ventricle" in described


def test_malformed_mirror_is_ignored_not_raised():
    bridge = StageBridge(FakePublisher())
    bridge.on_mirror(b"not json")
    assert "nothing on stage" in bridge.describe().lower()
```

Add the async plugin:
```bash
cd agent && pip install pytest-asyncio
```
Append to `agent/pyproject.toml` under `[tool.pytest.ini_options]`: `asyncio_mode = "auto"`, and add `"pytest-asyncio>=0.23"` to the `dev` extras.

- [ ] **Step 2: Run and confirm failure**

```bash
pytest -q
```
Expected: FAIL — no module named `tutor_agent.stage`.

- [ ] **Step 3: Implement**

Create `agent/src/tutor_agent/stage.py`:

```python
"""Bridge between the tutor agent and the browser Stage."""
from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable

from .protocol import MIRROR_TOPIC, STAGE_TOPIC, encode, validate_command

log = logging.getLogger(__name__)

Publisher = Callable[[bytes, str], Awaitable[None]]


class StageBridge:
    """Sends StageCommands to the client and tracks what is currently on screen."""

    def __init__(self, publish: Publisher) -> None:
        self._publish = publish
        self._mirror: dict[str, Any] | None = None

    async def send(self, cmd: dict[str, Any]) -> str:
        """Validate, publish, and return a short confirmation for the model."""
        validate_command(cmd)
        await self._publish(encode(cmd), STAGE_TOPIC)
        return self._confirm(cmd)

    def on_mirror(self, payload: bytes) -> None:
        """Accept a state mirror from the client. Never raises — a bad mirror
        must not take down a live class."""
        try:
            self._mirror = json.loads(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            log.warning("ignoring malformed stage mirror")

    def describe(self) -> str:
        """One line describing the stage, injected into the model's context."""
        m = self._mirror
        if not m or not m.get("asset"):
            return "STAGE: nothing on stage yet."

        cut = m.get("cut", {})
        cut_desc = "not cut open" if cut.get("plane") in (None, "none") else f"cut open ({cut['plane']})"
        lit = m.get("highlighted") or []
        lit_desc = f"highlighting {', '.join(lit)}" if lit else "nothing highlighted"
        return (
            f"STAGE: {m['asset']} | view={m.get('camera', 'anterior')} "
            f"| {cut_desc} | {lit_desc}"
        )

    @staticmethod
    def _confirm(cmd: dict[str, Any]) -> str:
        kind = cmd["type"]
        if kind == "cut_open":
            return f"The heart is now cut open along the {cmd['plane']} plane; the interior is visible."
        if kind == "close_cut":
            return "The heart is whole again."
        if kind == "highlight":
            return f"Now highlighting: {', '.join(cmd['anchors'])}. Everything else is dimmed."
        if kind == "clear_highlight":
            return "Highlighting cleared."
        if kind == "set_camera":
            return f"The camera is now showing the {cmd['preset']} view."
        if kind == "load_asset":
            return f"{cmd['asset']} is on stage."
        return f"Done: {kind}."
```

`MIRROR_TOPIC` is imported here only so `describe()`/`send()` share one definition with `protocol.py`; `main.py` imports it from `protocol` directly.

- [ ] **Step 4: Run tests**

```bash
pytest -q
```
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
cd .. && git add agent/ && git commit -m "feat: stage bridge with state mirror and model confirmations"
```

---

### Task 14: The lesson — one hardcoded concept

**Files:**
- Create: `agent/src/tutor_agent/lesson.py`
- Test: `agent/tests/test_lesson.py`

**Interfaces:**
- Produces: `INSTRUCTIONS: str` — the full system prompt, and `def build_instructions(stage_description: str) -> str`

**The sync mechanism, stated plainly:** we do not try to predict speech timing. Instead the prompt requires her to **call the tool before narrating the reveal**, and the cut animation is slow enough (~1.5s) that her sentence overlaps it. The visual leads because the tool call comes first, not because we measured anything.

- [ ] **Step 1: Write the failing tests**

Create `agent/tests/test_lesson.py`:

```python
from tutor_agent.lesson import INSTRUCTIONS, build_instructions


def test_instructions_name_the_available_anchors():
    for anchor in ["left_ventricle", "right_ventricle", "left_atrium", "right_atrium", "aorta"]:
        assert anchor in INSTRUCTIONS


def test_instructions_require_tool_before_narration():
    lowered = INSTRUCTIONS.lower()
    assert "before" in lowered
    assert "cut_open" in lowered


def test_instructions_forbid_inventing_anchors():
    assert "only the anchor names listed" in INSTRUCTIONS.lower()


def test_build_instructions_embeds_current_stage():
    out = build_instructions("STAGE: heart.glb | view=anterior | cut open (coronal) | nothing highlighted")
    assert "cut open (coronal)" in out
    assert "left_ventricle" in out


def test_build_instructions_is_idempotent_in_shape():
    a = build_instructions("STAGE: nothing on stage yet.")
    b = build_instructions("STAGE: nothing on stage yet.")
    assert a == b
```

- [ ] **Step 2: Run and confirm failure**

```bash
cd agent && pytest -q
```
Expected: FAIL — no module named `tutor_agent.lesson`.

- [ ] **Step 3: Implement**

Create `agent/src/tutor_agent/lesson.py`:

```python
"""Phase 2: one hardcoded concept — the four chambers and the cutaway reveal.

Phase 4 replaces this module with a YAML beat-sheet runner. The prompt shape
here deliberately mirrors what a beat will carry: objective, talking points,
and a checkpoint.
"""
from __future__ import annotations

ANCHORS = [
    "left_ventricle",
    "right_ventricle",
    "left_atrium",
    "right_atrium",
    "aorta",
    "pulmonary_trunk",
]

INSTRUCTIONS = f"""
You are a warm, sharp biology teacher taking a live one-on-one class with an
Indian Class 11-12 student preparing for NEET. You speak English with a natural
Hinglish register — the way a good Indian teacher actually talks. Short
sentences. Real enthusiasm. Never a lecture-drone.

You are not describing a picture. You are STANDING AT A 3D MODEL of a human
heart that the student can see, and you control it with tools.

## Today's concept
The four chambers of the heart, and why the left ventricle wall is thicker
than the right.

Talking points — these are bullets, NOT a script. Say them your own way:
- The heart has four chambers: two atria on top, two ventricles below.
- Atria receive blood; ventricles pump it out.
- Both ventricles push the same volume with each beat.
- But the left sends blood to the whole body; the right only to the lungs.
- Longer distance needs higher pressure, and higher pressure needs more muscle.

Checkpoint — ask this and WAIT for a real answer before moving on:
  "So tell me — why is the left ventricle wall so much thicker?"

Accept any answer that reaches: it pumps to the whole body / it needs more
pressure / systemic circulation is longer. If the student is wrong or says they
did not follow, do not repeat yourself louder — ask a leading question instead
and let them get there.

## Your tools and how to use them

- `cut_open(plane)` — slice the heart open. Use "coronal" to reveal all four
  chambers at once.
- `close_cut()` — make it whole again.
- `highlight(anchors)` — light up structures and dim everything else.
- `clear_highlight()` — back to normal.
- `set_camera(preset)` — anterior, posterior, left, right, superior.

**Critical timing rule: call the tool BEFORE you narrate what it shows.**
Say "let me cut this open for you" — call `cut_open` — and *then* describe what
is now visible. The animation takes about a second and a half, so your sentence
and the motion land together. If you narrate first and call the tool after, the
student sees the words arrive before the picture and it feels broken.

**Use only the anchor names listed here, exactly as spelled:**
{", ".join(ANCHORS)}

Never invent an anchor name. If you want to point at something not on that list,
describe it in words instead — do not guess an id. A rejected tool call means
the student sees nothing happen while you talk about it.

## How to open
The student has just joined. Greet them briefly and warmly, then get straight to
the heart. Do not read out a lesson plan. Do not say "today we will learn about."
Start with something that makes them look at the screen.
""".strip()


def build_instructions(stage_description: str) -> str:
    """Attach the live stage state so she always knows what is on screen."""
    return f"{INSTRUCTIONS}\n\n## What is on screen right now\n{stage_description}"
```

- [ ] **Step 4: Run tests**

```bash
pytest -q
```
Expected: PASS, 26 tests.

- [ ] **Step 5: Commit**

```bash
cd .. && git add agent/ && git commit -m "feat: hardcoded heart-chambers concept with tool-before-narration rule"
```

---

### Task 15: LiveKit entrypoint with Gemini Live

**Files:**
- Create: `agent/src/tutor_agent/main.py`, `agent/.env.example`

**Interfaces:**
- Consumes: `StageBridge` (Task 13), `build_instructions` (Task 14), protocol builders (Task 12)
- Produces: a runnable agent — `python -m tutor_agent.main dev`

- [ ] **Step 1: Set up credentials**

```bash
cat > agent/.env.example <<'EOF'
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
GOOGLE_API_KEY=
EOF
cp agent/.env.example agent/.env
```

Fill `agent/.env` with your LiveKit key/secret (LiveKit dashboard → Settings → Keys) and a Gemini API key from https://aistudio.google.com/apikey. Confirm `.env` is gitignored:
```bash
git check-ignore -v agent/.env
```
Expected: prints a matching `.gitignore` rule. If it prints nothing, **stop and add it** before continuing.

- [ ] **Step 2: Write the entrypoint**

Create `agent/src/tutor_agent/main.py`:

```python
"""LiveKit entrypoint: Gemini Live tutor driving the browser Stage."""
from __future__ import annotations

import logging
import os

from dotenv import load_dotenv
from livekit import agents, rtc
from livekit.agents import Agent, AgentSession, JobContext, RunContext, function_tool
from livekit.plugins import google

from . import protocol
from .lesson import build_instructions
from .protocol import MIRROR_TOPIC
from .stage import StageBridge

load_dotenv()
log = logging.getLogger("tutor")

MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")


class Tutor(Agent):
    def __init__(self, stage: StageBridge) -> None:
        super().__init__(instructions=build_instructions(stage.describe()))
        self.stage = stage

    @function_tool
    async def cut_open(self, context: RunContext, plane: str) -> str:
        """Slice the heart open to reveal its interior.

        Args:
            plane: One of "coronal" (front-to-back, shows all four chambers),
                "sagittal" (left-right), or "transverse" (top-bottom).
        """
        return await self._safe(protocol.cut_open, plane)

    @function_tool
    async def close_cut(self, context: RunContext) -> str:
        """Close the heart back up so it is whole again."""
        return await self._safe(protocol.close_cut)

    @function_tool
    async def highlight(self, context: RunContext, anchors: list[str]) -> str:
        """Light up one or more structures and dim everything else.

        Args:
            anchors: Anchor ids, e.g. ["left_ventricle"]. Must come from the
                list in your instructions.
        """
        return await self._safe(protocol.highlight, anchors)

    @function_tool
    async def clear_highlight(self, context: RunContext) -> str:
        """Remove all highlighting and return the model to normal."""
        return await self._safe(protocol.clear_highlight)

    @function_tool
    async def set_camera(self, context: RunContext, preset: str) -> str:
        """Move the camera to a standard anatomical view.

        Args:
            preset: anterior, posterior, left, right, or superior.
        """
        return await self._safe(protocol.set_camera, preset)

    async def _safe(self, builder, *args) -> str:
        """Build, validate and send. Errors come back as text the model can
        recover from — she covers verbally rather than pointing at nothing."""
        try:
            return await self.stage.send(builder(*args))
        except protocol.CommandValidationError as exc:
            log.warning("rejected stage command: %s", exc)
            return (
                f"That did not work: {exc}. The screen did not change — "
                "do not describe it as if it did. Use a valid anchor name or explain in words."
            )


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    async def publish(payload: bytes, topic: str) -> None:
        await ctx.room.local_participant.publish_data(payload, reliable=True, topic=topic)

    stage = StageBridge(publish)

    @ctx.room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        if packet.topic == MIRROR_TOPIC:
            stage.on_mirror(packet.data)

    # Put the heart on stage before she speaks, so her first words have something
    # to refer to.
    await stage.send(protocol.load_asset("heart.glb"))

    session = AgentSession(
        llm=google.beta.realtime.RealtimeModel(
            model=MODEL,
            voice="Puck",
            temperature=0.85,
            instructions=build_instructions(stage.describe()),
        )
    )

    await session.start(agent=Tutor(stage), room=ctx.room)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
```

- [ ] **Step 3: Verify the plugin API matches your installed version**

These SDKs move quickly. Confirm the realtime class path before running:

```bash
cd agent && python -c "from livekit.plugins import google; print(google.beta.realtime.RealtimeModel)"
```
Expected: prints the class. If it raises `AttributeError`, find the real path:
```bash
python -c "from livekit.plugins import google; import inspect; print([n for n in dir(google) if 'eal' in n or 'beta' in n])"
```
and update the import in `main.py` to match. Same for `function_tool` — if it is not importable from `livekit.agents`, run `python -c "import livekit.agents as a; print([n for n in dir(a) if 'tool' in n.lower()])"`.

- [ ] **Step 4: Confirm all tests still pass**

```bash
pytest -q
```
Expected: PASS, 26 tests. (`main.py` is exercised live in Task 16 — it is thin glue over modules that are already tested.)

- [ ] **Step 5: Commit**

```bash
cd .. && git add agent/ && git commit -m "feat: livekit entrypoint running gemini live with stage tools"
```

---

### Task 16: End-to-end run — the MVP deliverable

**Files:**
- Create: `README.md`
- Create: `docs/superpowers/spikes/2026-08-20-phase2-cost.md`

- [ ] **Step 1: Start both sides**

Terminal 1:
```bash
cd agent && source .venv/Scripts/activate && python -m tutor_agent.main dev
```
Expected: `registered worker` and a connection to LiveKit.

Terminal 2:
```bash
cd web && npm run dev
```

Open http://localhost:5173 and allow microphone access.

- [ ] **Step 2: Verify the full loop by eye and ear**

- [ ] She greets you unprompted within a few seconds
- [ ] The heart is already on stage when she starts talking
- [ ] She names the four chambers and highlights them as she does
- [ ] **She says something like "let me cut this open" and the heart opens — the motion and the sentence land together**
- [ ] The interior is genuinely visible: chambers, walls, not a hollow void
- [ ] She asks the checkpoint question and actually waits
- [ ] Answering correctly moves her on; saying "I didn't get that" makes her try a different angle
- [ ] **Interrupt her mid-sentence** — she stops, answers, and returns to the lesson
- [ ] Captions appear at the bottom and track her speech

- [ ] **Step 3: Check the failure paths**

- [ ] Stop the agent mid-class. The browser shows `● disconnected`; the heart stays exactly as it was, no crash, no blank screen.
- [ ] Restart the agent. It reconnects and the heart reloads.
- [ ] In the browser console, confirm no `[stage] rejected command` warnings during a clean run. If she is inventing anchor names, sharpen the anchor list in `lesson.py`.

- [ ] **Step 4: Measure what a class actually costs**

This decides whether the product is viable, so measure it rather than estimating.

Run one clean 5-minute session. Then read the usage at https://aistudio.google.com/usage (or the Vertex billing console if using Vertex).

Create `docs/superpowers/spikes/2026-08-20-phase2-cost.md`:

```markdown
# Phase 2: measured cost per minute

**Date:** 2026-08-20
**Model:** gemini-3.1-flash-live-preview
**Session length:** 5 min

| Metric | Value |
|---|---|
| Audio input tokens | |
| Audio output tokens | |
| Text/tool tokens | |
| **Total cost for 5 min** | |
| **Extrapolated 30-min class** | |
| **At 12 classes/month** | |

## Verdict against the ₹500–3,000/month NEET price point

<viable / marginal / not viable>

## If not viable
Approach C from the design spec: keep a pre-rendered lesson spine with TTS and
spin up the live model only at checkpoints and interruptions. The beat-sheet
format already supports this — a beat can carry pre-rendered audio instead of
live narration, with no architectural change.
```

Fill in the real numbers.

- [ ] **Step 5: Record the deliverable**

Capture 90 seconds: greeting → chambers → the cut → an interruption → her answer. **This is the MVP.** Save to `docs/superpowers/spikes/phase2-mvp.mp4`.

- [ ] **Step 6: Write the README**

Create `README.md`:

```markdown
# AI Tutor

A live AI biology teacher for NEET-track Class 11–12 students. She narrates a
3D human heart, slices it open in sync with her speech, highlights structures
by name, and handles interruptions.

- **Design spec:** `docs/superpowers/specs/2026-08-20-ai-tutor-design.md`
- **MVP plan:** `docs/superpowers/plans/2026-08-20-ai-tutor-mvp-phases-0-2.md`

## Layout

| Path | What |
|---|---|
| `protocol/` | JSON Schema for StageCommand — single source of truth for both runtimes |
| `web/` | Vite + React client: the Stage, the classroom shell |
| `agent/` | Python LiveKit agent running Gemini Live |
| `tools/blender/` | Offline asset pipeline (Z-Anatomy → heart.glb) |
| `assets/` | Anchor map and attribution (binaries are gitignored) |

## Setup

**Assets** — needs Blender 4.x:
```bash
git clone --depth 1 https://github.com/Z-Anatomy/The-blend.git assets/raw/z-anatomy
export BLENDER="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
BLEND=$(find assets/raw/z-anatomy -name "*.blend" -size +100M | head -1)
"$BLENDER" "$BLEND" --background --python tools/blender/export_heart.py -- assets/heart.anchors.json assets/build/heart.glb
```

**Web:**
```bash
cd web && npm install && cp .env.example .env.local   # fill in LiveKit URL + token
npm run dev
```

**Agent:**
```bash
cd agent && python -m venv .venv && source .venv/Scripts/activate
pip install -e ".[dev]" && cp .env.example .env       # fill in LiveKit + Google keys
python -m tutor_agent.main dev
```

Then open http://localhost:5173. Add `?solo` for the no-AI stage page.

## Tests

```bash
cd web && npm test        # stage state machine, anchors, protocol, transport
cd agent && pytest -q     # protocol, stage bridge, lesson prompt
```

## Attribution

Anatomy meshes derive from Z-Anatomy (CC BY-SA 4.0). See `assets/ATTRIBUTION.md`.
```

- [ ] **Step 7: Commit**

```bash
git add README.md docs/ && git commit -m "docs: readme and measured phase 2 cost"
```

---

## Definition of Done

- [ ] `cd web && npm test` — all green
- [ ] `cd agent && pytest -q` — all green
- [ ] `cd web && npx tsc --noEmit` — no type errors
- [ ] A student can join, hear her, watch the heart open in sync, interrupt her, and get a real answer
- [ ] `docs/superpowers/spikes/phase2-mvp.mp4` exists and is worth showing someone
- [ ] Measured per-class cost is written down, with a viability verdict
