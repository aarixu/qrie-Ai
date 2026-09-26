import type { CreatedAccount } from './apply.ts';

/**
 * Printable ID + PIN slips, one card per new account, for the school to cut
 * out and hand over. This page is the only place a PIN is ever written down,
 * so it is a file on Aarav's machine and nothing else: not uploaded, not
 * logged. English, like all app chrome.
 */

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderSlips(opts: {
  schoolCode: string;
  schoolName: string;
  loginUrl: string;
  created: CreatedAccount[];
}): string {
  const school = escape(opts.schoolName);
  const url = escape(opts.loginUrl);
  const cards = opts.created
    .map((c) => {
      const who =
        c.kind === 'student' && c.grade !== undefined ? `Class ${c.grade}${escape(c.section ?? '')}` : c.kind === 'admin' ? 'Admin' : 'Teacher';
      return `<section class="slip">
  <p class="school">${school}</p>
  <p class="name">${escape(c.displayName)}</p>
  <p class="who">${who}</p>
  <dl>
    <dt>School code</dt><dd>${escape(opts.schoolCode)}</dd>
    <dt>Your ID</dt><dd>${escape(c.loginId)}</dd>
    <dt>Your PIN</dt><dd>${escape(c.pin)}</dd>
  </dl>
  <p class="how">Log in at ${url} with your ID and PIN.</p>
  <p class="warn">Keep this slip private. Do not share your PIN with anyone.</p>
</section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${school} — login slips</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 12mm; color: #17171D; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .slip { border: 1px dashed #17171D; padding: 5mm; break-inside: avoid; }
  .school { font-size: 10pt; margin: 0; }
  .name { font-size: 14pt; font-weight: 700; margin: 2mm 0 0; }
  .who { margin: 0 0 3mm; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 1mm 4mm; margin: 0 0 3mm; }
  dt { font-size: 9pt; }
  dd { margin: 0; font: 700 13pt ui-monospace, monospace; letter-spacing: 0.08em; }
  .how, .warn { font-size: 9pt; margin: 1mm 0 0; }
  .warn { font-weight: 700; }
</style>
</head>
<body>
<main>
${cards}
</main>
</body>
</html>
`;
}
