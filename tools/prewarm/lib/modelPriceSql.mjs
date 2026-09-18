/**
 * READING tools/sql/model_price.sql WITHOUT CHANGING WHAT IT IS.
 *
 * That file is operator data — Aarav's contract facts, applied by a person —
 * and it stays the single source of the numbers. Two tools need to READ it:
 * apply-prices (to diff the file against the live table before an operator
 * says --yes) and the pre-warm runner (to price the token counts the relay
 * reports into a per-topic rupee line). Both parse the file rather than
 * carrying copies of the numbers, so a price change edits exactly one file.
 *
 * The file is psql: `\set rate 95.6` plus INSERT tuples whose price column is
 * arithmetic like `0.75 / 1e6 * :rate`. The evaluator below substitutes the
 * \set variables and then refuses anything that is not plain arithmetic —
 * digits, dot, exponent, + - * / and parentheses. This is an operator file in
 * our own repo, but "eval whatever is in it" is a habit, not a policy.
 */

const TUPLE =
  /\(\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*([^,()]+(?:\([^)]*\))?[^,]*?)\s*,\s*('(?:[^']|'')*'|null)\s*\)/g;

const ARITHMETIC = /^[\s0-9.eE+\-*/()]+$/;

export function evalArithmetic(expr, vars = {}) {
  let substituted = expr;
  for (const [name, value] of Object.entries(vars)) {
    substituted = substituted.replaceAll(`:${name}`, String(value));
  }
  if (!ARITHMETIC.test(substituted)) {
    throw new Error(`model_price.sql: "${expr}" is not plain arithmetic — refusing to evaluate it`);
  }
  // Vetted charset only: numbers and operators, nothing that can name a thing.
  const value = Function(`"use strict"; return (${substituted});`)();
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`model_price.sql: "${expr}" did not evaluate to a finite number`);
  }
  return value;
}

/**
 * The whole file: the \set variables, the "Sources, checked" date from the
 * header, and every insert row as {provider, model, unit, inrPerUnit, note}.
 */
export function parseModelPriceSql(text) {
  const vars = {};
  for (const m of text.matchAll(/^\\set\s+(\w+)\s+([\d.eE+-]+)\s*$/gm)) {
    vars[m[1]] = Number(m[2]);
  }

  const checked = /Sources, checked (\d{4}-\d{2}-\d{2})/.exec(text)?.[1] ?? null;

  // Only the tuples inside the model_price insert; the trailing SELECT has no
  // quoted 5-tuples, so the global scan stays honest — but anchor anyway.
  const insertAt = text.indexOf('insert into public.model_price');
  if (insertAt < 0) throw new Error('model_price.sql: no "insert into public.model_price" found');
  const body = text.slice(insertAt);

  const rows = [];
  for (const m of body.matchAll(TUPLE)) {
    const [, provider, model, unit, priceExpr, noteRaw] = m;
    rows.push({
      provider,
      model,
      unit,
      inrPerUnit: evalArithmetic(priceExpr.trim(), vars),
      note: noteRaw === 'null' ? null : noteRaw.slice(1, -1).replaceAll("''", "'"),
    });
  }
  if (rows.length === 0) throw new Error('model_price.sql: parsed zero rows — the format changed?');

  return { rate: vars.rate ?? null, checked, rows };
}
