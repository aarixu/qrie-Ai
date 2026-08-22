import { describe, it, expect } from 'vitest';
import { AnchorRegistry } from '../src/anchors';

const DOC = {
  asset: 'heart.glb',
  anchors: [
    { node: 'left_ventricle', source: 'Ventriculus sinister', ta: 'Ventriculus sinister', label: 'Left Ventricle' },
    { node: 'aorta', source: 'Aorta', ta: 'Aorta', label: 'Aorta' },
  ],
};

describe('AnchorRegistry', () => {
  it('exposes anchor ids as a set', () => {
    expect(AnchorRegistry.fromJson(DOC).ids()).toEqual(new Set(['left_ventricle', 'aorta']));
  });

  it('resolves human labels', () => {
    expect(AnchorRegistry.fromJson(DOC).label('left_ventricle')).toBe('Left Ventricle');
  });

  it('reports membership', () => {
    const r = AnchorRegistry.fromJson(DOC);
    expect(r.has('aorta')).toBe(true);
    expect(r.has('spleen')).toBe(false);
  });

  it('preserves declaration order in all()', () => {
    expect(AnchorRegistry.fromJson(DOC).all().map((a) => a.node)).toEqual(['left_ventricle', 'aorta']);
  });

  it('throws on duplicate node ids', () => {
    const dup = {
      asset: 'x',
      anchors: [
        { node: 'aorta', source: 'a', ta: 'a', label: 'A' },
        { node: 'aorta', source: 'b', ta: 'b', label: 'B' },
      ],
    };
    expect(() => AnchorRegistry.fromJson(dup)).toThrow(/duplicate/i);
  });

  it('throws on a malformed document', () => {
    expect(() => AnchorRegistry.fromJson({ nope: true })).toThrow(/anchors/i);
  });

  it('throws when label is requested for an unknown id', () => {
    expect(() => AnchorRegistry.fromJson(DOC).label('spleen')).toThrow(/spleen/);
  });
});
