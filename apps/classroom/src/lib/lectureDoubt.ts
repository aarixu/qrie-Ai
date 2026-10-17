import type { Lesson, Beat } from '@ai-tutor/lesson-format';
import { relayFetch } from './relay';

export async function askLiveDoubt(
  question: string,
  lesson: Lesson,
  currentBeat: Beat | null
): Promise<string> {
  const topicName = currentBeat?.topic || lesson.title;
  const explanation = currentBeat?.narration || '';

  const prompt = `You are Curie, a friendly, encouraging AI tutor teaching Indian students (Class 6-12) in Hinglish / clear English.
The student is currently in class watching the lesson: "${lesson.title}" (${lesson.subtitle}).
Current teaching beat: "${topicName}".
Teacher's current explanation: "${explanation}".

The student stopped the class and asked this doubt:
"${question}"

Provide a concise, warm, helpful 2-3 sentence answer directly addressing their doubt on this diagram/concept. Keep it natural and pedagogical.`;

  try {
    const res = await relayFetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are Curie, a friendly AI tutor for Indian students.' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.trim().length > 0) {
        return text.trim();
      }
    }
  } catch (e) {
    console.warn('Relay doubt call error, falling back:', e);
  }

  const q = question.toLowerCase();
  const title = lesson.title.toLowerCase();

  if (title.includes('quadratic')) {
    if (q.includes('a') && (q.includes('zero') || q.includes('0'))) {
      return "Great question! If 'a' were equal to 0, then the a·x² term becomes 0·x² = 0, leaving only bx + c = 0. That completely removes the curve and collapses it into a straight line (a linear equation)! That's why 'a' must never be 0.";
    }
    if (q.includes('d') || q.includes('discriminant')) {
      return "The discriminant D = b² - 4ac tells us what lies inside the square root in the formula. If D is negative, we can't take the real square root of a negative number, which is why there are no real roots!";
    }
    return `In quadratic equations, always bring every term to one side first so it matches ax² + bx + c = 0. Then identify your a, b, and c carefully including negative signs!`;
  }

  if (title.includes('respiration')) {
    if (q.includes('breathing')) {
      return "Breathing is purely the physical inhalation of air into the lungs. Respiration, on the other hand, is the biochemical breakdown of glucose inside cells to release ATP energy!";
    }
    if (q.includes('mitochondria')) {
      return "Mitochondria are called the powerhouse because that's where aerobic respiration occurs, breaking down pyruvate with oxygen to release maximum energy.";
    }
    return "Remember that aerobic respiration gives about 36-38 ATP per glucose molecule, whereas anaerobic respiration in muscles produces only 2 ATP plus lactic acid.";
  }

  if (title.includes('pythagor')) {
    return "The key rule for Pythagoras theorem is ensuring the triangle has a true 90-degree right angle. The side 'c' is always opposite that 90-degree corner — that's your hypotenuse!";
  }

  return `Great doubt on ${topicName}! Notice how this step connects the given values directly to the result shown on the board. When you review the formula, keep the units consistent and simplify step-by-step. Let's resume the class!`;
}
