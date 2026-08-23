import { describe, expect, it } from 'vitest';
import {
  END_DOUBT,
  RECALL_MOMENT,
  TUTOR_CONTROL_TOPIC,
  decodeTutorControl,
  encodeTutorControl,
} from '../src/messages.ts';

describe('tutor control messages', () => {
  it('names one topic that both sides agree on', () => {
    expect(TUTOR_CONTROL_TOPIC).toBe('tutor-control');
  });

  it('round-trips a recall through bytes', () => {
    const bytes = encodeTutorControl({ type: RECALL_MOMENT, beatId: 'b-03' });
    // A byte view, not a string: this is what publishData takes. (jsdom and
    // Node disagree about which realm owns Uint8Array, so `instanceof` here
    // would be testing the test environment rather than the code.)
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(decodeTutorControl(bytes)).toEqual({ type: RECALL_MOMENT, beatId: 'b-03' });
  });

  it('round-trips both endings', () => {
    for (const reason of ['resolved', 'failed'] as const) {
      expect(decodeTutorControl(encodeTutorControl({ type: END_DOUBT, reason }))).toEqual({
        type: END_DOUBT,
        reason,
      });
    }
  });

  it('decodes text as well as bytes, so a text-stream transport needs no second parser', () => {
    expect(decodeTutorControl('{"type":"end_doubt","reason":"resolved"}')).toEqual({
      type: END_DOUBT,
      reason: 'resolved',
    });
  });

  it('returns null for anything that is not one of ours', () => {
    expect(decodeTutorControl('not json at all')).toBeNull();
    expect(decodeTutorControl('[1,2,3]')).toBeNull();
    expect(decodeTutorControl('null')).toBeNull();
    expect(decodeTutorControl('"a string"')).toBeNull();
    expect(decodeTutorControl('{"type":"something_else"}')).toBeNull();
    expect(decodeTutorControl(new Uint8Array([0xff, 0xfe]))).toBeNull();
  });

  it('refuses a recall with no beat id rather than blanking the board', () => {
    expect(decodeTutorControl('{"type":"recall_moment"}')).toBeNull();
    expect(decodeTutorControl('{"type":"recall_moment","beatId":""}')).toBeNull();
    expect(decodeTutorControl('{"type":"recall_moment","beatId":7}')).toBeNull();
  });

  it('treats an unrecognised end reason as resolved, so a version skew never strands the class', () => {
    expect(decodeTutorControl('{"type":"end_doubt"}')).toEqual({
      type: END_DOUBT,
      reason: 'resolved',
    });
    expect(decodeTutorControl('{"type":"end_doubt","reason":"who-knows"}')).toEqual({
      type: END_DOUBT,
      reason: 'resolved',
    });
  });
});
