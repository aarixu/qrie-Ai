# tools/gen-images

Generates a lesson's artwork with Google's image models (Nano Banana family).
**Authoring time only** — nothing here ever runs in the student app, and the
generated files are committed alongside the lesson.

## Usage

```bash
# See the prompts without spending quota
node tools/gen-images/src/cli.ts --lesson content/class10-nutrition --dry-run

# Generate the missing images
GEMINI_API_KEY=... node tools/gen-images/src/cli.ts --lesson content/class10-nutrition

# Redo everything, including images that already exist
GEMINI_API_KEY=... node tools/gen-images/src/cli.ts --lesson content/class10-nutrition --force
```

The lesson is validated **before** any network call — generating art for a
broken lesson wastes quota and hides the real problem.

## Adding an image to a lesson

1. Add an `image` element. Its `src` must be `assets/<id>.png`, matching
   `planFilename(id, mimeType)`:

   ```json
   { "kind": "image", "id": "leaf_photo", "x": 120, "y": 180, "w": 400, "h": 300,
     "src": "assets/leaf_photo.png",
     "alt": "a green leaf with sunlight falling on it, showing tiny pores" }
   ```

2. Show it in a beat like any other element (`"show": [..., "leaf_photo"]`).
3. Run the CLI. The file lands in `content/<lesson>/assets/`.

`alt` **is** the prompt subject, so write it as a description of the picture you
want — and it doubles as real accessibility text in the app.

## What the prompts enforce

- **No text inside the image.** The canvas draws its own labels; generated
  lettering is unreliable and cannot be translated later.
- The app's palette on a pure white background, so artwork sits with the
  surrounding SVG instead of reading as pasted-in clip art.
- A single centred subject with generous margins, at the element's own aspect
  ratio, legible on a phone.

## Models and quota

| Env | Default | Notes |
|---|---|---|
| `IMAGE_MODEL` | `gemini-3.1-flash-image` | Practical default for bulk authoring |
| | `nano-banana-pro-preview` | Best quality, tightest free-tier quota |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | — | Required unless `--dry-run` |

Free-tier image quota is small and shared across the image models. A `429` is
reported as such, per element; the run continues and reports what failed, so
re-running after the reset fills in only the gaps.

## Depends on

`packages/lesson-format` (types + validation), imported by relative path to the
leaf modules — the package index barrels re-export values through extensionless
specifiers, which Node's type stripping cannot resolve.
