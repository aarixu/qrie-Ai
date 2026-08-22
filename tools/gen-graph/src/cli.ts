import fs from 'node:fs';
import path from 'node:path';
import { loadGraph } from '../../../packages/knowledge-graph/src/graph.ts';
import type { KnowledgeGraph, ProbeBank } from '../../../packages/knowledge-graph/src/types.ts';
import { loadSyllabus } from '../../../packages/syllabus/src/syllabus.ts';
import { createAdapterFromEnv } from './llm.ts';
import { generateNodes, generateProbes, mergeIntoGraph } from './generate.ts';

/**
 * Grow the Learning Outcome Map, one chapter at a time.
 *
 *   node tools/gen-graph/src/cli.ts --syllabus class10-science --chapter life-processes \
 *     --out packages/knowledge-graph/data/class10-science.json [--probes] [--dry-run] [--count 40]
 *
 * Generation EXTENDS the out-file rather than replacing it, so the map
 * accumulates across runs and later chapters can depend on earlier ones.
 */

const SYLLABUS_DIR = 'packages/syllabus/data';

function usage(message: string): never {
  console.error(`${message}

Usage:
  node tools/gen-graph/src/cli.ts --syllabus <id> --chapter <id> --out <file> [options]

  --syllabus   syllabus id, e.g. class10-science   (or "all" to list what exists)
  --chapter    chapter id within it, or "all" for every chapter in order
  --out        graph JSON to extend, e.g. packages/knowledge-graph/data/class10-science.json
  --count      target nodes per chapter (default 40)
  --probes     also write <out-basename>.probes.json
  --probes-only  skip node generation; write probes for nodes in --out that lack one
  --dry-run    print the prompts and write nothing

Env:
  LLM_PROVIDER            "gemini" (default) | "anthropic"
  GOOGLE_API_KEY | GEMINI_API_KEY | ANTHROPIC_API_KEY`);
  process.exit(2);
}

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

function readGraph(file: string): KnowledgeGraph {
  if (!fs.existsSync(file)) return { version: 1, nodes: [] };
  return loadGraph(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function readProbeBank(file: string): ProbeBank {
  if (!fs.existsSync(file)) return { version: 1, probes: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ProbeBank;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const syllabusId = flag(argv, '--syllabus');
  const chapterArg = flag(argv, '--chapter');
  const outArg = flag(argv, '--out');
  const dryRun = argv.includes('--dry-run');
  const wantProbes = argv.includes('--probes');
  const targetCount = Number(flag(argv, '--count') ?? 40);

  if (!syllabusId) {
    const available = fs
      .readdirSync(SYLLABUS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
    usage(`Missing --syllabus. Available: ${available.join(', ')}`);
  }
  if (!chapterArg) usage('Missing --chapter (or "all").');
  if (!outArg) usage('Missing --out.');

  const syllabusFile = path.join(SYLLABUS_DIR, `${syllabusId}.json`);
  if (!fs.existsSync(syllabusFile)) usage(`No syllabus at ${syllabusFile}`);
  const syllabus = loadSyllabus(JSON.parse(fs.readFileSync(syllabusFile, 'utf8')));

  const chapters =
    chapterArg === 'all'
      ? syllabus.chapters
      : syllabus.chapters.filter((c) => c.id === chapterArg);
  if (chapters.length === 0) {
    usage(`No chapter "${chapterArg}". Available: ${syllabus.chapters.map((c) => c.id).join(', ')}`);
  }

  const out = path.resolve(process.cwd(), outArg);
  const probeFile = out.replace(/\.json$/, '.probes.json');
  let graph = readGraph(out);
  const bank = readProbeBank(probeFile);

  // A dry run must not demand an API key — it exists precisely to check the
  // prompt before spending anything.
  const adapter = dryRun
    ? { complete: async () => '{"nodes":[]}' }
    : createAdapterFromEnv();

  // Probes-only: fill the gaps in an existing map rather than growing it. This
  // is the common case once a chapter's nodes are settled — and it is how a
  // hand-authored seed map gets its questions.
  let added = 0;
  let failed = 0;

  if (argv.includes('--probes-only')) {
    const covered = new Set(bank.probes.map((p) => p.nodeId));
    // The GRAPH decides what needs a probe, not the syllabus. A map can hold
    // hand-authored nodes in chapters the syllabus has not been written up yet
    // — those still need questions, or the diagnostic simply cannot see them.
    const chapterIds = new Set(chapters.map((c) => c.id));
    const inScope = (chapterId: string) => chapterArg === 'all' || chapterIds.has(chapterId);
    const missing = graph.nodes.filter((n) => !covered.has(n.id) && inScope(n.chapter));

    if (missing.length === 0) {
      console.log('Every node in scope already has a probe.');
      return;
    }
    console.log(`${missing.length} node(s) without a probe.`);
    if (dryRun) {
      console.log('Nothing generated (--dry-run).');
      return;
    }

    // Batched: one enormous request is slower, likelier to be truncated, and
    // loses every probe when it fails validation.
    const BATCH = 12;
    for (let i = 0; i < missing.length; i += BATCH) {
      const slice = missing.slice(i, i + BATCH);
      const probes = await generateProbes(slice, adapter, {
        klass: syllabus.klass,
        subject: syllabus.subject,
      });
      if (probes.ok) {
        bank.probes.push(...probes.value);
        console.log(`  ✓ ${probes.value.length} probes (bank is now ${bank.probes.length})`);
      } else {
        failed += 1;
        console.error(`  ✗ batch ${i / BATCH + 1}: ${probes.errors.slice(0, 3).join('; ')}`);
      }
    }

    fs.writeFileSync(probeFile, `${JSON.stringify(bank, null, 2)}\n`);
    console.log(`\nWrote ${path.relative(process.cwd(), probeFile)} — ${bank.probes.length} probes.`);
    if (failed > 0) process.exit(1);
    return;
  }

  for (const chapter of chapters) {
    // Only same-class, same-subject ids are offered as edge targets: a Class 10
    // Science node has no business depending on a Class 7 History one.
    const existingIds = graph.nodes
      .filter((n) => n.klass === syllabus.klass && n.subject === syllabus.subject)
      .map((n) => n.id);

    console.log(`\n─── ${chapter.title} (${chapter.id}) ───`);

    if (dryRun) {
      const { buildNodesPrompt } = await import('./prompt.ts');
      const { system, user } = buildNodesPrompt(chapter, {
        syllabusId: syllabus.id,
        klass: syllabus.klass,
        subject: syllabus.subject,
        existingIds,
        targetCount,
      });
      console.log(`\n=== SYSTEM ===\n${system}\n\n=== USER ===\n${user}`);
      continue;
    }

    const result = await generateNodes(chapter, adapter, {
      syllabusId: syllabus.id,
      klass: syllabus.klass,
      subject: syllabus.subject,
      existingIds,
      targetCount,
    });

    if (!result.ok) {
      failed += 1;
      console.error(`  ✗ node generation failed after a repair attempt:`);
      for (const e of result.errors.slice(0, 8)) console.error(`      ${e}`);
      const rejected = out.replace(/\.json$/, `.${chapter.id}.rejected.json`);
      fs.writeFileSync(rejected, result.raw);
      console.error(`    raw reply written to ${path.relative(process.cwd(), rejected)}`);
      continue;
    }

    const merged = mergeIntoGraph(graph, result.value);
    if (!merged.ok) {
      failed += 1;
      console.error(`  ✗ merge rejected: ${merged.errors.join('; ')}`);
      continue;
    }
    graph = merged.value;
    added += result.value.length;
    console.log(`  ✓ ${result.value.length} nodes (map is now ${graph.nodes.length})`);

    if (wantProbes) {
      const probes = await generateProbes(result.value, adapter, {
        klass: syllabus.klass,
        subject: syllabus.subject,
      });
      if (probes.ok) {
        bank.probes.push(...probes.value);
        console.log(`  ✓ ${probes.value.length} probes (bank is now ${bank.probes.length})`);
      } else {
        // Probes are recoverable — re-run with --probes later. Nodes are not.
        console.error(`  ! probe generation failed: ${probes.errors.slice(0, 3).join('; ')}`);
      }
    }
  }

  if (dryRun) {
    console.log(`\n${chapters.length} chapter(s). Nothing generated (--dry-run).`);
    return;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(graph, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(process.cwd(), out)} — ${graph.nodes.length} nodes total.`);

  if (wantProbes) {
    fs.writeFileSync(probeFile, `${JSON.stringify(bank, null, 2)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), probeFile)} — ${bank.probes.length} probes.`);
  }

  console.log(`${added} nodes added, ${failed} chapter(s) failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
