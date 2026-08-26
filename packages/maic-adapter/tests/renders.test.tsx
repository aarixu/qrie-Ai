import fs from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { validateLesson, type Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '@ai-tutor/stage';
import { initialBoard, reduce } from '@ai-tutor/action-player';
import { planToScene } from '../src/planToScene';

/**
 * The end of the pipeline: beats -> actions -> board -> pixels.
 *
 * Every other test in these two packages checks a data shape. This one checks
 * that the shape actually reaches the canvas, because a board state that no
 * renderer can draw would pass all of them and show a blank screen.
 */
const lessonPath = path.join(process.cwd(), 'content/class9-particle-size/lesson.json');
const parsed = validateLesson(JSON.parse(fs.readFileSync(lessonPath, 'utf8')));
if (!parsed.ok) throw new Error(`fixture lesson invalid: ${parsed.errors.join('; ')}`);
const lesson: Lesson = parsed.lesson;

const { actions } = planToScene(lesson);

/** The board after playing the stream up to and including `index`. */
const boardAt = (index: number) => actions.slice(0, index + 1).reduce(reduce, initialBoard);

const draw = (index: number) => {
  const board = boardAt(index);
  return renderToString(
    <Scene lesson={lesson} visible={board.visible} focus={board.focus} />,
  );
};

describe('the action stream reaches the canvas', () => {
  it('draws nothing before the first drawing action', () => {
    // Action 0 is speech. Narration is audio, not ink.
    const html = draw(0);
    expect(html).not.toContain('data-element-id');
  });

  it('draws an element once its action has run', () => {
    const firstDraw = actions.findIndex((a) => a.type.startsWith('wb_draw'));
    expect(firstDraw).toBeGreaterThan(-1);

    const drawnId = (actions[firstDraw] as { elementId?: string }).elementId!;
    const html = draw(firstDraw);
    expect(html).toContain(`data-element-id="${drawnId}"`);
  });

  it('has every drawn element on the canvas by the end of the stream', () => {
    const board = boardAt(actions.length - 1);
    const html = renderToString(
      <Scene lesson={lesson} visible={board.visible} focus={board.focus} />,
    );
    for (const id of board.visible) {
      expect(html).toContain(`data-element-id="${id}"`);
    }
    expect(board.visible.length).toBeGreaterThan(0);
  });

  it('renders real ink, not an empty frame', () => {
    // A blank <svg> with the right attributes would satisfy the id checks above
    // while showing the student nothing, so assert there is drawn content.
    const html = draw(actions.length - 1);
    expect(html).toMatch(/<(text|rect|path|polyline|foreignObject)/);
  });
});
