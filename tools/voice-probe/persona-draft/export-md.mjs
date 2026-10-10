// Writes the readable copy of the persona draft: node export-md.mjs <out.md>
import { CORE, likesBlock, safetyBlock, LANGUAGE, SPEAKING, MOVES, learnerLines } from './meera.mjs';
import { writeFileSync } from 'node:fs';

const fence = (s) => '```\n' + s.trim() + '\n```';
let md = `# Meera: persona, draft v3 (2026-10-10)\n\nSmall and composed. The CORE goes into every model call (planner, judge, close, doubt, live). Everything else is a block that is added only where it is needed. Nothing here says who the learner is: the app injects one line from the profile.\n\n`;
md += `## 1. Core (every call)\n\n${fence(CORE)}\n\n`;
md += `## 2. Her likes (doubt and live only; stable, edit the list in the code)\n\n${fence(likesBlock())}\n\n`;
md += `## 3. Safety backstop (every call; the real crisis reply is code)\n\nSpoken surfaces get the helpline as words only. Text surfaces get digits and words. Numbers come from a per-region table, not from the persona.\n\n${fence(safetyBlock('en', 'IN', 'voice'))}\n\n`;
md += `## 4. Language (the student's setting; English is the default)\n\n### English\n\n${fence(LANGUAGE.en)}\n\n### Hinglish (only if chosen)\n\n${fence(LANGUAGE['hi-en'])}\n\n`;
md += `## 5. How it is spoken\n\n### Voice\n\n${fence(SPEAKING.voice)}\n\n### Text\n\n${fence(SPEAKING.text)}\n\n`;
md += `## 6. The learner (injected by the app; shown with an example)\n\n${fence(learnerLines({ klass: 10, namedMisconception: '{wrong idea, if known}', notes: ['{memory note}'] }).map((l) => '- ' + l).join('\n'))}\n\n`;
md += `## 7. The moves (the conductor picks one per turn; she picks only the words)\n\nThe brief's list plus LIFT, CHAT and HOLD.\n\n`;
for (const [k, v] of Object.entries(MOVES)) md += `**${k}**: ${v}\n\n`;
writeFileSync(process.argv[2], md);
console.log('written', md.length, 'chars');
