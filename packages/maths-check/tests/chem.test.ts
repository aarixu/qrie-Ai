import { describe, expect, it } from 'vitest';
import { cePart, checkReaction, formulaCounts } from '../src/chem';

describe('counting the atoms in a formula', () => {
  it('reads subscripts, brackets and hydrates', () => {
    expect(formulaCounts('C6H12O6')).toEqual({ C: 6, H: 12, O: 6 });
    expect(formulaCounts('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(formulaCounts('Fe2(SO4)3')).toEqual({ Fe: 2, S: 3, O: 12 });
    expect(formulaCounts('CuSO4.5H2O')).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
  });

  it('refuses what is not a formula', () => {
    expect(formulaCounts('energy')).toBeNull();
    expect(formulaCounts('Ca(OH')).toBeNull();
    expect(formulaCounts('')).toBeNull();
  });
});

describe('is the equation balanced', () => {
  it('passes respiration, photosynthesis and a combination reaction', () => {
    expect(checkReaction('C6H12O6 + 6O2 -> 6CO2 + 6H2O + energy').kind).toBe('balanced');
    expect(checkReaction('6CO2 + 6H2O -> C6H12O6 + 6O2').kind).toBe('balanced');
    expect(checkReaction('CaO(s) + H2O(l) -> Ca(OH)2(aq)').kind).toBe('balanced');
    expect(checkReaction('2H2 + O2 -> 2H2O').kind).toBe('balanced');
  });

  it('names an unbalanced one — the skeletal equation of NCERT 1.1.2', () => {
    const v = checkReaction('Fe + H2O -> Fe3O4 + H2');
    expect(v.kind).toBe('unbalanced');
  });

  it('has nothing to say about a line that is not a reaction', () => {
    expect(checkReaction('glucose breaks down').kind).toBe('unreadable');
    expect(checkReaction('x + 2 = 5').kind).toBe('unreadable');
  });

  it('finds the \\ce{} part of a board line', () => {
    expect(cePart(String.raw`Aerobic: $\ce{C6H12O6 + 6O2 -> 6CO2 + 6H2O}$`)).toBe('C6H12O6 + 6O2 -> 6CO2 + 6H2O');
    expect(cePart('no chemistry here')).toBeNull();
  });
});
