// @vitest-environment jsdom
/**
 * §16.1.2 round-trip conformance suite over the BlockMirror corpus.
 *
 * The legacy bar (BlockMirror/test/simple.html): for every corpus program,
 * text → blocks → text must equal the original EXACTLY (trimmed), and a
 * second trip through the blocks must be stable.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import './ast';
import { TextToBlocksConverter } from './text-to-blocks';
import { xmlToPython } from './blocks-to-text';

const corpus: { programs: string[] } = JSON.parse(
  readFileSync(
    join(__dirname, '../test/fixtures/blockmirror-corpus.json'),
    'utf8',
  ),
);

function textToBlocksToText(source: string): string {
  const converter = new TextToBlocksConverter();
  const result = converter.convertSource('__main__.py', source);
  expect(result.error).toBeNull();
  return xmlToPython(result.xml).trim();
}

/**
 * Corpus entries the LEGACY implementation itself cannot satisfy (verified
 * against BlockMirror sources; its test runner used a silent console.assert
 * and `break`, so these were masked). Where corpus and legacy conflict we
 * choose per-case and pin the chosen output here:
 *
 * - #73 `import matplotlib.pyplot as plt`: `plt` is in `hiddenImports` — the
 *   converter deliberately suppresses the block (legacy UX: plotting
 *   boilerplate is hidden; the generator re-emits the import whenever a
 *   plt.* call block is present). Legacy parity wins: a bare, unused plt
 *   import does not survive the trip.
 *
 * (#42 `df[1, 2, 3, 4]` is the opposite call: legacy rendered Index(Tuple)
 * as `df[(1, 2, 3, 4)]`; the corpus asserts the text-preserving form, so
 * to-ast emits ExtSlice for all multi-dim subscripts and the corpus
 * expectation stands — no entry needed here.)
 */
const KNOWN_LEGACY_DELTAS: Record<number, string> = {
  73: '',
};

describe('BlockMirror corpus round-trip (§16.1.2)', () => {
  corpus.programs.forEach((program, i) => {
    it(`#${i}: ${JSON.stringify(program.slice(0, 50))}`, () => {
      const expected =
        i in KNOWN_LEGACY_DELTAS ? KNOWN_LEGACY_DELTAS[i]! : program.trim();
      const firstTrip = textToBlocksToText(program);
      expect(firstTrip).toBe(expected);
      // Second trip must be a fixed point too (legacy asserted both).
      const secondTrip = textToBlocksToText(firstTrip);
      expect(secondTrip).toBe(expected);
    });
  });
});
