import { describe, expect, it } from 'vitest';
import { STYLE_SYSTEM, parseStyleCard, styleBrief, styleUser } from '../src/style';

const card = {
  teacher: 'Sharma sir',
  sound: 'Warm, unhurried, drops his voice on the important word.',
  languageMix: 'Terms in English, the explanation in Hindi.',
  phrases: ['dekhiye beta', 'samajh aaya?'],
  opening: 'Starts from something in the room before naming the topic.',
  questioning: 'Asks, waits, then asks the same thing a smaller way.',
  examples: 'Kitchen and cricket.',
};

describe('reading a style card out of a model reply', () => {
  it('takes a clean card', () => {
    const c = parseStyleCard(JSON.stringify(card));
    expect(c.teacher).toBe('Sharma sir');
    expect(c.phrases).toHaveLength(2);
  });

  it('digs the card out of a chatty reply', () => {
    const c = parseStyleCard(`Here you go:\n${JSON.stringify(card)}`);
    expect(c.languageMix).toContain('Hindi');
  });

  it('refuses a card with nothing in it, rather than teaching as nobody', () => {
    expect(() => parseStyleCard('{}')).toThrow();
    expect(() => parseStyleCard('no json here')).toThrow();
    expect(() => parseStyleCard(JSON.stringify({ ...card, phrases: [] }))).toThrow();
  });
});

describe('what the planner is told', () => {
  it('puts every part of the card in the brief, and the phrases verbatim', () => {
    const brief = styleBrief(parseStyleCard(JSON.stringify(card)));
    expect(brief).toContain('Sharma sir');
    expect(brief).toContain('dekhiye beta');
    expect(brief).toContain('Kitchen and cricket');
    expect(brief).toContain('Asks, waits');
  });

  it('tells the planner to teach AS them, not to describe them', () => {
    expect(styleBrief(parseStyleCard(JSON.stringify(card)))).toMatch(/never (say|mention|describe)/i);
  });
});

describe('what the model is asked for', () => {
  it('asks for the switch POINT, not just the languages', () => {
    expect(STYLE_SYSTEM).toMatch(/where .*switch|switch .*point|switch/i);
  });

  it('asks for their phrases verbatim, not paraphrased', () => {
    expect(STYLE_SYSTEM).toMatch(/verbatim/i);
  });

  it('carries the transcript into the user prompt', () => {
    expect(styleUser('dekhiye beta, force ka matlab')).toContain('dekhiye beta');
  });
});
