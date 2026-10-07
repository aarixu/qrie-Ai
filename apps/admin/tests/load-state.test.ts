import { AdminError } from '@ai-tutor/admin-client';
import { describe, expect, it } from 'vitest';
import { failed } from '../src/lib/load-state.ts';

/** How a failed read shows on a screen. Written first. */

describe('a failed read', () => {
  it('not-allowed is refused', () => {
    expect(failed(new AdminError('You do not have access to this.', 'not-allowed'))).toEqual({ state: 'refused' });
  });

  it('any other AdminError is an error with its message', () => {
    expect(failed(new AdminError('there is no school with the code NOPE', 'other'))).toEqual({
      state: 'error',
      message: 'there is no school with the code NOPE',
    });
    expect(failed(new AdminError('this console is TEST, not HOSTED', 'wrong-environment'))).toMatchObject({ state: 'error' });
  });

  it('a plain Error is an error with its message', () => {
    expect(failed(new Error('timeout'))).toEqual({ state: 'error', message: 'timeout' });
    expect(failed('odd')).toEqual({ state: 'error', message: 'odd' });
  });
});
