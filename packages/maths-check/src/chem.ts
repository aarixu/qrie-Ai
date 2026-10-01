/**
 * IS THIS CHEMICAL EQUATION BALANCED? (canvas C3: chemistry on the board)
 *
 * The board writes a reaction with KaTeX's mhchem — `\ce{C6H12O6 + 6O2 -> 6CO2
 * + 6H2O}` — so its subscripts come out as subscripts. This checks the atoms:
 * every element counted on each side, coefficients and brackets and hydrates
 * included. A word on either side ("energy", "light", "heat") is not a
 * species and is left out; a state — (s), (l), (g), (aq) — and an up or down
 * arrow are notation, not atoms.
 *
 * Answers 'balanced', 'unbalanced' (with the element counts that disagree), or
 * 'unreadable' when it is not an equation this reads — which the caller treats
 * as nothing to say, never as a failure. A deliberately unbalanced "skeletal
 * equation" is a real thing in Class 10 (NCERT 1.1.2), so the caller decides
 * what an unbalanced one means.
 */

export type ChemVerdict =
  | { kind: 'balanced' }
  | { kind: 'unbalanced'; left: Record<string, number>; right: Record<string, number> }
  | { kind: 'unreadable' };

const ARROW = /\s*(?:<=>|<->|->|→|⇌|⟶|=)\s*/;

/** The `\ce{…}` content of a board line, or null when it has none. */
export function cePart(text: string): string | null {
  const m = /\\ce\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/.exec(text);
  return m ? m[1] : null;
}

export function checkReaction(equation: string): ChemVerdict {
  const sides = equation.split(ARROW);
  if (sides.length !== 2) return { kind: 'unreadable' };
  const left = countSide(sides[0]);
  const right = countSide(sides[1]);
  if (!left || !right || Object.keys(left).length === 0) return { kind: 'unreadable' };
  const elements = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const el of elements) if ((left[el] ?? 0) !== (right[el] ?? 0)) return { kind: 'unbalanced', left, right };
  return { kind: 'balanced' };
}

function countSide(side: string): Record<string, number> | null {
  const total: Record<string, number> = {};
  for (const raw of side.split(/\s\+\s|\s*\+\s+|\s+\+\s*/)) {
    const term = raw.trim();
    if (!term) continue;
    // A word is not a species: "energy", "light", "heat".
    if (/^[a-z][a-z ]*$/.test(term)) continue;
    const m = /^(\d+)?\s*(.+)$/.exec(term);
    if (!m) return null;
    const coefficient = m[1] ? Number(m[1]) : 1;
    const species = m[2]
      .replace(/\((?:s|l|g|aq)\)/g, '')
      .replace(/\s*(?:\^|↑|↓)\s*$/g, '')
      .replace(/\s/g, '');
    const counts = formulaCounts(species);
    if (!counts) return null;
    for (const [el, n] of Object.entries(counts)) total[el] = (total[el] ?? 0) + n * coefficient;
  }
  return total;
}

/** Atoms in one formula: "Ca(OH)2", "CuSO4.5H2O", "Fe2(SO4)3". Null when it is not one. */
export function formulaCounts(formula: string): Record<string, number> | null {
  // A hydrate: its parts added, the part after the dot with its own count.
  const parts = formula.split(/[.·*]/);
  if (parts.length > 1) {
    const total: Record<string, number> = {};
    for (const part of parts) {
      const m = /^(\d+)?(.+)$/.exec(part);
      if (!m) return null;
      const inner = formulaCounts(m[2]);
      if (!inner) return null;
      const k = m[1] ? Number(m[1]) : 1;
      for (const [el, n] of Object.entries(inner)) total[el] = (total[el] ?? 0) + n * k;
    }
    return total;
  }
  let i = 0;
  const read = (): Record<string, number> | null => {
    const out: Record<string, number> = {};
    while (i < formula.length) {
      const c = formula[i];
      if (c === ')') return out;
      if (c === '(' || c === '[') {
        i += 1;
        const inner = read();
        if (!inner || (formula[i] !== ')' && formula[i] !== ']')) return null;
        i += 1;
        const n = number();
        for (const [el, k] of Object.entries(inner)) out[el] = (out[el] ?? 0) + k * n;
        continue;
      }
      const el = /^[A-Z][a-z]?/.exec(formula.slice(i))?.[0];
      if (!el) return null;
      i += el.length;
      const n = number();
      out[el] = (out[el] ?? 0) + n;
    }
    return out;
  };
  const number = (): number => {
    const d = /^\d+/.exec(formula.slice(i))?.[0];
    if (!d) return 1;
    i += d.length;
    return Number(d);
  };
  const counts = read();
  if (!counts || i !== formula.length || Object.keys(counts).length === 0) return null;
  return counts;
}
