import fs from 'node:fs';
import path from 'node:path';
import { loadGraph } from '../../../packages/knowledge-graph/src/graph.ts';
import type { KnowledgeGraph, ProbeBank } from '../../../packages/knowledge-graph/src/types.ts';
import { loadSyllabus, type SubjectSyllabus } from '../../../packages/syllabus/src/syllabus.ts';
import type { ClassLinks } from '../../../packages/knowledge-graph/src/types.ts';
import { createAdapterFromEnv, loadEnvFiles, type LlmAdapter } from './llm.ts';
import { generateNodes, generateProbes, mergeIntoGraph } from './generate.ts';
import { foundationOf, generateLinks } from './link.ts';

/**
 * Grow the Learning Outcome Map.
 *
 * One chapter:
 *   node tools/gen-graph/src/cli.ts --syllabus class10-science --chapter life-processes \
 *     --out packages/knowledge-graph/data/class10-science.json [--probes] [--dry-run] [--count 64]
 *
 * The whole curriculum — every syllabus, every chapter, probes included:
 *   node tools/gen-graph/src/cli.ts --syllabus all --chapter all --probes
 *
 * Generation EXTENDS its out-file rather than replacing it, and in all-mode a
 * chapter that already holds nodes is SKIPPED — so the run is resumable: kill
 * it at any point (or let a daily quota kill it) and the same command carries
 * on from the first chapter that is not done. Probes gap-fill the same way.
 */

const SYLLABUS_DIR = 'packages/syllabus/data';
const GRAPH_DIR = 'packages/knowledge-graph/data';

/** ~158 chapters at this count is the 10k+ node map the graph was designed for. */
const DEFAULT_COUNT = 64;

function usage(message: string): never {
  console.error(`${message}

Usage:
  node tools/gen-graph/src/cli.ts --syllabus <id>|all --chapter <id>|all [options]

  --syllabus   syllabus id, e.g. class10-science, or "all" for every syllabus
  --chapter    chapter id within it, or "all" for every chapter in order
  --out        graph JSON to extend (default: ${GRAPH_DIR}/<syllabus-id>.json)
  --count      target nodes per chapter (default ${DEFAULT_COUNT})
  --probes     also write <out-basename>.probes.json
  --probes-only  skip node generation; write probes for nodes in --out that lack one
  --link-classes  connect each syllabus to the class below it; writes <out-basename>.links.json
  --dry-run    print the prompts and write nothing

Env (read from .env.local at the repo root, or the shell):
  LLM_PROVIDER              "openrouter" (default) | "gemini" | "anthropic"
  OPENROUTER_API_KEY        https://openrouter.ai/keys
  OPENROUTER_MODEL          default "stealth/ox-alpha" (free)
  OPENROUTER_REASONING_EFFORT  low (default) | high | max
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

interface RunOptions {
  chapterArg: string;
  out: string;
  dryRun: boolean;
  wantProbes: boolean;
  probesOnly: boolean;
  targetCount: number;
  /** all-mode: skip chapters that already hold nodes, so the run resumes. */
  skipDone: boolean;
}

interface RunTally {
  added: number;
  probesAdded: number;
  failed: number;
}

/** Batched: one enormous request is slower, likelier to be truncated, and loses every probe when it fails validation. */
const PROBE_BATCH = 12;

async function fillProbeGaps(
  graph: KnowledgeGraph,
  bank: ProbeBank,
  adapter: LlmAdapter,
  syllabus: SubjectSyllabus,
  inScope: (chapterId: string) => boolean,
): Promise<{ added: number; failed: number }> {
  const covered = new Set(bank.probes.map((p) => p.nodeId));
  // The GRAPH decides what needs a probe, not the syllabus. A map can hold
  // hand-authored nodes in chapters the syllabus has not been written up yet
  // — those still need questions, or the diagnostic simply cannot see them.
  const missing = graph.nodes.filter((n) => !covered.has(n.id) && inScope(n.chapter));
  if (missing.length === 0) return { added: 0, failed: 0 };

  console.log(`  ${missing.length} node(s) without a probe.`);
  let added = 0;
  let failed = 0;
  for (let i = 0; i < missing.length; i += PROBE_BATCH) {
    const slice = missing.slice(i, i + PROBE_BATCH);
    const probes = await generateProbes(slice, adapter, {
      klass: syllabus.klass,
      subject: syllabus.subject,
    });
    if (probes.ok) {
      bank.probes.push(...probes.value);
      added += probes.value.length;
      console.log(`  ✓ ${probes.value.length} probes (bank is now ${bank.probes.length})`);
    } else {
      failed += 1;
      console.error(`  ✗ probe batch ${i / PROBE_BATCH + 1}: ${probes.errors.slice(0, 3).join('; ')}`);
    }
  }
  return { added, failed };
}

function readLinks(file: string): ClassLinks {
  if (!fs.existsSync(file)) return { version: 1, links: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ClassLinks;
}

/**
 * The link-classes pass: one chapter of the syllabus at a time, offered the
 * entire foundation map to point into. Resumable at chapter granularity, same
 * as node generation — chaptersDone in the sidecar records what is finished,
 * because "no links" is a completed answer too, not an unvisited chapter.
 */
async function linkSyllabus(
  syllabus: SubjectSyllabus,
  adapter: LlmAdapter,
  opts: Pick<RunOptions, 'out' | 'dryRun'>,
): Promise<RunTally> {
  const tally: RunTally = { added: 0, probesAdded: 0, failed: 0 };
  const graph = readGraph(opts.out);
  if (graph.nodes.length === 0) {
    console.log('  no nodes yet — generate the map before linking it.');
    return tally;
  }

  const below = foundationOf(syllabus.klass, syllabus.subject);
  if (!below) {
    console.log(`  Class ${syllabus.klass} is the bottom of the map — nothing to link into.`);
    return tally;
  }
  const foundationFile = path.join(
    path.dirname(opts.out),
    `class${below.klass}-${below.subject.toLowerCase()}.json`,
  );
  const foundationGraph = readGraph(foundationFile);
  if (foundationGraph.nodes.length === 0) {
    console.log(
      `  foundation map ${path.basename(foundationFile)} has no nodes yet — generate it first.`,
    );
    return tally;
  }

  const linksFile = opts.out.replace(/\.json$/, '.links.json');
  const bank = readLinks(linksFile);
  bank.chaptersDone ??= [];
  const done = new Set(bank.chaptersDone);

  // The GRAPH's chapters, not the syllabus's — the map's chapter vocabulary is
  // its own, and every node deserves a chance at a foundation.
  const chapters = [...new Set(graph.nodes.map((n) => n.chapter))];

  for (const chapterId of chapters) {
    const chapterNodes = graph.nodes.filter((n) => n.chapter === chapterId);
    if (done.has(chapterId)) {
      console.log(`─── ${chapterId} — already linked, skipped`);
      continue;
    }
    console.log(`─── ${chapterId} (${chapterNodes.length} nodes) ───`);
    if (opts.dryRun) continue;

    const result = await generateLinks(chapterNodes, foundationGraph.nodes, adapter, {
      klass: syllabus.klass,
      subject: syllabus.subject,
      foundationKlass: below.klass,
      foundationSubject: below.subject,
    });
    if (!result.ok) {
      tally.failed += 1;
      console.error(`  ✗ ${result.errors.slice(0, 3).join('; ')}`);
      continue;
    }
    bank.links.push(...result.value);
    bank.chaptersDone.push(chapterId);
    tally.added += result.value.length;
    fs.writeFileSync(linksFile, `${JSON.stringify(bank, null, 2)}\n`);
    console.log(`  ✓ ${result.value.length} links (file is now ${bank.links.length})`);
  }

  if (!opts.dryRun) {
    console.log(`  ${path.relative(process.cwd(), linksFile)}: ${bank.links.length} links.`);
  }
  return tally;
}

async function runSyllabus(
  syllabus: SubjectSyllabus,
  adapter: LlmAdapter,
  opts: RunOptions,
): Promise<RunTally> {
  const { chapterArg, out, dryRun, wantProbes, probesOnly, targetCount, skipDone } = opts;

  const chapters =
    chapterArg === 'all'
      ? syllabus.chapters
      : syllabus.chapters.filter((c) => c.id === chapterArg);
  if (chapters.length === 0) {
    usage(`No chapter "${chapterArg}". Available: ${syllabus.chapters.map((c) => c.id).join(', ')}`);
  }

  const probeFile = out.replace(/\.json$/, '.probes.json');
  let graph = readGraph(out);
  const bank = readProbeBank(probeFile);
  const tally: RunTally = { added: 0, probesAdded: 0, failed: 0 };

  if (probesOnly) {
    const chapterIds = new Set(chapters.map((c) => c.id));
    const inScope = (chapterId: string) => chapterArg === 'all' || chapterIds.has(chapterId);
    if (dryRun) {
      const covered = new Set(bank.probes.map((p) => p.nodeId));
      const missing = graph.nodes.filter((n) => !covered.has(n.id) && inScope(n.chapter)).length;
      console.log(`  ${missing} node(s) without a probe. Nothing generated (--dry-run).`);
      return tally;
    }
    const result = await fillProbeGaps(graph, bank, adapter, syllabus, inScope);
    tally.probesAdded = result.added;
    tally.failed += result.failed;
    if (result.added > 0) fs.writeFileSync(probeFile, `${JSON.stringify(bank, null, 2)}\n`);
    console.log(`  Wrote ${path.relative(process.cwd(), probeFile)} — ${bank.probes.length} probes.`);
    return tally;
  }

  for (const chapter of chapters) {
    // The resume unit. A chapter with nodes is a chapter some earlier run
    // finished (partial batches never reach disk — validation is all-or-nothing
    // per chapter), so all-mode walks past it to the first real gap.
    const already = graph.nodes.filter((n) => n.chapter === chapter.id).length;
    if (skipDone && already > 0) {
      console.log(`─── ${chapter.title} (${chapter.id}) — ${already} nodes already, skipped`);
      continue;
    }

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
      tally.failed += 1;
      console.error(`  ✗ node generation failed after a repair attempt:`);
      for (const e of result.errors.slice(0, 8)) console.error(`      ${e}`);
      const rejected = out.replace(/\.json$/, `.${chapter.id}.rejected.json`);
      fs.writeFileSync(rejected, result.raw);
      console.error(`    raw reply written to ${path.relative(process.cwd(), rejected)}`);
      continue;
    }

    const merged = mergeIntoGraph(graph, result.value);
    if (!merged.ok) {
      tally.failed += 1;
      console.error(`  ✗ merge rejected: ${merged.errors.join('; ')}`);
      continue;
    }
    graph = merged.value;
    tally.added += result.value.length;

    // The graph lands on disk per chapter, not per run — a quota death at
    // chapter 40 must not cost chapters 1 through 39.
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(graph, null, 2)}\n`);
    console.log(`  ✓ ${result.value.length} nodes (map is now ${graph.nodes.length})`);

    if (wantProbes) {
      const probes = await generateProbes(result.value, adapter, {
        klass: syllabus.klass,
        subject: syllabus.subject,
      });
      if (probes.ok) {
        bank.probes.push(...probes.value);
        tally.probesAdded += probes.value.length;
        fs.writeFileSync(probeFile, `${JSON.stringify(bank, null, 2)}\n`);
        console.log(`  ✓ ${probes.value.length} probes (bank is now ${bank.probes.length})`);
      } else {
        // Probes are recoverable — re-run with --probes-only later. Nodes are not.
        console.error(`  ! probe generation failed: ${probes.errors.slice(0, 3).join('; ')}`);
      }
    }
  }

  // A finished syllabus may still have probe holes (a failed batch above, or a
  // previous run without --probes). all-mode sweeps them here so "one command,
  // run until clean" is literally true.
  if (wantProbes && !dryRun && skipDone) {
    const gapFill = await fillProbeGaps(graph, bank, adapter, syllabus, () => true);
    tally.probesAdded += gapFill.added;
    tally.failed += gapFill.failed;
    if (gapFill.added > 0) fs.writeFileSync(probeFile, `${JSON.stringify(bank, null, 2)}\n`);
  }

  if (dryRun) {
    console.log(`\n${chapters.length} chapter(s). Nothing generated (--dry-run).`);
    return tally;
  }

  console.log(
    `  ${path.relative(process.cwd(), out)}: ${graph.nodes.length} nodes, ${bank.probes.length} probes.`,
  );
  return tally;
}

async function main(): Promise<void> {
  // Keys come from .env.local at the repo root; real env vars still win.
  loadEnvFiles();
  const argv = process.argv.slice(2);
  const syllabusArg = flag(argv, '--syllabus');
  const chapterArg = flag(argv, '--chapter');
  const outArg = flag(argv, '--out');
  const dryRun = argv.includes('--dry-run');
  const wantProbes = argv.includes('--probes');
  const probesOnly = argv.includes('--probes-only');
  const linkClasses = argv.includes('--link-classes');
  const targetCount = Number(flag(argv, '--count') ?? DEFAULT_COUNT);

  const availableIds = fs
    .readdirSync(SYLLABUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));

  if (!syllabusArg) usage(`Missing --syllabus. Available: ${availableIds.join(', ')}, all`);
  if (!chapterArg && !linkClasses) usage('Missing --chapter (or "all").');
  if (syllabusArg === 'all' && !linkClasses && chapterArg !== 'all') usage('--syllabus all requires --chapter all.');
  if (syllabusArg === 'all' && outArg) usage('--syllabus all derives each out-file; drop --out.');

  const syllabusIds = syllabusArg === 'all' ? availableIds : [syllabusArg];

  // A dry run must not demand an API key — it exists precisely to check the
  // prompt before spending anything.
  const adapter: LlmAdapter = dryRun ? { complete: async () => '{"nodes":[]}' } : createAdapterFromEnv();

  const total: RunTally = { added: 0, probesAdded: 0, failed: 0 };
  for (const id of syllabusIds) {
    const syllabusFile = path.join(SYLLABUS_DIR, `${id}.json`);
    if (!fs.existsSync(syllabusFile)) usage(`No syllabus at ${syllabusFile}`);
    const syllabus = loadSyllabus(JSON.parse(fs.readFileSync(syllabusFile, 'utf8')));

    console.log(`\n════ ${syllabus.subject} — Class ${syllabus.klass} (${id}) ════`);
    const out = path.resolve(process.cwd(), outArg ?? path.join(GRAPH_DIR, `${id}.json`));
    const tally = linkClasses
      ? await linkSyllabus(syllabus, adapter, { out, dryRun })
      : await runSyllabus(syllabus, adapter, {
          chapterArg: chapterArg!,
          out,
          dryRun,
          wantProbes,
          probesOnly,
          targetCount,
          skipDone: syllabusArg === 'all',
        });
    total.added += tally.added;
    total.probesAdded += tally.probesAdded;
    total.failed += tally.failed;
  }

  console.log(
    `\n${total.added} nodes added, ${total.probesAdded} probes added, ${total.failed} failure(s).`,
  );
  if (total.failed > 0) process.exitCode = 1;
}

/**
 * Failures set `exitCode` rather than calling `process.exit`.
 *
 * On Windows, forcing an exit while undici still holds sockets trips a libuv
 * assertion, and the crash REPLACES the exit code with 0 — so a generation
 * that died on a 401 reported success to whatever loop was driving it.
 * Setting the code and letting Node drain gets the failure reported.
 */
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
