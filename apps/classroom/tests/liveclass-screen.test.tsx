import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { findTopic } from '../src/lib/content';
import { LiveClassRoute } from '../src/screens/LiveClass';

/**
 * The road into a class nobody has had yet.
 *
 * Rendered from a REAL topicRef out of the committed syllabus rather than a
 * fixture: what this screen has to get right is turning a path into something
 * a tutor can be asked to teach, and a hand-written topic would prove nothing
 * about the paths the Chapter screen actually links to.
 */

const COLD = 'class9-science/the-fundamental-unit-of-life/plasma-membrane-or-cell-membrane';

const at = (path: string): string =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/class/*" element={<LiveClassRoute />} />
      </Routes>
    </MemoryRouter>,
  );

describe('finding the topic a path is asking for', () => {
  it('reads a real topicRef out of the committed syllabus', () => {
    const found = findTopic(COLD);
    expect(found?.topic.title).toBe('Plasma Membrane or Cell Membrane');
    expect(found?.syllabus.klass).toBe(9);
    expect(found?.chapterTitle).toBe('The Fundamental Unit of Life');
  });

  it('knows nothing about a path that is not a topic', () => {
    expect(findTopic('class9-science/nonsense/whatever')).toBeNull();
    expect(findTopic('not-a-syllabus/a/b')).toBeNull();
  });
});

describe('the wait, spent inside the room', () => {
  it('names the topic it is about to teach', () => {
    // Not "Loading…": the student asked for something specific, and the wait
    // is long enough that being told what is being made for them matters.
    expect(at(`/class/${COLD}`)).toContain('Plasma Membrane or Cell Membrane');
  });

  it('says what is happening without saying which kind of class this is', () => {
    const html = at(`/class/${COLD}`);

    expect(html).toContain('She is setting up the board');
    // This file's own doctrine: a recording is a CACHE of the first live
    // class, not a different product, and "nobody has studied this topic yet"
    // was the one line in the app that told the student which one they got.
    expect(html).not.toContain('Nobody has studied this topic yet');
  });

  it('shows the dark stage the class is about to happen on', () => {
    // The room the student is already in, not a spinner on a white page.
    expect(at(`/class/${COLD}`)).toContain('bg-stage');
  });

  it('opens the same way for a topic off the syllabus', () => {
    expect(at('/class?topic=How%20a%20rainbow%20forms')).toContain('How a rainbow forms');
  });
});
