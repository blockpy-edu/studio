import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sourceToAst, decodePythonString, AstParseError } from './to-ast';
import { parseSource } from './parse';
import type * as ir from '../ir/types';

const corpus: { programs: string[] } = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/blockmirror-corpus.json'), 'utf8'),
);

describe('parseSource (B3 gate)', () => {
  it('accepts every BlockMirror corpus program (incl. valueless yield)', () => {
    const failures: number[] = [];
    corpus.programs.forEach((program, i) => {
      if (!parseSource(program).blockable) failures.push(i);
    });
    expect(failures).toEqual([]);
  });

  it('rejects recovered-but-broken source', () => {
    expect(parseSource('def f(:\n    pass').blockable).toBe(false);
    expect(parseSource('a = ').blockable).toBe(false);
    expect(parseSource('if x\n    pass').blockable).toBe(false);
  });

  it('tolerates exactly the bare-yield gap', () => {
    expect(parseSource('def f():\n    yield').blockable).toBe(true);
    expect(parseSource('def f():\n    (yield)').blockable).toBe(true);
  });
});

describe('sourceToAst', () => {
  it('converts every corpus program without throwing', () => {
    const failures: { i: number; error: string }[] = [];
    corpus.programs.forEach((program, i) => {
      try {
        sourceToAst(program);
      } catch (e) {
        failures.push({ i, error: String(e) });
      }
    });
    expect(failures).toEqual([]);
  });

  it('throws AstParseError with a line number on bad source', () => {
    expect(() => sourceToAst('a = 0\nb = ')).toThrowError(AstParseError);
    try {
      sourceToAst('a = 0\nb = ');
    } catch (e) {
      expect((e as AstParseError).lineno).toBe(2);
    }
  });

  function first<T = ir.Stmt>(source: string): T {
    return sourceToAst(source).ast.body[0] as unknown as T;
  }

  it('simple assignment', () => {
    const stmt = first<ir.Assign>('a = 5');
    expect(stmt._astname).toBe('Assign');
    expect(stmt.targets).toHaveLength(1);
    expect(stmt.targets[0]).toMatchObject({ _astname: 'Name', id: 'a' });
    expect(stmt.value).toMatchObject({ _astname: 'Num', n: 5 });
    expect(stmt.lineno).toBe(1);
  });

  it('chained assignment', () => {
    const stmt = first<ir.Assign>('a = b = 1');
    expect(stmt.targets.map((t) => (t as ir.Name).id)).toEqual(['a', 'b']);
  });

  it('tuple-unpacking assignment', () => {
    const stmt = first<ir.Assign>('a, b = c');
    expect(stmt.targets[0]).toMatchObject({ _astname: 'Tuple' });
    expect((stmt.targets[0] as ir.Tuple).elts).toHaveLength(2);
  });

  it('annotated assignment', () => {
    const stmt = first<ir.AnnAssign>('x: int = 4');
    expect(stmt).toMatchObject({
      _astname: 'AnnAssign',
      simple: 1,
      annotation: { _astname: 'Name', id: 'int' },
      value: { _astname: 'Num', n: 4 },
    });
  });

  it('augmented assignment', () => {
    const stmt = first<ir.AugAssign>('x //= 2');
    expect(stmt._astname).toBe('AugAssign');
    expect(stmt.op._astname).toBe('FloorDiv');
  });

  it('chained comparison flattens into one Compare', () => {
    const stmt = first<ir.ExprStmt>('a < b <= c');
    const cmp = stmt.value as ir.Compare;
    expect(cmp._astname).toBe('Compare');
    expect(cmp.ops.map((o) => o._astname)).toEqual(['Lt', 'LtE']);
    expect(cmp.comparators).toHaveLength(2);
  });

  it('parenthesized comparison does NOT flatten', () => {
    const stmt = first<ir.ExprStmt>('(a < b) <= c');
    const cmp = stmt.value as ir.Compare;
    expect(cmp.ops.map((o) => o._astname)).toEqual(['LtE']);
    expect((cmp.left as ir.Compare)._astname).toBe('Compare');
  });

  it('is not / not in', () => {
    expect((first<ir.ExprStmt>('a is not b').value as ir.Compare).ops[0]!._astname).toBe('IsNot');
    expect((first<ir.ExprStmt>('a not in b').value as ir.Compare).ops[0]!._astname).toBe('NotIn');
  });

  it('same-op boolean chains flatten (parens preserved as nesting)', () => {
    const flat = first<ir.ExprStmt>('a and b and c').value as ir.BoolOp;
    expect(flat.values).toHaveLength(3);
    const mixed = first<ir.ExprStmt>('a and b or c').value as ir.BoolOp;
    expect(mixed.op._astname).toBe('Or');
    expect(mixed.values).toHaveLength(2);
    expect((mixed.values[0] as ir.BoolOp).op._astname).toBe('And');
    const nested = first<ir.ExprStmt>('(a and b) and c').value as ir.BoolOp;
    expect(nested.values).toHaveLength(2);
  });

  it('power keeps right precedence under unary minus', () => {
    const stmt = first<ir.ExprStmt>('-x ** 2');
    const unary = stmt.value as ir.UnaryOp;
    expect(unary._astname).toBe('UnaryOp');
    expect((unary.operand as ir.BinOp).op._astname).toBe('Pow');
  });

  it('call with positional/keyword/star/kwargs', () => {
    const stmt = first<ir.ExprStmt>('f(a, b=2, *c, **d)');
    const call = stmt.value as ir.Call;
    expect(call.args).toHaveLength(2);
    expect(call.args[0]).toMatchObject({ _astname: 'Name', id: 'a' });
    expect(call.args[1]!._astname).toBe('Starred');
    expect(call.keywords).toHaveLength(2);
    expect(call.keywords[0]).toMatchObject({ arg: 'b' });
    expect(call.keywords[1]).toMatchObject({ arg: null });
  });

  it('attribute chains', () => {
    const stmt = first<ir.ExprStmt>('a.b.c');
    const outer = stmt.value as ir.Attribute;
    expect(outer.attr).toBe('c');
    expect((outer.value as ir.Attribute).attr).toBe('b');
  });

  it('subscript kinds: Index / Slice / ExtSlice', () => {
    const index = first<ir.ExprStmt>('a[1]').value as ir.Subscript;
    expect(index.slice._astname).toBe('Index');

    const slice = first<ir.ExprStmt>('a[::-1]').value as ir.Subscript;
    expect(slice.slice._astname).toBe('Slice');
    const s = slice.slice as ir.Slice;
    expect(s.lower).toBeNull();
    expect(s.upper).toBeNull();
    expect((s.step as ir.UnaryOp)._astname).toBe('UnaryOp');

    const ext = first<ir.ExprStmt>('a[1:2, ::3]').value as ir.Subscript;
    expect(ext.slice._astname).toBe('ExtSlice');
    expect((ext.slice as ir.ExtSlice).dims.map((d) => d._astname)).toEqual(['Slice', 'Slice']);

    // All-index multi-dim is ExtSlice (corpus-driven; see subscriptSlice).
    const multi = first<ir.ExprStmt>('a[1, 2]').value as ir.Subscript;
    expect(multi.slice._astname).toBe('ExtSlice');
    expect((multi.slice as ir.ExtSlice).dims.map((d) => d._astname)).toEqual(['Index', 'Index']);
  });

  it('function definition with full parameter forms', () => {
    const fn = first<ir.FunctionDef>('def f(a, b=1, *args, c, d=2, **kw) -> int:\n    return a');
    expect(fn.name).toBe('f');
    expect(fn.args.args.map((a) => a.arg)).toEqual(['a', 'b']);
    expect(fn.args.defaults).toHaveLength(1);
    expect(fn.args.vararg?.arg).toBe('args');
    expect(fn.args.kwonlyargs.map((a) => a.arg)).toEqual(['c', 'd']);
    expect(fn.args.kw_defaults[0]).toBeNull();
    expect(fn.args.kw_defaults[1]).toMatchObject({ n: 2 });
    expect(fn.args.kwarg?.arg).toBe('kw');
    expect(fn.returns).toMatchObject({ _astname: 'Name', id: 'int' });
    expect(fn.body[0]!._astname).toBe('Return');
  });

  it('bare star keyword-only marker', () => {
    const fn = first<ir.FunctionDef>('def f(a, *, b):\n    pass');
    expect(fn.args.vararg).toBeNull();
    expect(fn.args.kwonlyargs.map((a) => a.arg)).toEqual(['b']);
  });

  it('decorated def takes the decorator line (Skulpt semantics)', () => {
    const fn = first<ir.FunctionDef>('@dec\ndef f():\n    pass');
    expect(fn.decorator_list).toHaveLength(1);
    expect(fn.lineno).toBe(1);
    expect(fn.body[0]!.lineno).toBe(3);
  });

  it('elif chains nest through orelse', () => {
    const node = first<ir.If>('if a:\n    pass\nelif b:\n    pass\nelse:\n    pass');
    expect(node.orelse).toHaveLength(1);
    const elifNode = node.orelse[0] as ir.If;
    expect(elifNode._astname).toBe('If');
    expect(elifNode.lineno).toBe(3);
    expect(elifNode.orelse[0]!._astname).toBe('Pass');
  });

  it('try/except/else/finally', () => {
    const node = first<ir.Try>(
      'try:\n    pass\nexcept ValueError as e:\n    pass\nexcept:\n    pass\nelse:\n    a\nfinally:\n    b',
    );
    expect(node.handlers).toHaveLength(2);
    expect(node.handlers[0]).toMatchObject({
      name: 'e',
      type: { _astname: 'Name', id: 'ValueError' },
      lineno: 3,
    });
    expect(node.handlers[1]).toMatchObject({ name: null, type: null });
    expect(node.orelse).toHaveLength(1);
    expect(node.finalbody).toHaveLength(1);
  });

  it('with-multiple items', () => {
    const node = first<ir.With>("with open('f') as g, h() as i, other:\n    pass");
    expect(node.items).toHaveLength(3);
    expect(node.items[0]!.optional_vars).toMatchObject({ id: 'g' });
    expect(node.items[2]!.optional_vars).toBeNull();
  });

  it('imports', () => {
    const imp = first<ir.Import>('import os.path as p, sys');
    expect(imp.names).toEqual([
      { _astname: 'alias', name: 'os.path', asname: 'p' },
      { _astname: 'alias', name: 'sys', asname: null },
    ]);

    const from1 = first<ir.ImportFrom>('from ..pkg import a as b, c');
    expect(from1).toMatchObject({ module: 'pkg', level: 2 });
    expect(from1.names).toHaveLength(2);

    const from2 = first<ir.ImportFrom>('from . import x');
    expect(from2).toMatchObject({ module: null, level: 1 });

    const star = first<ir.ImportFrom>('from os import *');
    expect(star.names).toEqual([{ _astname: 'alias', name: '*', asname: null }]);
  });

  it('comprehensions (all four kinds)', () => {
    const list = first<ir.ExprStmt>('[x for x in y if z]').value as ir.ListComp;
    expect(list._astname).toBe('ListComp');
    expect(list.generators[0]).toMatchObject({
      target: { id: 'x' },
      iter: { id: 'y' },
    });
    expect(list.generators[0]!.ifs).toHaveLength(1);

    const dict = first<ir.ExprStmt>('{k: v for k, v in d}').value as ir.DictComp;
    expect(dict._astname).toBe('DictComp');
    expect((dict.generators[0]!.target as ir.Tuple)._astname).toBe('Tuple');

    expect(first<ir.ExprStmt>('{x for x in y}').value._astname).toBe('SetComp');
    expect(first<ir.ExprStmt>('(x for x in y)').value._astname).toBe('GeneratorExp');

    const multi = first<ir.ExprStmt>('[x for x in y for z in x if z]').value as ir.ListComp;
    expect(multi.generators).toHaveLength(2);
    expect(multi.generators[1]!.ifs).toHaveLength(1);
  });

  it('dict / set / tuple / list literals', () => {
    expect(first<ir.ExprStmt>('{}').value._astname).toBe('Dict');
    expect(first<ir.ExprStmt>('{1: 2}').value).toMatchObject({
      _astname: 'Dict',
      keys: [{ n: 1 }],
      values: [{ n: 2 }],
    });
    expect(first<ir.ExprStmt>('{1, 2}').value._astname).toBe('Set');
    const bare = first<ir.Assign>('x = 1, 2');
    expect(bare.value._astname).toBe('Tuple');
    const empty = first<ir.Assign>('x = ()');
    expect(empty.value).toMatchObject({ _astname: 'Tuple', elts: [] });
  });

  it('yield forms', () => {
    const bare = first<ir.ExprStmt>('def f():\n    yield');
    void bare; // top-level body[0] is the def; dig in:
    const fn = first<ir.FunctionDef>('def f():\n    yield');
    const yieldStmt = fn.body[0] as ir.ExprStmt;
    expect(yieldStmt.value as ir.Yield).toMatchObject({
      _astname: 'Yield',
      value: null,
    });

    const fn2 = first<ir.FunctionDef>('def f():\n    yield 5');
    expect(((fn2.body[0] as ir.ExprStmt).value as ir.Yield).value).toMatchObject({ n: 5 });

    const fn3 = first<ir.FunctionDef>('def f():\n    yield from g()');
    expect(((fn3.body[0] as ir.ExprStmt).value as ir.YieldFrom)._astname).toBe('YieldFrom');

    const fn4 = first<ir.FunctionDef>('def f():\n    x = yield b + 4');
    expect(((fn4.body[0] as ir.Assign).value as ir.Yield)._astname).toBe('Yield');
  });

  it('lambda', () => {
    const stmt = first<ir.ExprStmt>('lambda a, b=2: a');
    const lam = stmt.value as ir.Lambda;
    expect(lam.args.args.map((a) => a.arg)).toEqual(['a', 'b']);
    expect(lam.args.defaults).toHaveLength(1);
    expect(lam.body).toMatchObject({ id: 'a' });
  });

  it('conditional expression order (body if test else orelse)', () => {
    const stmt = first<ir.ExprStmt>('a if b else c');
    expect(stmt.value).toMatchObject({
      _astname: 'IfExp',
      body: { id: 'a' },
      test: { id: 'b' },
      orelse: { id: 'c' },
    });
  });

  it('global / nonlocal / del / assert / raise-from', () => {
    expect(first('global a, b')).toMatchObject({ names: ['a', 'b'] });
    expect(first('nonlocal c')).toMatchObject({ _astname: 'Nonlocal' });
    const del = first<ir.Delete>('del a, b');
    expect(del.targets).toHaveLength(2);
    expect(first('assert x, "m"')).toMatchObject({
      _astname: 'Assert',
      msg: { _astname: 'Str', s: 'm' },
    });
    expect(first('raise A() from b')).toMatchObject({
      _astname: 'Raise',
      exc: { _astname: 'Call' },
      cause: { id: 'b' },
    });
  });

  it('comments are collected with line/col and # retained', () => {
    const { comments } = sourceToAst('# hello\nx = 1  # trailing\n    ');
    expect(comments).toEqual([
      { line: 1, col: 0, text: '# hello' },
      { line: 2, col: 7, text: '# trailing' },
    ]);
  });

  it('numbers preserve source text', () => {
    expect(first<ir.ExprStmt>('0x10').value).toMatchObject({
      n: 16,
      source: '0x10',
    });
    expect(first<ir.ExprStmt>('1j').value).toMatchObject({ source: '1j' });
    expect(first<ir.ExprStmt>('1_000').value).toMatchObject({ n: 1000 });
  });
});

describe('decodePythonString', () => {
  it('decodes common forms', () => {
    expect(decodePythonString("'a'").value).toBe('a');
    expect(decodePythonString('"a\\nb"').value).toBe('a\nb');
    expect(decodePythonString("r'a\\nb'").value).toBe('a\\nb');
    expect(decodePythonString('"""multi\nline"""').value).toBe('multi\nline');
    expect(decodePythonString("b'bytes'")).toMatchObject({
      value: 'bytes',
      isBytes: true,
    });
    expect(decodePythonString("'\\x41\\u0042'").value).toBe('AB');
    expect(decodePythonString("'\\q'").value).toBe('\\q');
    expect(decodePythonString("'it\\'s'").value).toBe("it's");
  });
});
