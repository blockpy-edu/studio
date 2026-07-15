/**
 * Spike S2 - validate @lezer/python over the BlockMirror round-trip corpus.
 *
 * For every program in BlockMirror's TESTS array (test/simple.html):
 *   1. Parse with @lezer/python; record error nodes (position + snippet).
 *   2. Parse with CPython `ast.parse` (via the local python) as ground truth.
 *   3. Compare verdicts; also inventory all CST node types encountered and
 *      verify comments appear as Comment nodes.
 *
 * Usage: node spikes/s2-lezer-cst/parse-corpus.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parser } from '@lezer/python';

const BLOCKMIRROR_TEST = 'c:/Users/acbar/Projects/blockpy-edu/BlockMirror/test/simple.html';

// --- 1. Extract the TESTS array from simple.html -------------------------
const html = readFileSync(BLOCKMIRROR_TEST, 'utf8');
const match = html.match(/var TESTS = (\[[\s\S]*?\n {8}\]);/);
if (!match) throw new Error('Could not locate the TESTS array in simple.html');
// The array literal is trusted local test data (JS strings, template
// literals, concatenations, // comments) - evaluate it as-is.
const corpus = new Function(`return ${match[1]};`)();
console.log(`Corpus: ${corpus.length} programs\n`);

// --- 2. Lezer parse ------------------------------------------------------
function lezerVerdict(code) {
  const tree = parser.parse(code);
  const errors = [];
  const nodeTypes = new Set();
  let commentCount = 0;
  tree.iterate({
    enter(node) {
      nodeTypes.add(node.name);
      if (node.name === 'Comment') commentCount += 1;
      if (node.type.isError) {
        errors.push({
          from: node.from,
          to: node.to,
          around: JSON.stringify(code.slice(Math.max(0, node.from - 12), node.to + 12)),
        });
      }
    },
  });
  return { ok: errors.length === 0, errors, nodeTypes, commentCount };
}

// --- 3. CPython ast.parse ground truth (single batch call) ---------------
function cpythonVerdicts(programs) {
  const dir = mkdtempSync(join(tmpdir(), 'spike-s2-'));
  const inPath = join(dir, 'corpus.json');
  writeFileSync(inPath, JSON.stringify(programs));
  const py = `
import ast, json, sys
programs = json.load(open(sys.argv[1], encoding='utf8'))
out = []
for src in programs:
    try:
        ast.parse(src)
        out.append(None)
    except SyntaxError as e:
        out.append(f'{e.msg} (line {e.lineno})')
print(json.dumps(out))
`;
  try {
    const result = execFileSync('python', ['-c', py, inPath], { encoding: 'utf8' });
    return JSON.parse(result);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 4. Compare ----------------------------------------------------------
const cpython = cpythonVerdicts(corpus);
const allNodeTypes = new Set();
const rows = [];
let agree = 0;

corpus.forEach((code, i) => {
  const lz = lezerVerdict(code);
  lz.nodeTypes.forEach((t) => allNodeTypes.add(t));
  const cpErr = cpython[i];
  const same = lz.ok === (cpErr === null);
  if (same) agree += 1;
  rows.push({ i, code, lezerOk: lz.ok, lezerErrors: lz.errors, cpythonError: cpErr, same });
});

console.log(`Agreement: ${agree}/${corpus.length}\n`);
console.log('--- Disagreements & Lezer-rejected programs ---');
for (const r of rows) {
  if (!r.same || !r.lezerOk) {
    console.log(`\n#${r.i} lezer=${r.lezerOk ? 'OK' : 'ERROR'} cpython=${r.cpythonError ?? 'OK'}`);
    console.log(
      `  code: ${JSON.stringify(r.code.length > 120 ? r.code.slice(0, 120) + '…' : r.code)}`,
    );
    for (const e of r.lezerErrors.slice(0, 3)) {
      console.log(`  lezer error at ${e.from}-${e.to}: near ${e.around}`);
    }
  }
}

console.log('\n--- Comment preservation check ---');
const commentTest = corpus.findIndex((c) => c.includes('#'));
const ct = lezerVerdict(corpus[commentTest]);
console.log(`#${commentTest} contains comments; Lezer Comment nodes found: ${ct.commentCount}`);

console.log(`\n--- CST node-type inventory (${allNodeTypes.size} types) ---`);
console.log([...allNodeTypes].sort().join(', '));
