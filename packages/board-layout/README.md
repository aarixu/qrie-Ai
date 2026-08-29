# @ai-tutor/board-layout

The Canvas Engine. It takes what the tutor wants on the board and works out
where every pixel of it goes.

**Pure geometry.** No React, no DOM, no model. Give it instructions, get back
positioned elements.

## Why it exists

The planner used to choose coordinates. It put a box at y 355..475 and then a
line of text at y 425, and the board drew exactly that — one printed over the
other. It was not a bad model; it was a model doing arithmetic on a grid it has
never seen.

So it does not get a grid any more. It says "a card, a diagram, a caption" and
this package decides the rest. **Two things landing on top of each other is not
a bug to validate against — it is no longer expressible.**

That split is the one the teaching architecture rests on:

```
LLM = the teacher's brain      what to teach, and what belongs on the board
board-layout = her hand        where it goes
stage = the whiteboard         how it looks
```

## Usage

```ts
const { elements, laid } = layoutBeat({
  id: 'b2',
  topic: 'Units',
  narration: 'Distance is in metres, time in seconds…',
  board: [
    { do: 'title', text: 'Units & Nature of Speed' },
    { do: 'card', heading: 'SI Unit', body: 'm/s', tone: 'accent' },
    { do: 'card', heading: 'Everyday Unit', body: 'km/h' },
    { do: 'caption', text: 'Speed tells you how fast, not where to.' },
  ],
});

<Scene lesson={{ ...lesson, elements }} visible={laid.show} focus={laid.focus} />;
```

## How it lays out

Three fixed bands. **TOP** holds the heading, **BOTTOM** holds the one-line
caption, and everything the lesson is about lives in **MAIN**. Nothing from one
band can reach into another, which is what makes "a title never collides with
the teaching" true by construction.

Inside MAIN, instructions stack top to bottom with a gutter. A picture, a chart
or a note that needs the room takes whatever is left over after the fixed-height
blocks have had theirs — so a beat with only a diagram gets a full-height
diagram, and the same diagram beside an equation is shorter. A stack with
nothing flexible in it is centred rather than left hanging from the top.

A **run of `card` instructions becomes one row**: equal widths, aligned tops,
wrapping to a second row when they would get too narrow. That is what a person
means by two cards, and working it out is exactly the arithmetic a model gets
wrong.

`point` places nothing. It only decides what is bright, and it is dropped if the
picture it names is not on the board this beat — otherwise the tutor gestures at
nothing and nobody finds out at runtime.

## A card's box carries no label

A card is a box plus two lines of text. The box's own `label` is deliberately
empty: the renderer centres a label in its box, so a label and a body line would
fight for the same middle. That fight is the original bug, in miniature.

## Depends on

`@ai-tutor/lesson-format`. Nothing else.
