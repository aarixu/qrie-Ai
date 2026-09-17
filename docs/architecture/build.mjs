#!/usr/bin/env node
// Regenerates README.md from README.template.md + diagrams/*.mmd
// The .mmd files are the source of truth. Edit those, then run:
//   node docs/architecture/build.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const tpl = fs.readFileSync(path.join(here, 'README.template.md'), 'utf8')

let injected = 0
const out = tpl.replace(/<!--\s*DIAGRAM:\s*([\w-]+)\s*-->/g, (_, name) => {
  const file = path.join(here, 'diagrams', `${name}.mmd`)
  if (!fs.existsSync(file)) throw new Error(`missing diagram: diagrams/${name}.mmd`)
  injected++
  const body = fs.readFileSync(file, 'utf8').trimEnd()
  return '```mermaid\n' + body + '\n```\n\n' +
    `<sub>Diagram source: [\`diagrams/${name}.mmd\`](diagrams/${name}.mmd) — edit that, then re-run \`node docs/architecture/build.mjs\`</sub>`
})

const header = '<!-- GENERATED FILE - do not edit directly.\n' +
  '     Edit README.template.md or diagrams/*.mmd, then run: node docs/architecture/build.mjs -->\n'
fs.writeFileSync(path.join(here, 'README.md'), header + out)
console.log(`README.md written - ${injected} diagrams injected`)
