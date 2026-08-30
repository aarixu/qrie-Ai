import { describe, expect, it } from 'vitest';
import { pencilGlyph } from '../src/resolve';

describe('the pencilled circle writes any word safely', () => {
  it('escapes both quote characters, not only the double one', () => {
    // Safe wherever it is used, rather than safe because of where it happens
    // to be used today.
    const body = pencilGlyph(String.fromCharCode(39) + 'x" y' + String.fromCharCode(39)).body;
    // Neither quote survives into the markup as itself.
    expect(body.split('>').pop()).not.toContain(String.fromCharCode(39));
    expect(body).toContain('&apos;');
    expect(body).toContain('&quot;');
  });

  it('still writes an ordinary word plainly', () => {
    expect(pencilGlyph('tank').body).toContain('tank');
  });
});
