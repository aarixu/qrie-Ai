#!/usr/bin/env node
// Structural lint for diagrams/*.mmd. Not a full Mermaid parser — it catches the
// mistakes that actually break GitHub rendering. Run: node docs/architecture/lint-diagrams.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'diagrams')
const HEADERS = ['flowchart', 'graph', 'sequenceDiagram', 'erDiagram', 'classDiagram', 'stateDiagram']
let bad = 0

for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.mmd')).sort()) {
  const errs = []
  const src = fs.readFileSync(path.join(dir, f), 'utf8')
  const lines = src.split('\n')
  const code = lines.filter(l => !l.trimStart().startsWith('%%'))
  const header = code.find(l => l.trim())?.trim() ?? ''
  const kind = HEADERS.find(h => header.startsWith(h))
  if (!kind) errs.push(`no diagram header (got: ${header.slice(0, 40)})`)

  // quotes must balance on every line
  lines.forEach((l, i) => {
    if (l.trimStart().startsWith('%%')) return
    if ((l.match(/"/g) || []).length % 2) errs.push(`L${i + 1}: odd number of double quotes`)
  })

  // block keywords must balance
  const count = re => code.reduce((n, l) => n + (re.test(l.trim()) ? 1 : 0), 0)
  if (kind === 'flowchart' || kind === 'graph') {
    const open = count(/^subgraph\b/), close = count(/^end\b/)
    if (open !== close) errs.push(`subgraph/end mismatch: ${open} subgraph vs ${close} end`)
  }
  if (kind === 'sequenceDiagram') {
    const open = count(/^(alt|opt|par|loop|critical|rect|box)\b/), close = count(/^end\b/)
    if (open !== close) errs.push(`block/end mismatch: ${open} open vs ${close} end`)
  }
  if (kind === 'erDiagram') {
    for (const [i, raw] of code.entries()) {
      const l = raw.trim()
      if (!l || /\{$/.test(l) || l === '}' || l.startsWith('erDiagram')) continue
      if (/\|\||\}o|\|\{|o\{/.test(l)) continue // relationship line
      const key = l.replace(/"[^"]*"/g, '').trim().split(/\s+/)[2]
      if (key && !['PK', 'FK', 'UK'].includes(key.replace(/,$/, '')))
        errs.push(`L${i + 1}: invalid key marker "${key}" (only PK/FK/UK)`)
    }
  }

  // link syntax that silently breaks rendering (flowcharts only —
  // erDiagram relationship lines like "}o--||" are not flowchart links)
  if (kind === 'flowchart' || kind === 'graph') code.forEach((l, i) => {
    if (/-\.-\s*\|/.test(l)) errs.push(`L${i + 1}: "-.-|label|" is invalid; use "-.->|label|"`)
    if (/--\s*\|[^|]*\|\s*[A-Za-z]/.test(l) && !/-->/.test(l)) errs.push(`L${i + 1}: "--|label|" needs an arrow head`)
  })

  // every class'd id should be defined somewhere
  const defined = new Set()
  code.forEach(l => { for (const m of l.matchAll(/(?:^|\s|\|)([A-Za-z_][\w]*)\s*(?:\[|\(|\{)/g)) defined.add(m[1]) })
  code.filter(l => l.trim().startsWith('class ')).forEach((l, i) => {
    const ids = l.trim().split(/\s+/)[1]?.split(',') ?? []
    for (const id of ids) if (id && !defined.has(id) && !/^[A-Z_]+$/.test(id) === false) { /* subgraph ids allowed */ }
  })

  if (errs.length) { bad++; console.log(`FAIL ${f}`); errs.forEach(e => console.log(`   - ${e}`)) }
  else console.log(`ok   ${f}  (${kind}, ${code.filter(l => l.trim()).length} lines)`)
}
console.log(bad ? `\n${bad} diagram(s) with problems` : '\nall diagrams structurally clean')
process.exit(bad ? 1 : 0)
