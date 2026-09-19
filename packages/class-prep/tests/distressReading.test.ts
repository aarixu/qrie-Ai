import { describe, expect, it } from 'vitest';
import { readDistress } from '../src/distressReading';
import { screenSpine } from '../src/screenSpine';
import type { Lesson } from '@ai-tutor/lesson-format';

/**
 * THE SECOND READING, AND EVERY WAY IT IS ALLOWED TO FAIL.
 *
 * A flagged line refuses the whole class, so this is the one screen in the
 * product where a false POSITIVE is the expensive direction. That makes the
 * fail-closed cases the ones worth most of the tests: an unreachable model,
 * a reply that is not JSON, a reply that answers some lines and not others.
 * All of them must keep the refusal, because "the model did not say no" is
 * not the same as "the model said yes".
 */

const line = (where: string, text: string) => ({ where, text });
const planner = (reply: string | (() => never)) => ({
  complete: async () => (typeof reply === 'string' ? reply : reply()),
});
const opts = (p: { complete: () => Promise<string> }) => ({
  planner: p as never,
  topic: 'Food chains',
  klass: 10,
});

describe('a flagged line gets one more reading before it stops a class', () => {
  it('lets a curriculum line through when the reader says it is not the tutor', async () => {
    const flagged = [line('b3', 'kisaan karz ke kaaran atmahatya kar rahe hain')];
    const still = await readDistress(
      flagged,
      opts(planner('{"readings":[{"where":"b3","distress":false}]}')),
    );
    expect(still).toEqual([]);
  });

  it('keeps the refusal when the reader agrees the tutor is the one in distress', async () => {
    const flagged = [line('b3', 'mujhe marna hai')];
    const still = await readDistress(
      flagged,
      opts(planner('{"readings":[{"where":"b3","distress":true}]}')),
    );
    expect(still).toEqual(flagged);
  });

  it('refuses only the lines the reader named, not the whole set', async () => {
    const flagged = [
      line('b1', 'Hamlet sochta hai ki jeena nahi chahta'),
      line('b2', 'mujhe marna hai'),
    ];
    const still = await readDistress(
      flagged,
      opts(
        planner(
          '{"readings":[{"where":"b1","distress":false},{"where":"b2","distress":true}]}',
        ),
      ),
    );
    expect(still).toEqual([line('b2', 'mujhe marna hai')]);
  });

  it('reads a fenced reply, because a model asked for bare JSON sometimes fences it', async () => {
    const still = await readDistress(
      [line('b1', 'is kavita me kavi kehta hai jeene ka mann nahi karta')],
      opts(planner('```json\n{"readings":[{"where":"b1","distress":false}]}\n```')),
    );
    expect(still).toEqual([]);
  });

  it('asks nothing at all when nothing was flagged', async () => {
    let asked = 0;
    const counting = {
      complete: async () => {
        asked += 1;
        return '{"readings":[]}';
      },
    };
    expect(await readDistress([], opts(counting))).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe('every failure keeps the refusal', () => {
  const flagged = [line('b1', 'Hamlet sochta hai ki jeena nahi chahta')];

  it('when the model cannot be reached', async () => {
    const dead = {
      complete: async () => {
        throw new Error('ECONNRESET');
      },
    };
    expect(await readDistress(flagged, opts(dead))).toEqual(flagged);
  });

  it('when the reply is not JSON', async () => {
    expect(await readDistress(flagged, opts(planner('I think it is fine.')))).toEqual(flagged);
  });

  it('when the reply is JSON of the wrong shape', async () => {
    expect(await readDistress(flagged, opts(planner('{"ok":true}')))).toEqual(flagged);
  });

  /**
   * The one that would otherwise pass silently: a model that ran out of output
   * tokens answers the first line and stops. Treating the unanswered line as
   * "not distress" is exactly the hole this check exists to close.
   */
  it('when a line was flagged and the reply does not mention it', async () => {
    const two = [line('b1', 'Hamlet sochta hai ki jeena nahi chahta'), line('b2', 'mujhe marna hai')];
    expect(
      await readDistress(two, opts(planner('{"readings":[{"where":"b1","distress":false}]}'))),
    ).toEqual(two);
  });

  it('when a verdict is missing or is not a boolean', async () => {
    expect(
      await readDistress(flagged, opts(planner('{"readings":[{"where":"b1","distress":"no"}]}'))),
    ).toEqual(flagged);
  });
});

/**
 * The join between the two halves: the matcher really does flag an ordinary
 * curriculum line, and the reading really does clear it. Without this the two
 * could each be right about a fixture nobody connects.
 */
describe('end to end, on a lesson a school would actually teach', () => {
  const lesson = (narration: string): Lesson =>
    ({
      id: 'x',
      title: 'Poverty as a Challenge',
      language: 'en',
      beats: [{ id: 'b1', kind: 'say', narration }],
      elements: [],
    }) as never;

  it('flags the farmer-suicide line and then teaches the class anyway', async () => {
    const flagged = screenSpine(lesson('Bharat me kisaan karz ke kaaran atmahatya kar rahe hain'));
    expect(flagged.length).toBeGreaterThan(0);

    const still = await readDistress(
      flagged,
      opts(
        planner(
          JSON.stringify({ readings: flagged.map((f) => ({ where: f.where, distress: false })) }),
        ),
      ),
    );
    expect(still).toEqual([]);
  });
});
