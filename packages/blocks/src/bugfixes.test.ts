// @vitest-environment jsdom
/**
 * Regression tests for verified round-trip bugs (text → blocks → text must
 * be a fixed point and semantically faithful).
 */
import { describe, expect, it, vi } from 'vitest';
import './ast';
import { TextToBlocksConverter } from './text-to-blocks';
import { xmlToPython } from './blocks-to-text';

function convert(source: string) {
  const converter = new TextToBlocksConverter();
  const result = converter.convertSource('__main__.py', source);
  expect(result.error).toBeNull();
  return result;
}

function trip(source: string): string {
  return xmlToPython(convert(source).xml).trim();
}

function expectFixedPoint(source: string, expected: string = source.trim()) {
  const once = trip(source);
  expect(once).toBe(expected);
  expect(trip(once)).toBe(expected);
}

describe('bug 1: `not` re-associates around and/or', () => {
  const CASES = [
    'if not done or n > 3:\n    pass',
    'x = not a or b',
    'x = not a and b or c',
    'x = not (a and b)',
    'x = not (a or b) or c',
    'x = a or not b',
    'x = not not a or b',
  ];
  for (const source of CASES) {
    it(source, () => expectFixedPoint(source));
  }
  it('`(not a) and b` normalizes to the equivalent `not a and b`', () => {
    expectFixedPoint('x = (not a) and b', 'x = not a and b');
  });
});

describe('bug 2: augmented assignment to a non-Name target', () => {
  for (const source of ['self.count += 1', 'a[0] -= x', 'obj.attr.deep *= 2']) {
    it(source, () => expectFixedPoint(source));
  }
});

describe('bug 3: chained comparisons', () => {
  for (const source of [
    'x = 1 < x < 10',
    'x = a <= b < c == d',
    'if 0 <= i < len(x):\n    pass',
    'x = (1 < x) < 10',
    'x = (a < b) < c < d',
  ]) {
    it(source, () => expectFixedPoint(source));
  }
});

describe('bug 4: f-strings', () => {
  const CASES = [
    `x = f"it's {a}"`,
    `x = f'say "{a}"'`,
    `x = f"a {{literal}} {b}"`,
    `x = f"{a!r:>10}"`,
    `x = f"{a!r}"`,
    `x = f"{a:>10}"`,
    `x = f"{{}}"`,
  ];
  for (const source of CASES) {
    it(source, () => expectFixedPoint(source));
  }
  it('mixed quotes inside content are escaped', () => {
    const once = trip(`x = f"it's \\"quoted\\" {a}"`);
    expect(trip(once)).toBe(once);
    expect(once).toContain('{a}');
    expect(once).toMatch(/^x = f/);
  });
  it('continued string with an f-string part does not lose the placeholder', () => {
    const once = trip(`x = f"{a}" "b"`);
    expect(once).not.toBe("x = '{a}b'");
    expect(trip(once)).toBe(once);
  });
});

describe('bug 5: multi-line strings do not leak indentation or drop backslashes', () => {
  it('multi-line string inside a def is stable', () => {
    const source = 'def f():\n    x = """\nline1\n"""\n    return x';
    const once = trip(source);
    const twice = trip(once);
    expect(twice).toBe(once);
    expect(once).not.toContain('    line1');
    expect(once).toContain('\\nline1\\n');
  });
  it('backslashes survive in multi-line strings', () => {
    const source = 'x = """C:\\\\Users\nnext"""';
    const once = trip(source);
    expect(once).toContain('C:\\\\Users');
    expect(trip(once)).toBe(once);
  });
  it('backslashes survive in single-line strings', () => {
    expectFixedPoint("x = 'C:\\\\Users'");
  });
  it('docstrings keep backslashes', () => {
    const source = 'def f():\n    """Path C:\\\\Users\n    more\n    """\n    return 1';
    const once = trip(source);
    expect(once).toContain('C:\\\\Users');
    expect(trip(once)).toBe(once);
  });
});

describe('bug 6: attribute access on compound values', () => {
  for (const source of ['x = (a + b).real', 'x = (1).real', 'x = f(a).real', 'x = a.b.c']) {
    it(source, () => expectFixedPoint(source));
  }
});

describe('bug 7: named expression is always parenthesized', () => {
  for (const source of ['x = (n := 10)', 'print((n := 10) + 1)', 'x = [y := 5, y ** 2]']) {
    it(source, () => {
      const once = trip(source);
      expect(trip(once)).toBe(once);
      expect(once).toContain('(');
    });
  }
  it('x = (n := 10) is exact', () => expectFixedPoint('x = (n := 10)'));
});

describe('bug 8: module imports are not duplicated', () => {
  for (const source of ['import turtle\nturtle.forward(10)', 'import math\nx = math.sqrt(4)']) {
    it(source, () => expectFixedPoint(source));
  }
  it('from turtle import forward does not gain an `import turtle`', () => {
    // (The blank line after a from-import is pre-existing generator layout.)
    const once = trip('from turtle import forward\nforward(10)');
    expect(once).not.toContain('import turtle');
    expect(trip(once)).toBe(once);
  });
});

describe('bug 9: keyword-only / positional-only markers fall back to raw', () => {
  for (const source of ['def f(a, *, b=1):\n    pass', 'def f(a, /, b):\n    pass']) {
    it(source, () => {
      const { rawXml } = convert(source);
      expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(1);
      expectFixedPoint(source);
    });
  }
  it('def f(*args, b=1) is still real blocks', () => {
    const { rawXml } = convert('def f(*args, b=1):\n    pass');
    expect(rawXml.querySelectorAll('block[type="ast_Raw"]').length).toBe(0);
  });
});

describe('bug 10: parenthesized from-import names', () => {
  it('from os import (path, sep)', () => {
    expectFixedPoint('from os import (path, sep)', 'from os import path, sep');
  });
  it('from os import (path as p,\n    sep)', () => {
    expectFixedPoint('from os import (path as p,\n    sep)', 'from os import path as p, sep');
  });
});

describe('bug 11: odd expressions degrade cleanly (no console trace)', () => {
  for (const source of ['a[1,]', 'x = {**a}', 'x = {**a, "b": 1}']) {
    it(source, () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expectFixedPoint(source);
      } finally {
        spy.mockRestore();
      }
      expect(spy).not.toHaveBeenCalled();
    });
  }
});
