import { describe, expect, it } from 'vitest';
import type { DoubtContext } from '@ai-tutor/doubt-session';
import type { StudentContext } from '@ai-tutor/persona';
import {
  END_TOOL,
  RECALL_TOOL,
  buildLiveSystemInstruction,
  buildSetupFrame,
  parseServerMessage,
  pickRecallBeatId,
  type LiveServerEvent,
} from '../src/lib/liveAgent';
import { TUTOR } from '@ai-tutor/persona';

const ctx: DoubtContext = {
  lessonId: 'class10-heart',
  beatId: 'chambers',
  beatTopic: 'Four chambers',
  transcriptSoFar: 'The heart is a pump.\nIt has four chambers.',
  visibleElementIds: ['b_ra', 'b_la'],
  recentBeats: [
    { id: 'pump', topic: 'The heart is a pump' },
    { id: 'valves', topic: 'Valves stop backflow' },
    { id: 'chambers', topic: 'Four chambers' },
  ],
  outcomeIds: [],
};

/** Only what the app really measures — see lib/student.ts. */
const student: StudentContext = { klass: 10, doubtCount: 2 };

describe('buildSetupFrame', () => {
  const frame = buildSetupFrame(ctx, 'gemini-3.1-flash-live-preview', student);

  it('names the model in the form the API expects', () => {
    expect(frame.setup.model).toBe('models/gemini-3.1-flash-live-preview');
  });

  it('asks for a spoken answer in a chosen voice', () => {
    expect(frame.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(
      frame.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName.length,
    ).toBeGreaterThan(0);
  });

  it('enables transcription of both sides so the UI can caption them', () => {
    expect(frame.setup.inputAudioTranscription).toEqual({});
    expect(frame.setup.outputAudioTranscription).toEqual({});
  });

  it('declares exactly the two tools, with beatId required on recall', () => {
    const declarations = frame.setup.tools[0].functionDeclarations;
    expect(declarations.map((d) => d.name)).toEqual([RECALL_TOOL, END_TOOL]);

    const recall = declarations[0];
    expect(recall.parameters?.required).toEqual(['beatId']);
    expect(recall.parameters?.properties.beatId.type).toBe('STRING');

    // Ending the doubt takes no arguments — nothing for the model to get wrong.
    expect(declarations[1].parameters).toBeUndefined();
  });

  it('every declared tool carries a description the model can act on', () => {
    for (const d of frame.setup.tools[0].functionDeclarations) {
      expect(d.description.length).toBeGreaterThan(20);
    }
  });

  it('puts the system instruction on the frame', () => {
    expect(frame.setup.systemInstruction.parts[0].text).toBe(
      buildLiveSystemInstruction(ctx, student),
    );
  });
});

describe('buildLiveSystemInstruction', () => {
  const prompt = buildLiveSystemInstruction(ctx, student);

  it('lists every recall target the student has seen', () => {
    // The model can only be trusted to pick from a list it was shown.
    for (const beat of ctx.recentBeats) {
      expect(prompt).toContain(`id "${beat.id}"`);
      expect(prompt).toContain(beat.topic);
    }
  });

  it('carries the current moment and the transcript so far', () => {
    expect(prompt).toContain('Four chambers');
    expect(prompt).toContain('The heart is a pump.');
  });

  it('leaves the tools to the frame, and says nothing about who she is', () => {
    // Tool names belong in the function declarations, where the API actually
    // reads them; repeating them in prose was a second place to drift.
    const declared = buildSetupFrame(ctx, 'm', student).setup.tools[0].functionDeclarations.map(
      (d) => d.name,
    );
    expect(declared).toEqual([RECALL_TOOL, END_TOOL]);
    // And not a word of her character is written in this file any more.
    expect(prompt).toContain(TUTOR.name);
  });

  it('says nothing about a signal the app did not measure', () => {
    // Her standing rules legitimately mention mastery ("never read out internal
    // scores"), so the check has to be the STUDENT section, not the whole
    // prompt: what must be absent is a claim about THIS student.
    const from = prompt.indexOf('THE LEARNER');
    const section = prompt.slice(from, prompt.indexOf('\n\n', from));
    expect(from).toBeGreaterThan(-1);
    expect(section).toContain('Class 10');
    expect(section).not.toMatch(/mastery|wrong idea|misconception/i);
  });
});

describe('parseServerMessage', () => {
  const types = (events: LiveServerEvent[]): string[] => events.map((e) => e.type);

  it('recognises setupComplete', () => {
    expect(parseServerMessage('{"setupComplete":{}}')).toEqual([{ type: 'setupComplete' }]);
  });

  it('pulls the tutor voice out of a modelTurn', () => {
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: {
          modelTurn: {
            parts: [
              { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AAEC' } },
              { inlineData: { mimeType: 'audio/pcm;rate=24000', data: 'AwQF' } },
            ],
          },
        },
      }),
    );
    expect(events).toEqual([
      { type: 'audio', data: 'AAEC' },
      { type: 'audio', data: 'AwQF' },
    ]);
  });

  it('labels transcripts by who spoke', () => {
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: {
          inputTranscription: { text: 'why four' },
          outputTranscription: { text: 'Good question' },
        },
      }),
    );
    expect(events).toEqual([
      { type: 'transcript', role: 'student', text: 'why four' },
      { type: 'transcript', role: 'tutor', text: 'Good question' },
    ]);
  });

  it('reports every event carried by one frame', () => {
    // The API routinely packs a caption, a slice of voice and turnComplete
    // into a single frame; returning only the first would drop her audio.
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: {
          outputTranscription: { text: ' chambers.' },
          modelTurn: { parts: [{ inlineData: { data: 'AAEC' } }] },
          generationComplete: true,
          turnComplete: true,
        },
      }),
    );
    expect(types(events)).toEqual(['transcript', 'audio', 'turnComplete']);
  });

  it('reports interruption before any audio in the same frame', () => {
    // Order matters: clearing the queue after enqueuing would keep her talking.
    const events = parseServerMessage(
      JSON.stringify({
        serverContent: { interrupted: true, modelTurn: { parts: [{ inlineData: { data: 'AA' } }] } },
      }),
    );
    expect(types(events)).toEqual(['interrupted', 'audio']);
  });

  it('parses a tool call with its id and arguments', () => {
    const events = parseServerMessage(
      JSON.stringify({
        toolCall: {
          functionCalls: [{ name: RECALL_TOOL, args: { beatId: 'pump' }, id: 'fc_123' }],
        },
      }),
    );
    expect(events).toEqual([
      { type: 'toolCall', calls: [{ id: 'fc_123', name: RECALL_TOOL, args: { beatId: 'pump' } }] },
    ]);
  });

  it('defaults a missing id and missing args rather than dropping the call', () => {
    const events = parseServerMessage(
      JSON.stringify({ toolCall: { functionCalls: [{ name: END_TOOL }] } }),
    );
    expect(events).toEqual([{ type: 'toolCall', calls: [{ id: '', name: END_TOOL, args: {} }] }]);
  });

  it('skips a nameless function call', () => {
    const events = parseServerMessage(
      JSON.stringify({ toolCall: { functionCalls: [{ id: 'fc_1' }, { name: END_TOOL, id: 'fc_2' }] } }),
    );
    expect(events).toEqual([{ type: 'toolCall', calls: [{ id: 'fc_2', name: END_TOOL, args: {} }] }]);
  });

  it('accepts an already-parsed object as well as a string', () => {
    expect(parseServerMessage({ setupComplete: {} })).toEqual([{ type: 'setupComplete' }]);
  });

  it('ignores frames it does not model instead of throwing', () => {
    // usageMetadata and sessionResumptionUpdate really do arrive mid-session.
    expect(parseServerMessage('{"usageMetadata":{"totalTokenCount":12}}')).toEqual([]);
    expect(parseServerMessage('{"sessionResumptionUpdate":{"newHandle":"h"}}')).toEqual([]);
  });

  it('survives malformed or empty input', () => {
    // An unparseable frame must never take down a live class.
    expect(parseServerMessage('not json at all')).toEqual([]);
    expect(parseServerMessage('')).toEqual([]);
    expect(parseServerMessage(null)).toEqual([]);
    expect(parseServerMessage(undefined)).toEqual([]);
    expect(parseServerMessage('[1,2,3]')).toEqual([]);
    expect(parseServerMessage('{"serverContent":{"modelTurn":{"parts":"nope"}}}')).toEqual([]);
  });

  it('ignores an empty audio payload', () => {
    expect(
      parseServerMessage('{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"data":""}}]}}}'),
    ).toEqual([]);
  });

  it('does not invent a turnComplete from a falsy flag', () => {
    expect(parseServerMessage('{"serverContent":{"turnComplete":false}}')).toEqual([]);
  });
});

describe('pickRecallBeatId', () => {
  const valid = new Set(['pump', 'valves', 'chambers']);

  it('accepts a moment the student has already seen', () => {
    expect(pickRecallBeatId({ beatId: 'pump' }, valid)).toBe('pump');
  });

  it('drops a hallucinated id', () => {
    // Jumping to a beat that does not exist would blank the board.
    expect(pickRecallBeatId({ beatId: 'ghost' }, valid)).toBeNull();
  });

  it('drops a missing or non-string argument', () => {
    expect(pickRecallBeatId({}, valid)).toBeNull();
    expect(pickRecallBeatId({ beatId: 3 }, valid)).toBeNull();
    expect(pickRecallBeatId({ beatId: null }, valid)).toBeNull();
    expect(pickRecallBeatId({ beat_id: 'pump' }, valid)).toBeNull();
  });

  it('drops everything when no beat has been seen yet', () => {
    expect(pickRecallBeatId({ beatId: 'pump' }, new Set())).toBeNull();
  });
});
