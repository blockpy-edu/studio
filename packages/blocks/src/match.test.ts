// @vitest-environment jsdom
/**
 * M3.6: match/case round-trip conformance — same bar as the BlockMirror
 * corpus suite (§16.1.2): text → blocks → text must be EXACT (trimmed) and
 * stable on a second trip. Patterns are textual v1, so every pattern shape
 * (literal, capture, class, or-, guard, wildcard) must survive verbatim.
 */
import { describe, expect, it } from 'vitest';
import './ast';
import { TextToBlocksConverter } from './text-to-blocks';
import { xmlToPython } from './blocks-to-text';

function trip(source: string): string {
  const converter = new TextToBlocksConverter();
  const result = converter.convertSource('__main__.py', source);
  expect(result.error).toBeNull();
  return xmlToPython(result.xml).trim();
}

const PROGRAMS: [name: string, source: string][] = [
  [
    // Case bodies use print (a known statement-form signature): UNKNOWN
    // bare calls in any nested body wrap in the legacy ast_Expr parens —
    // a pre-existing BlockMirror quirk unrelated to match (astCall.ts:632).
    'literal + wildcard cases',
    `match command:
    case "go":
        print('moving')
    case _:
        print('stopping')`,
  ],
  [
    'guards, or-patterns, class patterns, as-captures',
    `match point:
    case (0, 0):
        print('origin')
    case (x, y) if x == y:
        print('diagonal')
    case Point(x=0) | Point(y=0):
        print('axis')
    case _:
        pass`,
  ],
  [
    // NOTE: empty class patterns (`case str():`) are rejected by
    // @lezer/python 1.1.19's pattern grammar (probed 2026-07-12) — an
    // upstream gap like S2's valueless yield; they degrade to ast_Raw.
    'match nested in a function with trailing statements',
    `def act(cmd):
    match cmd:
        case "n" | "north":
            return 1
        case x as s:
            return s
    return 0
print(act('n'))`,
  ],
  [
    'multi-statement case bodies and a successor statement',
    `match n:
    case 0:
        a = 1
        b = 2
    case 1:
        c = 3
done = True`,
  ],
];

describe('match/case round trip (M3.6)', () => {
  for (const [name, source] of PROGRAMS) {
    it(`round-trips: ${name}`, () => {
      const once = trip(source);
      expect(once).toBe(source.trim());
      // Double trip: stable fixed point.
      expect(trip(once)).toBe(source.trim());
    });
  }

  it('does not rawify statements after a match (parse-level regression)', () => {
    // Before M3.6 an unsupported MatchStatement ABORTED the parse and
    // dumped everything from `match` to EOF into one ast_Raw block.
    const converter = new TextToBlocksConverter();
    const result = converter.convertSource(
      '__main__.py',
      'match x:\n    case 1:\n        pass\ny = 2',
    );
    expect(result.error).toBeNull();
    const xml = result.rawXml;
    expect(xml.querySelectorAll('block[type="ast_Raw"]').length).toBe(0);
    expect(xml.querySelectorAll('block[type="ast_Match"]').length).toBe(1);
  });
});
