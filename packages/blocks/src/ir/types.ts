/**
 * AST intermediate representation — the contract between the Lezer CST
 * converter (`cst/to-ast.ts`) and the ported BlockMirror block converters.
 *
 * The shape deliberately mirrors the AST BlockMirror consumed from Skulpt's
 * `astFromParse` (CPython 3.7 ASDL with the pre-3.8 constant nodes and the
 * pre-3.9 subscript nodes), with Skulpt object wrappers replaced by plain
 * JS values:
 *   - identifiers/strings are plain `string` (legacy `Sk.ffi.remapToJs(x)`),
 *   - `NameConstant.value` is `null | boolean` (legacy `Sk.builtin.none.none$`
 *     / `bool.true$` / `bool.false$` singletons),
 *   - `Num.n` is a plain `number`, with the original literal text preserved
 *     in `Num.source` for lossless re-emission of forms `parseFloat` cannot
 *     round-trip (e.g. `1j`, `0x10`).
 *
 * Every node carries `_astname` (the legacy dispatch key) and statements /
 * expressions carry a 1-based `lineno` like Skulpt's AST did.
 */

/** Operator / context marker nodes — no position, just an `_astname` tag. */
export interface OpNode<Name extends string = string> {
  _astname: Name;
}

export type BinOperator = OpNode<
  | 'Add'
  | 'Sub'
  | 'Mult'
  | 'MatMult'
  | 'Div'
  | 'Mod'
  | 'Pow'
  | 'LShift'
  | 'RShift'
  | 'BitOr'
  | 'BitXor'
  | 'BitAnd'
  | 'FloorDiv'
>;
export type BoolOperator = OpNode<'And' | 'Or'>;
export type UnaryOperator = OpNode<'Invert' | 'Not' | 'UAdd' | 'USub'>;
export type CmpOperator = OpNode<
  | 'Eq'
  | 'NotEq'
  | 'Lt'
  | 'LtE'
  | 'Gt'
  | 'GtE'
  | 'Is'
  | 'IsNot'
  | 'In'
  | 'NotIn'
>;
export type ExprContext = OpNode<'Load' | 'Store' | 'Del'>;

interface Located {
  /** 1-based line number, like Skulpt/CPython `lineno`. */
  lineno: number;
  col_offset: number;
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export interface Module {
  _astname: 'Module';
  body: Stmt[];
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface FunctionDef extends Located {
  _astname: 'FunctionDef';
  name: string;
  args: Arguments;
  body: Stmt[];
  decorator_list: Expr[];
  returns: Expr | null;
  /** `async def` (M3.6) — converters raw-fallback when set (no block v1). */
  is_async?: boolean;
}

export interface ClassDef extends Located {
  _astname: 'ClassDef';
  name: string;
  bases: Expr[];
  keywords: Keyword[];
  body: Stmt[];
  decorator_list: Expr[];
}

export interface Return extends Located {
  _astname: 'Return';
  value: Expr | null;
}

export interface Delete extends Located {
  _astname: 'Delete';
  targets: Expr[];
}

export interface Assign extends Located {
  _astname: 'Assign';
  targets: Expr[];
  value: Expr;
}

export interface AugAssign extends Located {
  _astname: 'AugAssign';
  target: Expr;
  op: BinOperator;
  value: Expr;
}

export interface AnnAssign extends Located {
  _astname: 'AnnAssign';
  target: Expr;
  annotation: Expr;
  value: Expr | null;
  /** 1 when the target is a bare Name (CPython semantics). */
  simple: number;
}

export interface For extends Located {
  _astname: 'For';
  target: Expr;
  iter: Expr;
  body: Stmt[];
  orelse: Stmt[];
  /** `async for` (M3.6) — converters raw-fallback when set (no block v1). */
  is_async?: boolean;
}

export interface While extends Located {
  _astname: 'While';
  test: Expr;
  body: Stmt[];
  orelse: Stmt[];
}

export interface If extends Located {
  _astname: 'If';
  test: Expr;
  body: Stmt[];
  orelse: Stmt[];
}

export interface Match extends Located {
  _astname: 'Match';
  subject: Expr;
  cases: MatchCase[];
}

/**
 * M3.6 design decision: case patterns are TEXTUAL in v1 — the raw source
 * between `case` and the clause colon, guards included. Patterns are not
 * expressions and BlockMirror has no precedent; revisit only if course
 * content demands a pattern-block algebra.
 */
export interface MatchCase extends Located {
  _astname: 'match_case';
  pattern: string;
  body: Stmt[];
}

export interface With extends Located {
  _astname: 'With';
  items: WithItem[];
  body: Stmt[];
  /** `async with` (M3.6) — converters raw-fallback when set (no block v1). */
  is_async?: boolean;
}

export interface WithItem {
  _astname: 'withitem';
  context_expr: Expr;
  optional_vars: Expr | null;
}

export interface Raise extends Located {
  _astname: 'Raise';
  exc: Expr | null;
  cause: Expr | null;
}

export interface Try extends Located {
  _astname: 'Try';
  body: Stmt[];
  handlers: ExceptHandler[];
  orelse: Stmt[];
  finalbody: Stmt[];
}

export interface ExceptHandler extends Located {
  _astname: 'ExceptHandler';
  type: Expr | null;
  name: string | null;
  body: Stmt[];
}

export interface Assert extends Located {
  _astname: 'Assert';
  test: Expr;
  msg: Expr | null;
}

export interface Import extends Located {
  _astname: 'Import';
  names: Alias[];
}

export interface ImportFrom extends Located {
  _astname: 'ImportFrom';
  module: string | null;
  names: Alias[];
  level: number;
}

export interface Alias {
  _astname: 'alias';
  name: string;
  asname: string | null;
}

export interface Global extends Located {
  _astname: 'Global';
  names: string[];
}

export interface Nonlocal extends Located {
  _astname: 'Nonlocal';
  names: string[];
}

export interface ExprStmt extends Located {
  _astname: 'Expr';
  value: Expr;
}

export interface Pass extends Located {
  _astname: 'Pass';
}

export interface Break extends Located {
  _astname: 'Break';
}

export interface Continue extends Located {
  _astname: 'Continue';
}

export type Stmt =
  | FunctionDef
  | ClassDef
  | Return
  | Delete
  | Assign
  | AugAssign
  | AnnAssign
  | For
  | While
  | If
  | Match
  | With
  | Raise
  | Try
  | Assert
  | Import
  | ImportFrom
  | Global
  | Nonlocal
  | ExprStmt
  | Pass
  | Break
  | Continue;

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export interface BoolOp extends Located {
  _astname: 'BoolOp';
  op: BoolOperator;
  values: Expr[];
}

export interface BinOp extends Located {
  _astname: 'BinOp';
  left: Expr;
  op: BinOperator;
  right: Expr;
}

export interface UnaryOp extends Located {
  _astname: 'UnaryOp';
  op: UnaryOperator;
  operand: Expr;
}

export interface Lambda extends Located {
  _astname: 'Lambda';
  args: Arguments;
  body: Expr;
}

export interface IfExp extends Located {
  _astname: 'IfExp';
  test: Expr;
  body: Expr;
  orelse: Expr;
}

export interface Dict extends Located {
  _astname: 'Dict';
  /** `null` key marks a `**mapping` unpack entry (CPython 3.5+). */
  keys: (Expr | null)[];
  values: Expr[];
}

export interface SetExpr extends Located {
  _astname: 'Set';
  elts: Expr[];
}

export interface ListComp extends Located {
  _astname: 'ListComp';
  elt: Expr;
  generators: Comprehension[];
}

export interface SetComp extends Located {
  _astname: 'SetComp';
  elt: Expr;
  generators: Comprehension[];
}

export interface DictComp extends Located {
  _astname: 'DictComp';
  key: Expr;
  value: Expr;
  generators: Comprehension[];
}

export interface GeneratorExp extends Located {
  _astname: 'GeneratorExp';
  elt: Expr;
  generators: Comprehension[];
}

export interface Comprehension {
  _astname: 'comprehension';
  target: Expr;
  iter: Expr;
  ifs: Expr[];
  is_async: number;
}

export interface Yield extends Located {
  _astname: 'Yield';
  value: Expr | null;
}

export interface YieldFrom extends Located {
  _astname: 'YieldFrom';
  value: Expr;
}

export interface Await extends Located {
  _astname: 'Await';
  value: Expr;
}

/** Walrus operator `target := value` (M3.6). */
export interface NamedExpr extends Located {
  _astname: 'NamedExpr';
  target: Expr;
  value: Expr;
}

export interface Compare extends Located {
  _astname: 'Compare';
  left: Expr;
  ops: CmpOperator[];
  comparators: Expr[];
}

export interface Call extends Located {
  _astname: 'Call';
  func: Expr;
  args: Expr[];
  keywords: Keyword[];
}

export interface Keyword {
  _astname: 'keyword';
  /** `null` for `**kwargs`. */
  arg: string | null;
  value: Expr;
}

export interface Num extends Located {
  _astname: 'Num';
  n: number;
  /** Original literal text (`1j`, `0x10`, `1_000`, …). */
  source: string;
}

export interface Str extends Located {
  _astname: 'Str';
  s: string;
  /** Original literal text including quotes/prefix. */
  source: string;
}

export interface FormattedValue extends Located {
  _astname: 'FormattedValue';
  value: Expr;
  /** Ord of the conversion char (`115`/`114`/`97` for s/r/a) or -1. */
  conversion: number;
  format_spec: JoinedStr | null;
}

export interface JoinedStr extends Located {
  _astname: 'JoinedStr';
  values: (Str | FormattedValue)[];
  /** Original literal text of the whole f-string when converted from source. */
  source?: string;
}

export interface Bytes extends Located {
  _astname: 'Bytes';
  s: string;
  source: string;
}

export interface NameConstant extends Located {
  _astname: 'NameConstant';
  /** `null` = None, `true`/`false` = True/False. */
  value: null | boolean;
}

export interface EllipsisNode extends Located {
  _astname: 'Ellipsis';
}

export interface Attribute extends Located {
  _astname: 'Attribute';
  value: Expr;
  attr: string;
  ctx: ExprContext;
}

export interface Subscript extends Located {
  _astname: 'Subscript';
  value: Expr;
  slice: SliceKind;
  ctx: ExprContext;
}

export interface Starred extends Located {
  _astname: 'Starred';
  value: Expr;
  ctx: ExprContext;
}

export interface Name extends Located {
  _astname: 'Name';
  id: string;
  ctx: ExprContext;
}

export interface ListExpr extends Located {
  _astname: 'List';
  elts: Expr[];
  ctx: ExprContext;
}

export interface Tuple extends Located {
  _astname: 'Tuple';
  elts: Expr[];
  ctx: ExprContext;
}

export type Expr =
  | BoolOp
  | BinOp
  | UnaryOp
  | Lambda
  | IfExp
  | Dict
  | SetExpr
  | ListComp
  | SetComp
  | DictComp
  | GeneratorExp
  | Yield
  | YieldFrom
  | Await
  | NamedExpr
  | Compare
  | Call
  | Num
  | Str
  | JoinedStr
  | FormattedValue
  | Bytes
  | NameConstant
  | EllipsisNode
  | Attribute
  | Subscript
  | Starred
  | Name
  | ListExpr
  | Tuple;

// ---------------------------------------------------------------------------
// Subscript slices (pre-3.9 style, matching Skulpt)
// ---------------------------------------------------------------------------

export interface Index {
  _astname: 'Index';
  value: Expr;
}

export interface Slice {
  _astname: 'Slice';
  lower: Expr | null;
  upper: Expr | null;
  step: Expr | null;
}

export interface ExtSlice {
  _astname: 'ExtSlice';
  dims: (Index | Slice)[];
}

export type SliceKind = Index | Slice | ExtSlice;

// ---------------------------------------------------------------------------
// Function signatures
// ---------------------------------------------------------------------------

export interface Arguments {
  _astname: 'arguments';
  args: Arg[];
  vararg: Arg | null;
  kwonlyargs: Arg[];
  /** Aligned with `kwonlyargs`; `null` = no default. */
  kw_defaults: (Expr | null)[];
  kwarg: Arg | null;
  /** Defaults for the last `defaults.length` entries of `args`. */
  defaults: Expr[];
}

export interface Arg extends Located {
  _astname: 'arg';
  arg: string;
  annotation: Expr | null;
}

/** Any IR node (loose type used by the ported converters' dispatch). */
export type AnyNode =
  | Module
  | Stmt
  | Expr
  | SliceKind
  | Arguments
  | Arg
  | Alias
  | Keyword
  | Comprehension
  | WithItem
  | ExceptHandler
  | OpNode;
