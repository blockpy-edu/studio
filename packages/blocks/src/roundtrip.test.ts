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
import { workspaceToPython, xmlToPython, xmlToWorkspace } from './blocks-to-text';

const corpus: { programs: string[] } = JSON.parse(
  readFileSync(join(__dirname, '../test/fixtures/blockmirror-corpus.json'), 'utf8'),
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
 * - #73 `import matplotlib.pyplot as plt`: `plt` is in `hiddenImports` - the
 *   converter deliberately suppresses the block (legacy UX: plotting
 *   boilerplate is hidden; the generator re-emits the import whenever a
 *   plt.* call block is present). Legacy parity wins: a bare, unused plt
 *   import does not survive the trip.
 *
 * (#42 `df[1, 2, 3, 4]` is the opposite call: legacy rendered Index(Tuple)
 * as `df[(1, 2, 3, 4)]`; the corpus asserts the text-preserving form, so
 * to-ast emits ExtSlice for all multi-dim subscripts and the corpus
 * expectation stands - no entry needed here.)
 */
const KNOWN_LEGACY_DELTAS: Record<number, string> = {
  73: '',
};

describe('BlockMirror corpus round-trip (§16.1.2)', () => {
  corpus.programs.forEach((program, i) => {
    it(`#${i}: ${JSON.stringify(program.slice(0, 50))}`, () => {
      const expected = i in KNOWN_LEGACY_DELTAS ? KNOWN_LEGACY_DELTAS[i]! : program.trim();
      const firstTrip = textToBlocksToText(program);
      expect(firstTrip).toBe(expected);
      // Second trip must be a fixed point too (legacy asserted both).
      const secondTrip = textToBlocksToText(firstTrip);
      expect(secondTrip).toBe(expected);
    });
  });
});

describe('numeric literals keep their source form', () => {
  const LITERALS = [
    '1j',
    '0x10',
    '0b101',
    '0o17',
    '1_000',
    '9007199254740993',
    '3',
    '2.5',
    '-1',
    '1e10',
    '0.5j',
  ];
  for (const literal of LITERALS) {
    it(literal, () => {
      const source = `x = ${literal}`;
      const once = textToBlocksToText(source);
      expect(once).toBe(source);
      expect(textToBlocksToText(once)).toBe(source);
    });
  }

  it('falls back to the field value once the number is edited', () => {
    const converter = new TextToBlocksConverter();
    const { xml } = converter.convertSource('__main__.py', 'x = 0x10');
    const workspace = xmlToWorkspace(xml);
    try {
      const num = workspace.getBlocksByType('ast_Num', false)[0]!;
      expect(num.getFieldValue('NUM')).toBe(16);
      num.setFieldValue(17, 'NUM');
      expect(workspaceToPython(workspace).trim()).toBe('x = 17');
    } finally {
      workspace.dispose();
    }
  });
});

describe('syntax-error recovery keeps the raw block in source order', () => {
  it('two errors: unclosed bracket above a later syntax error', () => {
    const source = 'print(1)\nx = [1, 2\nprint(2)\ndef (:\nprint(3)';
    const converter = new TextToBlocksConverter();
    const result = converter.convertSource('__main__.py', source);
    expect(result.error).toBeNull();
    const raws = result.rawXml.querySelectorAll('block[type="ast_Raw"]');
    expect(raws.length).toBe(1);
    expect(raws[0]!.getAttribute('line_number')).toBe('2');
    expect(raws[0]!.querySelector('field[name="TEXT"]')!.textContent).toBe(
      'x = [1, 2\nprint(2)\ndef (:\nprint(3)',
    );
    // Top-level peers are separated by a blank line; the raw chunk itself is
    // regenerated in original order.
    expect(xmlToPython(result.xml).trim()).toBe(source.replace('\n', '\n\n'));
  });
});

describe('image-URL string detection', () => {
  it('two consecutive image-URL strings both become ast_Image', () => {
    const source = 'a = "https://example.com/dog.png"\nb = "https://example.com/cat.png"';
    const converter = new TextToBlocksConverter();
    const result = converter.convertSource('__main__.py', source);
    expect(result.error).toBeNull();
    expect(result.rawXml.querySelectorAll('block[type="ast_Image"]').length).toBe(2);
    expect(result.rawXml.querySelectorAll('block[type="ast_Str"]').length).toBe(0);
  });
});
