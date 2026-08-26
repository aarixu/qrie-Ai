import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { Syllabus } from '../src/screens/Syllabus';
import { profileStore } from '../src/stores/profile';
import { settingsStore } from '../src/stores/settings';
import { SYLLABI } from '../src/lib/content';

/**
 * The rendered text, as a student would read it. renderToString splices
 * `<!-- -->` between interpolated values and escapes apostrophes, so asserting
 * on raw markup tests React's serialiser rather than this screen.
 */
const render = (): string =>
  renderToString(
    <MemoryRouter>
      <Syllabus />
    </MemoryRouter>,
  )
    .replace(/<!--\s*-->/g, '')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');

const asStudent = (klass: number, subjects: string[]) => {
  settingsStore.set({ klass } as never);
  profileStore.set({ name: 'A', klass, subjects, diagnostic: null, diagnosedAt: null });
};

beforeEach(() => localStorage.clear());

describe('Syllabus screen', () => {
  it('shows only the student class, never another one', () => {
    asStudent(9, ['Science', 'Mathematics']);
    const html = render();
    expect(html).toContain('Class 9');
    // Class 11 splits Science into the separate sciences; none may appear here.
    for (const stray of ['Biology', 'Chemistry', 'Physics']) expect(html).not.toContain(`>${stray}<`);
  });

  it('shows only the subjects the student chose', () => {
    asStudent(9, ['Mathematics']);
    const html = render();
    expect(html).toContain('Mathematics');
    expect(html).not.toContain('>Science<');
  });

  it('counts chapters and topics from the syllabus itself', () => {
    asStudent(9, ['Mathematics']);
    const maths = SYLLABI.find((s) => s.klass === 9 && s.subject === 'Mathematics')!;
    const topics = maths.chapters.reduce((n, c) => n + c.topics.length, 0);
    expect(render()).toContain(`${maths.chapters.length} chapters · ${topics} topics`);
  });

  it('asks for a class rather than showing an empty course', () => {
    settingsStore.set({ klass: null } as never);
    profileStore.set({ name: null, klass: null, subjects: [], diagnostic: null, diagnosedAt: null });
    expect(render()).toContain('Pick your class first');
  });

  it('says so plainly when a class has no syllabus authored yet', () => {
    asStudent(12, []);
    expect(render()).toContain('still being written');
  });

  it('lists every chapter, including the ones with no lesson yet', () => {
    // The syllabus is the promise; hiding the empty parts would hide how much
    // of the course exists.
    asStudent(9, ['Mathematics']);
    const html = render();
    const maths = SYLLABI.find((s) => s.klass === 9 && s.subject === 'Mathematics')!;
    for (const chapter of maths.chapters) expect(html).toContain(chapter.title);
  });
});
