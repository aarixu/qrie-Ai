# @ai-tutor/graphics

Finding a picture for a noun.

The board wants "boy", "school", "clock". It does not want an icon name, and it
must never fail.

**Pure.** Handed a catalogue, asked a question. Loading the catalogue is somebody
else's job, because the sets live in a 443 MB package that must never reach a
browser.

## Why we do not draw these

Nouns are the one thing that is already drawn, thousands of times over, under
licences that cost nothing. `@iconify/json` carries **299,393 icons across 205
permissively-licensed sets**. Generating a "boy" would cost money, take thirty
seconds, and be worse.

Preference order is `noto` (Apache 2.0) → `fluent-emoji` (MIT) → `ph` (MIT) →
`tabler` (MIT): a school board wants a picture a child recognises before it
wants a tidy glyph. None of them asks for attribution in-product.

## Usage

```ts
const hit = resolveNoun('school', sets);
const glyph = hit?.glyph ?? pencilGlyph('school');
```

## How a noun is found

Widening, one strategy at a time, never widening while a narrower one still
matches:

1. the exact name
2. a known synonym — `home` is filed as `house`, `bike` as `bicycle`
3. a name that starts with the word
4. the **shortest** name containing it, so `school` beats `school-bus`

Articles and plurals are stripped first, because narration writes "the schools"
and sets file `school`.

The synonym list is short on purpose. It is not a thesaurus — every entry is
there because a real lesson missed once.

## When nothing has it

`pencilGlyph` draws what a teacher draws for a thing she cannot draw: a slightly
uneven circle with the word inside it. So "photosynthesis" is a label rather
than a blank, and the class carries on.

Its wobble is derived from the word, so one noun is one shape every time. A
placeholder that changed between beats would read as two different objects.

## Depends on

Nothing.
