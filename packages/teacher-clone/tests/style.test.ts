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
  board: 'Writes every definition out in full as he says it, and underlines the term.',
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
    expect(brief).toContain('underlines the term');
    expect(brief).toContain('Asks, waits');
  });

  it('tells the planner to teach AS them, not to describe them', () => {
    expect(styleBrief(parseStyleCard(JSON.stringify(card)))).toMatch(/never (say|mention|describe)/i);
  });
});

describe('the board, which is half of how they teach', () => {
  it('asks what reaches the board and WHEN', () => {
    expect(STYLE_SYSTEM).toMatch(/board/i);
    expect(STYLE_SYSTEM).toMatch(/writ/i);
  });

  it('refuses a card that never looked at the board', () => {
    const { board, ...noBoard } = card;
    expect(() => parseStyleCard(JSON.stringify(noBoard))).toThrow();
  });
});

describe('the card must transfer to ANY topic', () => {
  it('asks for phrases that survive a change of subject', () => {
    expect(STYLE_SYSTEM).toMatch(/any topic|another topic|different (subject|topic)/i);
  });

  it('forbids phrases welded to the subject they happened to be teaching', () => {
    expect(STYLE_SYSTEM).toMatch(/not.*(subject|topic)-specific|never.*belongs? to the (subject|topic)|no phrase that only makes sense/i);
  });

  it('says outright that the script itself is not being copied', () => {
    expect(STYLE_SYSTEM).toMatch(/not.*(copy|reproduc).*(lesson|script|content)|manner, not.*(material|content)/i);
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
