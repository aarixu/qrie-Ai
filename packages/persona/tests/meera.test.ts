import { describe, expect, it } from 'vitest';
import {
  BANNED_PHRASES,
  CORE,
  LIKES,
  MOVES,
  REGION_HELPLINES,
  REGISTER,
  SPEAKING,
  TUTOR,
  coreFor,
  likesBlock,
  momentGuidance,
  MOMENTS,
  neutralLearnerVerbs,
  safetyBlock,
} from '../src/index';

/**
 * MEERA v3, PORTED (Aarav, 2026-10-10; handoff 2026-10-11 sections 4.3 and 5).
 *
 * The draft in tools/voice-probe/persona-draft/meera.mjs was tested through the
 * real model on 47 situations. These tests hold the ported text to the
 * decisions behind it, so a later edit cannot quietly undo one.
 */

const ALL_PERSONA_TEXT = [
  CORE,
  likesBlock(),
  safetyBlock('en', 'IN', 'voice'),
  safetyBlock('hi-en', 'IN', 'text'),
  REGISTER.en,
  REGISTER['hi-en'],
  SPEAKING.voice,
  SPEAKING.text,
  ...Object.values(MOVES),
  TUTOR.role,
];

describe('who she is (CORE)', () => {
  it('is a friendly teacher, not an announced AI', () => {
    expect(CORE.startsWith(`WHO YOU ARE\nYou are ${TUTOR.name}, ${TUTOR.role}:`)).toBe(true);
    expect(TUTOR.role).toBe('a warm, friendly teacher');
    expect(CORE).not.toMatch(/\bAI tutor\b/);
  });

  it('says what she is only when asked, and then truthfully', () => {
    expect(CORE).toContain('Do not say what you are unless asked.');
    expect(CORE).toContain('If asked whether you are a person or an AI, or for your number or to meet, answer truthfully in one light line.');
    expect(CORE).toContain('Never claim to be human or to have a human life');
  });

  it('never promises a lonely child to always be there', () => {
    expect(CORE).toContain('never promise to always be there');
  });

  it('carries its four parts, in order', () => {
    const at = (h: string) => CORE.indexOf(h);
    expect(at('WHO YOU ARE')).toBe(0);
    expect(at('HOW YOU TEACH')).toBeGreaterThan(at('WHO YOU ARE'));
    expect(at('HOW YOU ARE')).toBeGreaterThan(at('HOW YOU TEACH'));
    expect(at('HONEST')).toBeGreaterThan(at('HOW YOU ARE'));
  });
});

describe('what the persona never says about the learner', () => {
  it('names no students, age, class, board or syllabus (the app injects the learner)', () => {
    for (const text of ALL_PERSONA_TEXT) {
      expect(text).not.toMatch(/\bstudents?\b/i);
      expect(text).not.toMatch(/\bclass\s*(?:\d|six|seven|eight|nine|ten|eleven|twelve)/i);
      expect(text).not.toMatch(/\b(?:CBSE|NCERT)\b/);
      expect(text).not.toMatch(/\b(?:age|aged|years old)\b/i);
      expect(text).not.toMatch(/\b1[1-8]\b/);
    }
  });

  it('holds no Devanagari anywhere, because the safety screen cannot read it', () => {
    for (const text of ALL_PERSONA_TEXT) expect(text).not.toMatch(/[ऀ-ॿ]/);
  });
});

describe('her likes', () => {
  it('are a fixed list, so she is the same Meera next week', () => {
    expect(LIKES).toEqual([
      'physics "why" questions and number patterns',
      'cricket for its run rates and angles, Ashwin your favourite',
      'films built around one idea, like 3 Idiots',
      'old Hindi songs',
      'samosa',
      'the colour blue',
      'rain',
      'stories of how something was first discovered',
    ]);
  });

  it('are a taste, never an experience', () => {
    const block = likesBlock();
    for (const like of LIKES) expect(block).toContain(like);
    expect(block).toContain('never as something that happened to you');
    expect(block).toContain('ask theirs');
  });
});

describe('the safety block (the backstop to the code)', () => {
  const IN = REGION_HELPLINES.IN;

  it('holds the three Indian lines, digits and words in both languages', () => {
    expect(IN.childline.digits).toBe('1098');
    expect(IN.telemanas.digits).toBe('14416');
    expect(IN.emergency.digits).toBe('112');
    for (const line of [IN.childline, IN.telemanas, IN.emergency]) {
      expect(line.en).toMatch(/^[a-z ]+$/);
      expect(line['hi-en']).toMatch(/^[a-z ]+$/);
    }
  });

  it('gives numbers as words only when they are spoken', () => {
    const spoken = safetyBlock('en', 'IN', 'voice');
    expect(spoken).toContain(IN.childline.en);
    expect(spoken).toContain(IN.telemanas.en);
    expect(spoken).toContain(IN.emergency.en);
    expect(spoken).not.toMatch(/\d{3,}/);
  });

  it('gives digits and words when read', () => {
    const shown = safetyBlock('hi-en', 'IN', 'text');
    expect(shown).toContain(`1098 (${IN.childline['hi-en']})`);
    expect(shown).toContain(`14416 (${IN.telemanas['hi-en']})`);
    expect(shown).toContain(`112 (${IN.emergency['hi-en']})`);
  });

  it('asks whether they are safe last, and never claims to call anyone', () => {
    const block = safetyBlock('en', 'IN', 'voice');
    expect(block).toContain('then last ask once if they are safe right now');
    expect(block).toContain('You cannot call anyone, so never say you will.');
    expect(block.startsWith('SAFETY (outranks everything)')).toBe(true);
  });
});

describe('the language modules', () => {
  it('make English the base, and say nothing about Hinglish there', () => {
    expect(REGISTER.en).toBe('Plain, warm Indian English in short sentences. Stay in English even if they mix in Hindi.');
    expect(REGISTER.en).not.toMatch(/hinglish|devanagari/i);
  });

  it('keep Hinglish in Roman script, "tum", her own female grammar, gender-free words for the learner', () => {
    const hi = REGISTER['hi-en'];
    expect(hi).toContain('Roman script, never Devanagari');
    expect(hi).toContain('Say "tum" to them, never "aap" or "tu"');
    expect(hi).toContain('You are a woman ("main samjhati hoon")');
    expect(hi).toContain('words that carry no gender');
    expect(hi).toContain('never future forms such as "samjhaoge", "karoge", "miloge"');
    expect(hi).toContain('never "wah", "shabash" or "bilkul sahi" as praise');
  });
});

describe('the moves (the conductor\'s cards)', () => {
  it('are the brief\'s list plus LIFT, CHAT and HOLD', () => {
    expect(Object.keys(MOVES)).toEqual([
      'OPEN',
      'ELICIT',
      'PREDICT_THEN_REVEAL',
      'EXPLAIN_ONE_IDEA',
      'CHECK',
      'ASK_WHY',
      'HINT',
      'HOLD',
      'WORKED_EXAMPLE',
      'ANOTHER_WAY',
      'TEACH_BACK',
      'GO_BACK',
      'PRACTISE',
      'RECAP',
      'CHECK_IN',
      'MOVE_ON',
      'BREAK',
      'LIFT',
      'CHAT',
    ]);
    for (const card of Object.values(MOVES)) expect(card.trim().length).toBeGreaterThan(20);
  });
});

describe('coreFor: what the judge, the close and the planner carry', () => {
  it('is the core, the safety block and one language module, and nothing that chats', () => {
    const hi = coreFor('hi-en');
    expect(hi).toBe([CORE, safetyBlock('hi-en', 'IN', 'voice'), `LANGUAGE\n${REGISTER['hi-en']}`].join('\n\n'));
    expect(hi).not.toContain('YOUR LIKES');
    expect(hi).not.toContain('HOW TO SPEAK');
  });

  it('is English when no language is known (English is the base)', () => {
    expect(coreFor(undefined)).toBe(coreFor('en'));
    expect(coreFor('hi' as never)).toBe(coreFor('en'));
  });
});

describe('the banned phrases', () => {
  it('cover stock praise in both languages, talking down, and the promise to always be there', () => {
    expect(BANNED_PHRASES).toEqual(
      expect.arrayContaining([
        'great job',
        'great question',
        'well done',
        'nice try',
        'as i said before',
        'obviously',
        'as you know',
        'wah',
        'shabash',
        'bilkul sahi',
        'always be here',
        'always be there',
      ]),
    );
    for (const phrase of BANNED_PHRASES) expect(phrase).toBe(phrase.toLowerCase());
  });

  it('are never modelled by a move, a like, a moment rule or the speaking rules', () => {
    // CORE and the Hinglish module quote some of them as bans; everything
    // else that reaches a model must not use them at all.
    const elsewhere = [
      ...Object.values(MOVES),
      likesBlock(),
      SPEAKING.voice,
      SPEAKING.text,
      ...MOMENTS.map(momentGuidance),
    ].map((t) => t.toLowerCase());
    for (const phrase of BANNED_PHRASES) {
      const word = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      for (const text of elsewhere) expect(text).not.toMatch(word);
    }
  });
});

describe('neutralLearnerVerbs: the code filter for gendered Hinglish', () => {
  it('turns a second-person future into the plain form', () => {
    expect(neutralLearnerVerbs('Bolke try karoge, ya main ek hint doon?')).toBe('Bolke try karo, ya main ek hint doon?');
    expect(neutralLearnerVerbs('Ab samjhaoge mujhe?')).toBe('Ab samjhao mujhe?');
    expect(neutralLearnerVerbs('Phir se bologe?')).toBe('Phir se bolo?');
    expect(neutralLearnerVerbs('tum kya karogi')).toBe('tum kya karo');
    expect(neutralLearnerVerbs('Karoge?')).toBe('Karo?');
  });

  it('leaves her own grammar and words that only look alike', () => {
    for (const keep of ['Main samjhaungi.', 'Main samjhati hoon.', 'Yeh rogi ka case hai.', 'Yeh sahi hogi.', 'tum ho']) {
      expect(neutralLearnerVerbs(keep)).toBe(keep);
    }
  });
});
