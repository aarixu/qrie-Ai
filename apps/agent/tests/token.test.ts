import { describe, expect, it } from 'vitest';
import { TrackSource } from 'livekit-server-sdk';
import { STUDENT_TOKEN_TTL_SEC, studentGrant } from '../src/token.ts';

describe('studentGrant', () => {
  const grant = studentGrant('lesson-photosynthesis-aarav');

  it('joins exactly one room', () => {
    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toBe('lesson-photosynthesis-aarav');
  });

  it('can be heard, can hear, and can send control messages', () => {
    expect(grant.canPublish).toBe(true);
    expect(grant.canSubscribe).toBe(true);
    expect(grant.canPublishData).toBe(true);
  });

  it('can publish a microphone and nothing else — no camera in a classroom', () => {
    expect(grant.canPublishSources).toEqual([TrackSource.MICROPHONE]);
  });

  it('cannot rewrite its own metadata, and holds no room-wide power', () => {
    expect(grant.canUpdateOwnMetadata).toBe(false);
    expect(grant.hidden).toBe(false);
    expect(grant.roomCreate).toBeUndefined();
    expect(grant.roomAdmin).toBeUndefined();
    expect(grant.roomList).toBeUndefined();
    expect(grant.roomRecord).toBeUndefined();
    expect(grant.agent).toBeUndefined();
    expect(grant.ingressAdmin).toBeUndefined();
  });

  it('expires quickly enough that a copied token is worthless', () => {
    expect(STUDENT_TOKEN_TTL_SEC).toBeLessThanOrEqual(30 * 60);
    expect(STUDENT_TOKEN_TTL_SEC).toBeGreaterThan(60);
  });
});
