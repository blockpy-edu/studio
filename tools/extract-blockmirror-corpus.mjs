/**
 * Extract the BlockMirror round-trip corpus (the `var TESTS` array in
 * BlockMirror/test/simple.html) into a checked-in JSON fixture consumed by
 * the §16.1.2 round-trip conformance suite in @blockpy/blocks.
 *
 * The legacy suite asserts an exact-text fixed point: text → blocks → text
 * must equal the original (trimmed), twice. The fixture preserves the
 * programs verbatim so the studio suite asserts the same bar.
 *
 * Usage: node tools/extract-blockmirror-corpus.mjs [path-to-BlockMirror]
 * Rerun only when the legacy corpus changes; the fixture is committed.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const blockMirrorRoot = process.argv[2] ?? 'c:/Users/acbar/Projects/blockpy-edu/BlockMirror';
const sourcePath = join(blockMirrorRoot, 'test', 'simple.html');
const outPath = join(repoRoot, 'packages/blocks/test/fixtures/blockmirror-corpus.json');

const html = readFileSync(sourcePath, 'utf8');
const match = html.match(/var TESTS = (\[[\s\S]*?\n {8}\]);/);
if (!match) throw new Error(`Could not locate the TESTS array in ${sourcePath}`);
// Trusted local test data (JS strings, template literals, concatenations,
// // comments) - evaluate the array literal as-is.
const corpus = new Function(`return ${match[1]};`)();

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify(
    {
      source: 'BlockMirror/test/simple.html (var TESTS)',
      extracted: new Date().toISOString().slice(0, 10),
      programs: corpus,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${corpus.length} programs to ${outPath}`);
