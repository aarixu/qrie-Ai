# packages/ledger

The append-only record of what a student actually did.

## Why it exists

Before this, one answer in class produced one line of state:

```ts
answeredRight[outcomeId] += 1
```

A counter. Discarded at that moment: which option they chose, what they *said*,
how long they took, which attempt it was, whether a hint had already been given,
the judge's reason, the named misconception, and the time.

Five of the sixteen systems in the product brief are functions of that discarded
data — misconception diagnosis, assisted-vs-unassisted mastery, spaced
retrieval, metacognitive calibration and the learning scientist — and so is the
primary metric, *unassisted mastery gain per learning minute*.

Everything else can be built in any order. **This cannot be backfilled.**

## API

```ts
emptyOutbox(): Outbox
startSession(outbox, { id, at, source, topicRef?, lessonId? }): Outbox
record(outbox, { id, at, kind, surface, outcomeIds?, topicRef?, payload }): Outbox
recordAnswer(outbox, { id, at, surface, outcomeIds, correct, ms, attempt,
                       assistanceRung, hintsShown, ... }): Outbox
endSession(outbox, { id, at, activeMs, completed }): Outbox

batch(outbox, max?): LedgerEvent[]        // the next slice to send
acknowledge(outbox, ids): Outbox          // only after a confirmed write

normaliseAnswer(raw, { flagged?, maxChars? }): string | undefined
```

## Rules worth knowing

- **Pure.** No clock, no storage, no network. Ids and timestamps are handed in,
  because an outbox that minted its own could not be replayed — and replay is
  the only real test that these rows are a record rather than a log.
- **Ids are minted on the device when the event happens**, not when it is sent,
  and the id is the table's primary key. A drain that dies halfway is therefore
  safe to repeat: the second insert is a no-op. The one fatal mistake is
  acknowledging optimistically — `acknowledge` only after a confirmed write.
- **`seq` orders a session, not `at`.** `at` is a phone's clock and phones lie.
  `seq` keeps counting across a drain, so a flush cannot renumber a session.
- **`activeMs` is time ON TASK**, not wall clock. The primary metric divides by
  it, and a class left open on a table is not learning.
- **Overflow is counted, never silent.** `MAX_PENDING` events are held; past
  that the oldest are dropped and `dropped` rises, so a learner model built from
  an incomplete ledger can say that it is incomplete.
- **`normaliseAnswer` is the whole privacy boundary** for a child's own words: a
  flagged turn is dropped entirely, whitespace is collapsed, invisible
  characters are stripped, and the result is capped. Never audio, never free
  conversation.

## What is deliberately NOT here

Sending. Draining the outbox is I/O and lives in an adapter, the same way every
other external dependency in this repo sits behind one.

## Depends on

Nothing.
