import { useState } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Library } from './screens/Library';
import { ClassRoom } from './screens/ClassRoom';

/**
 * Two screens, one useState. A router earns its place when there are more
 * screens than this — not before.
 */
export default function App() {
  const [lesson, setLesson] = useState<Lesson | null>(null);
  return lesson ? (
    <ClassRoom lesson={lesson} onExit={() => setLesson(null)} />
  ) : (
    <Library onOpen={setLesson} />
  );
}
