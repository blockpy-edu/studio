/**
 * Lezer CST → AST-IR converter (spike S2 / maintainer decision: text→blocks
 * is driven by CodeMirror's CST, not CPython `ast` in the engine worker).
 *
 * Produces the Skulpt-shaped IR from `../ir/types` that the ported
 * BlockMirror converters consume. Shapes intentionally match CPython 3.7
 * semantics because that is what Skulpt's `astFromParse` gave BlockMirror:
 *  - chained comparisons collapse into one `Compare`,
 *  - same-operator `and`/`or` chains collapse into one `BoolOp`
 *    (parenthesized sub-chains do NOT collapse - checked on the CST, where
 *    the parens still exist),
 *  - subscripts use `Index`/`Slice`/`ExtSlice`, and `a[1, 2]` is
 *    `Index(Tuple)` while `a[1:2, 3]` is `ExtSlice([Slice, Index])`,
 *  - elif chains nest through `orelse`,
 *  - decorated definitions take the first decorator's line number.
 */
import type { SyntaxNode, Tree } from '@lezer/common';
import { LineIndex, isTolerableYieldError, parseSource } from './parse';
import type * as ir from '../ir/types';

export class AstParseError extends Error {
  constructor(
    message: string,
    readonly lineno: number,
  ) {
    super(message);
    this.name = 'AstParseError';
  }
}

export interface SourceComment {
  /** 1-based line. */
  line: number;
  /** 0-based column. */
  col: number;
  /** Comment text including the leading `#`. */
  text: string;
}

export interface SourceAst {
  ast: ir.Module;
  comments: SourceComment[];
}

/**
 * Parse `source` and convert to the AST IR.
 * @throws AstParseError when the tree has (non-tolerated) error nodes.
 */
export function sourceToAst(source: string): SourceAst {
  const { tree, errors } = parseSource(source);
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new AstParseError(`bad input on line ${first.line}`, first.line);
  }
  return new CstConverter(source, tree).convertScript();
}

function op<Name extends string>(name: Name): ir.OpNode<Name> {
  return { _astname: name };
}

const LOAD: ir.ExprContext = op('Load');
const STORE: ir.ExprContext = op('Store');
const DEL: ir.ExprContext = op('Del');

const ARITH_OPS: Record<string, ir.BinOperator['_astname']> = {
  '+': 'Add',
  '-': 'Sub',
  '*': 'Mult',
  '@': 'MatMult',
  '/': 'Div',
  '%': 'Mod',
  '**': 'Pow',
  '//': 'FloorDiv',
};
const BIT_OPS: Record<string, ir.BinOperator['_astname']> = {
  '<<': 'LShift',
  '>>': 'RShift',
  '|': 'BitOr',
  '^': 'BitXor',
  '&': 'BitAnd',
};
const COMPARE_OPS: Record<string, ir.CmpOperator['_astname']> = {
  '==': 'Eq',
  '!=': 'NotEq',
  '<': 'Lt',
  '<=': 'LtE',
  '>': 'Gt',
  '>=': 'GtE',
  '<>': 'NotEq',
};

class CstConverter {
  private readonly lines: LineIndex;

  constructor(
    private readonly source: string,
    private readonly tree: Tree,
  ) {
    this.lines = new LineIndex(source);
  }

  // -- generic helpers ------------------------------------------------------

  private text(node: SyntaxNode): string {
    return this.source.slice(node.from, node.to);
  }

  private lineOf(node: SyntaxNode): number {
    return this.lines.lineOf(node.from);
  }

  private colOf(node: SyntaxNode): number {
    return this.lines.colOf(node.from);
  }

  /** Structural children: skips comments and tolerated yield errors. */
  private childrenOf(node: SyntaxNode): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (let c = node.firstChild; c !== null; c = c.nextSibling) {
      if (c.name === 'Comment') continue;
      if (c.type.isError && isTolerableYieldError(c)) continue;
      if (c.type.isError) {
        throw new AstParseError(`bad input on line ${this.lineOf(c)}`, this.lineOf(c));
      }
      out.push(c);
    }
    return out;
  }

  private fail(node: SyntaxNode, why: string): never {
    throw new AstParseError(`${why} (line ${this.lineOf(node)})`, this.lineOf(node));
  }

  // -- entry ----------------------------------------------------------------

  convertScript(): SourceAst {
    const top = this.tree.topNode;
    const body: ir.Stmt[] = [];
    for (const child of this.childrenOf(top)) {
      body.push(...this.statement(child));
    }
    return { ast: { _astname: 'Module', body }, comments: this.collectComments() };
  }

  private collectComments(): SourceComment[] {
    const comments: SourceComment[] = [];
    this.tree.iterate({
      enter: (ref) => {
        if (ref.name === 'Comment') {
          comments.push({
            line: this.lines.lineOf(ref.from),
            col: this.lines.colOf(ref.from),
            text: this.source.slice(ref.from, ref.to),
          });
        }
      },
    });
    return comments;
  }

  // -- statements -----------------------------------------------------------

  private statement(node: SyntaxNode): ir.Stmt[] {
    const lineno = this.lineOf(node);
    const col_offset = this.colOf(node);
    const loc = { lineno, col_offset };
    switch (node.name) {
      case 'ExpressionStatement': {
        const value = this.expressionSequence(this.childrenOf(node), node);
        return [{ _astname: 'Expr', value, ...loc }];
      }
      case 'AssignStatement':
        return [this.assignStatement(node, loc)];
      case 'UpdateStatement':
        return [this.updateStatement(node, loc)];
      case 'IfStatement':
        return [this.ifStatement(node)];
      case 'MatchStatement':
        return [this.matchStatement(node, loc)];
      case 'WhileStatement':
        return [this.whileStatement(node, loc)];
      case 'ForStatement':
        return [this.forStatement(node, loc)];
      case 'TryStatement':
        return [this.tryStatement(node, loc)];
      case 'WithStatement':
        return [this.withStatement(node, loc)];
      case 'FunctionDefinition':
        return [this.functionDefinition(node, [], loc)];
      case 'ClassDefinition':
        return [this.classDefinition(node, [], loc)];
      case 'DecoratedStatement':
        return [this.decoratedStatement(node, loc)];
      case 'ImportStatement':
        return [this.importStatement(node, loc)];
      case 'ReturnStatement': {
        const exprs = this.childrenOf(node).slice(1);
        return [
          {
            _astname: 'Return',
            value: exprs.length ? this.expressionSequence(exprs, node) : null,
            ...loc,
          },
        ];
      }
      case 'DeleteStatement': {
        const targets = this.commaSeparated(this.childrenOf(node).slice(1)).map((group) =>
          this.expressionSequence(group, node, DEL),
        );
        return [{ _astname: 'Delete', targets, ...loc }];
      }
      case 'ScopeStatement': {
        const children = this.childrenOf(node);
        const keyword = children[0]!.name;
        const names = children
          .slice(1)
          .filter((c) => c.name === 'VariableName')
          .map((c) => this.text(c));
        if (keyword === 'global') {
          return [{ _astname: 'Global', names, ...loc }];
        }
        return [{ _astname: 'Nonlocal', names, ...loc }];
      }
      case 'AssertStatement': {
        const groups = this.commaSeparated(this.childrenOf(node).slice(1));
        return [
          {
            _astname: 'Assert',
            test: this.expressionSequence(groups[0]!, node),
            msg: groups.length > 1 ? this.expressionSequence(groups[1]!, node) : null,
            ...loc,
          },
        ];
      }
      case 'RaiseStatement': {
        const rest = this.childrenOf(node).slice(1);
        const fromIdx = rest.findIndex((c) => c.name === 'from');
        const excNodes = fromIdx === -1 ? rest : rest.slice(0, fromIdx);
        const causeNodes = fromIdx === -1 ? [] : rest.slice(fromIdx + 1);
        return [
          {
            _astname: 'Raise',
            exc: excNodes.length ? this.expressionSequence(excNodes, node) : null,
            cause: causeNodes.length ? this.expressionSequence(causeNodes, node) : null,
            ...loc,
          },
        ];
      }
      case 'YieldStatement': {
        const value = this.yieldValue(node, loc);
        return [{ _astname: 'Expr', value, ...loc }];
      }
      case 'PassStatement':
        return [{ _astname: 'Pass', ...loc }];
      case 'BreakStatement':
        return [{ _astname: 'Break', ...loc }];
      case 'ContinueStatement':
        return [{ _astname: 'Continue', ...loc }];
      case 'StatementGroup': {
        // Semicolon-joined simple statements (`a = 1; b = 2`) - the grammar
        // wraps them in one StatementGroup node (M7.5). Flatten into
        // separate statements sharing the line, exactly the shape Skulpt
        // gave BlockMirror (two same-lineno statements → stacked blocks);
        // the return trip normalizes `;` to newlines, as legacy did.
        const out: ir.Stmt[] = [];
        for (const child of this.childrenOf(node)) {
          if (child.name === ';') continue;
          out.push(...this.statement(child));
        }
        return out;
      }
      default:
        this.fail(node, `unsupported statement ${node.name}`);
    }
  }

  /** Shared by YieldStatement and YieldExpression. */
  private yieldValue(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.Yield | ir.YieldFrom {
    const rest = this.childrenOf(node).slice(1); // drop `yield`
    if (rest.length > 0 && rest[0]!.name === 'from') {
      return {
        _astname: 'YieldFrom',
        value: this.expressionSequence(rest.slice(1), node),
        ...loc,
      };
    }
    return {
      _astname: 'Yield',
      value: rest.length ? this.expressionSequence(rest, node) : null,
      ...loc,
    };
  }

  private assignStatement(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Stmt {
    const children = this.childrenOf(node);
    const typeDef = children.find((c) => c.name === 'TypeDef');
    const structural = children.filter((c) => c.name !== 'TypeDef');
    // Split into segments on AssignOp `=` (chained assignment).
    const segments: SyntaxNode[][] = [[]];
    for (const child of structural) {
      if (child.name === 'AssignOp' && this.text(child) === '=') {
        segments.push([]);
      } else {
        segments[segments.length - 1]!.push(child);
      }
    }
    if (typeDef !== undefined) {
      // Annotated assignment: `target : annotation [= value]`
      const target = this.expressionSequence(segments[0]!, node, STORE);
      const annotation = this.typeDefExpression(typeDef);
      const value = segments.length > 1 ? this.expressionSequence(segments[1]!, node) : null;
      return {
        _astname: 'AnnAssign',
        target,
        annotation,
        value,
        simple: target._astname === 'Name' ? 1 : 0,
        ...loc,
      };
    }
    if (segments.length < 2) {
      this.fail(node, 'assignment without value');
    }
    const value = this.expressionSequence(segments[segments.length - 1]!, node);
    const targets = segments
      .slice(0, -1)
      .map((segment) => this.expressionSequence(segment, node, STORE));
    return { _astname: 'Assign', targets, value, ...loc };
  }

  private typeDefExpression(typeDef: SyntaxNode): ir.Expr {
    // TypeDef wraps `: expr` (annotations) or `-> expr` (returns).
    const inner = this.childrenOf(typeDef).filter((c) => c.name !== ':');
    return this.expressionSequence(inner, typeDef);
  }

  private updateStatement(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.AugAssign {
    const children = this.childrenOf(node);
    const opIdx = children.findIndex((c) => c.name === 'UpdateOp');
    const opText = this.text(children[opIdx]!).slice(0, -1); // drop `=`
    const opName = ARITH_OPS[opText] ?? BIT_OPS[opText];
    if (opName === undefined) {
      this.fail(node, `unsupported augmented operator ${opText}=`);
    }
    return {
      _astname: 'AugAssign',
      target: this.expressionSequence(children.slice(0, opIdx), node, STORE),
      op: op(opName),
      value: this.expressionSequence(children.slice(opIdx + 1), node),
      ...loc,
    };
  }

  private body(bodyNode: SyntaxNode): ir.Stmt[] {
    const out: ir.Stmt[] = [];
    for (const child of this.childrenOf(bodyNode)) {
      if (child.name === ':') continue;
      out.push(...this.statement(child));
    }
    return out;
  }

  private ifStatement(node: SyntaxNode): ir.If {
    const children = this.childrenOf(node);
    // Sequence: if expr Body (elif expr Body)* (else Body)?
    interface Branch {
      keyword: string;
      lineno: number;
      col_offset: number;
      test: ir.Expr | null;
      body: ir.Stmt[];
    }
    const branches: Branch[] = [];
    let i = 0;
    while (i < children.length) {
      const kw = children[i]!;
      const keyword = kw.name;
      let test: ir.Expr | null = null;
      let j = i + 1;
      const testNodes: SyntaxNode[] = [];
      while (j < children.length && children[j]!.name !== 'Body') {
        testNodes.push(children[j]!);
        j += 1;
      }
      if (testNodes.length) test = this.expressionSequence(testNodes, node);
      branches.push({
        keyword,
        lineno: this.lineOf(kw),
        col_offset: this.colOf(kw),
        test,
        body: this.body(children[j]!),
      });
      i = j + 1;
    }
    // Fold elif/else into nested orelse, right to left.
    let orelse: ir.Stmt[] = [];
    for (let b = branches.length - 1; b >= 1; b -= 1) {
      const branch = branches[b]!;
      if (branch.keyword === 'else') {
        orelse = branch.body;
      } else {
        orelse = [
          {
            _astname: 'If',
            test: branch.test!,
            body: branch.body,
            orelse,
            lineno: branch.lineno,
            col_offset: branch.col_offset,
          },
        ];
      }
    }
    const first = branches[0]!;
    return {
      _astname: 'If',
      test: first.test!,
      body: first.body,
      orelse,
      lineno: first.lineno,
      col_offset: first.col_offset,
    };
  }

  /**
   * match/case (M3.6). CST: `match` expr MatchBody{ ':' MatchClause+ };
   * MatchClause: `case` pattern+ Guard? Body. v1 keeps each case pattern
   * TEXTUAL - the raw source between the `case` keyword and the clause
   * body, guards included - patterns are not expressions and BlockMirror
   * has no precedent (plan M3.6 design decision).
   */
  private matchStatement(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Match {
    const children = this.childrenOf(node);
    const bodyIdx = children.findIndex((c) => c.name === 'MatchBody');
    if (bodyIdx <= 1) this.fail(node, 'malformed match statement');
    const subject = this.expressionSequence(
      children.slice(1, bodyIdx).filter((c) => c.name !== '*'),
      node,
    );
    const cases: ir.MatchCase[] = [];
    for (const clause of this.childrenOf(children[bodyIdx]!)) {
      if (clause.name !== 'MatchClause') continue; // ':' etc.
      const parts = this.childrenOf(clause);
      const body = parts[parts.length - 1];
      if (!body || body.name !== 'Body') this.fail(clause, 'malformed case clause');
      const caseKw = parts[0]!;
      const pattern = this.source.slice(caseKw.to, body.from).trim();
      cases.push({
        _astname: 'match_case',
        pattern,
        body: this.body(body),
        lineno: this.lineOf(clause),
        col_offset: this.colOf(clause),
      });
    }
    if (cases.length === 0) this.fail(node, 'match statement without cases');
    return { _astname: 'Match', subject, cases, ...loc };
  }

  private whileStatement(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.While {
    const children = this.childrenOf(node);
    const bodies = children.filter((c) => c.name === 'Body');
    const testNodes = children.filter(
      (c, idx) => idx > 0 && c.name !== 'Body' && c.name !== 'else',
    );
    return {
      _astname: 'While',
      test: this.expressionSequence(testNodes, node),
      body: this.body(bodies[0]!),
      orelse: bodies.length > 1 ? this.body(bodies[1]!) : [],
      ...loc,
    };
  }

  private forStatement(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.For {
    const rawChildren = this.childrenOf(node);
    const isAsync = rawChildren[0]?.name === 'async';
    const children = isAsync ? rawChildren.slice(1) : rawChildren;
    const inIdx = children.findIndex((c) => c.name === 'in');
    const bodyIdx = children.findIndex((c) => c.name === 'Body');
    const target = this.expressionSequence(children.slice(1, inIdx), node, STORE);
    const iter = this.expressionSequence(children.slice(inIdx + 1, bodyIdx), node);
    const bodies = children.filter((c) => c.name === 'Body');
    return {
      _astname: 'For',
      target,
      iter,
      body: this.body(bodies[0]!),
      orelse: bodies.length > 1 ? this.body(bodies[1]!) : [],
      ...(isAsync ? { is_async: true } : {}),
      ...loc,
    };
  }

  private tryStatement(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Try {
    const children = this.childrenOf(node);
    const body = this.body(children[1]!);
    const handlers: ir.ExceptHandler[] = [];
    let orelse: ir.Stmt[] = [];
    let finalbody: ir.Stmt[] = [];
    let i = 2;
    while (i < children.length) {
      const kw = children[i]!;
      if (kw.name === 'except') {
        const handlerLoc = { lineno: this.lineOf(kw), col_offset: this.colOf(kw) };
        let j = i + 1;
        const typeNodes: SyntaxNode[] = [];
        let name: string | null = null;
        while (j < children.length && children[j]!.name !== 'Body') {
          if (children[j]!.name === 'as') {
            name = this.text(children[j + 1]!);
            j += 2;
            continue;
          }
          typeNodes.push(children[j]!);
          j += 1;
        }
        handlers.push({
          _astname: 'ExceptHandler',
          type: typeNodes.length ? this.expressionSequence(typeNodes, node) : null,
          name,
          body: this.body(children[j]!),
          ...handlerLoc,
        });
        i = j + 1;
      } else if (kw.name === 'else') {
        orelse = this.body(children[i + 1]!);
        i += 2;
      } else if (kw.name === 'finally') {
        finalbody = this.body(children[i + 1]!);
        i += 2;
      } else {
        this.fail(kw, `unexpected ${kw.name} in try statement`);
      }
    }
    return { _astname: 'Try', body, handlers, orelse, finalbody, ...loc };
  }

  private withStatement(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.With {
    const rawChildren = this.childrenOf(node);
    const isAsync = rawChildren[0]?.name === 'async';
    const children = isAsync ? rawChildren.slice(1) : rawChildren;
    const bodyIdx = children.findIndex((c) => c.name === 'Body');
    const itemNodes = children.slice(1, bodyIdx);
    const items: ir.WithItem[] = [];
    for (const group of this.commaSeparated(itemNodes)) {
      const asIdx = group.findIndex((c) => c.name === 'as');
      if (asIdx === -1) {
        items.push({
          _astname: 'withitem',
          context_expr: this.expressionSequence(group, node),
          optional_vars: null,
        });
      } else {
        items.push({
          _astname: 'withitem',
          context_expr: this.expressionSequence(group.slice(0, asIdx), node),
          optional_vars: this.expressionSequence(group.slice(asIdx + 1), node, STORE),
        });
      }
    }
    return {
      _astname: 'With',
      items,
      body: this.body(children[bodyIdx]!),
      ...(isAsync ? { is_async: true } : {}),
      ...loc,
    };
  }

  private functionDefinition(
    node: SyntaxNode,
    decorators: ir.Expr[],
    loc: { lineno: number; col_offset: number },
  ): ir.FunctionDef {
    // `async def` (M3.6): strip the leading keyword so positional indexing
    // holds (children[1] used to read `def` as the function name).
    const rawChildren = this.childrenOf(node);
    const isAsync = rawChildren[0]?.name === 'async';
    const children = isAsync ? rawChildren.slice(1) : rawChildren;
    const name = this.text(children[1]!);
    const paramList = children.find((c) => c.name === 'ParamList')!;
    const typeDef = children.find((c) => c.name === 'TypeDef');
    const bodyNode = children.find((c) => c.name === 'Body')!;
    return {
      _astname: 'FunctionDef',
      name,
      args: this.parameters(paramList),
      body: this.body(bodyNode),
      decorator_list: decorators,
      returns: typeDef !== undefined ? this.typeDefExpression(typeDef) : null,
      ...(isAsync ? { is_async: true } : {}),
      ...loc,
    };
  }

  private classDefinition(
    node: SyntaxNode,
    decorators: ir.Expr[],
    loc: { lineno: number; col_offset: number },
  ): ir.ClassDef {
    const children = this.childrenOf(node);
    const name = this.text(children[1]!);
    const argList = children.find((c) => c.name === 'ArgList');
    const bodyNode = children.find((c) => c.name === 'Body')!;
    const bases: ir.Expr[] = [];
    const keywords: ir.Keyword[] = [];
    if (argList !== undefined) {
      const { args, keywords: kws } = this.callArguments(argList);
      for (const arg of args) bases.push(arg);
      for (const kw of kws) keywords.push(kw);
    }
    return {
      _astname: 'ClassDef',
      name,
      bases,
      keywords,
      body: this.body(bodyNode),
      decorator_list: decorators,
      ...loc,
    };
  }

  private decoratedStatement(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.Stmt {
    const children = this.childrenOf(node);
    const decorators: ir.Expr[] = [];
    let target: SyntaxNode | null = null;
    for (const child of children) {
      if (child.name === 'Decorator') {
        const inner = this.childrenOf(child).filter((c) => c.name !== 'At');
        // A call decorator is flattened by the grammar: `@open('x')` yields
        // [VariableName, ArgList] with no CallExpression wrapper.
        const last = inner[inner.length - 1];
        if (last !== undefined && last.name === 'ArgList') {
          const { args, keywords } = this.callArguments(last);
          decorators.push({
            _astname: 'Call',
            func: this.expressionSequence(inner.slice(0, -1), child),
            args,
            keywords,
            lineno: this.lineOf(child),
            col_offset: this.colOf(child),
          });
        } else {
          decorators.push(this.expressionSequence(inner, child));
        }
      } else {
        target = child;
      }
    }
    if (target === null) this.fail(node, 'decorator without definition');
    // Skulpt (CPython ≤3.7) semantics: the definition takes the line of the
    // first decorator.
    if (target.name === 'FunctionDefinition') {
      return this.functionDefinition(target, decorators, loc);
    }
    if (target.name === 'ClassDefinition') {
      return this.classDefinition(target, decorators, loc);
    }
    this.fail(target, `unsupported decorated ${target.name}`);
  }

  private importStatement(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.Import | ir.ImportFrom {
    const children = this.childrenOf(node);
    const isFrom = children[0]!.name === 'from';
    if (!isFrom) {
      return {
        _astname: 'Import',
        names: this.aliases(children.slice(1)),
        ...loc,
      };
    }
    const importIdx = children.findIndex((c) => c.name === 'import');
    let level = 0;
    const moduleParts: string[] = [];
    for (const child of children.slice(1, importIdx)) {
      if (child.name === '.' && moduleParts.length === 0) {
        level += this.text(child).length;
      } else if (child.name === '.') {
        // separator inside the dotted module name
      } else {
        moduleParts.push(this.text(child));
      }
    }
    const nameNodes = children.slice(importIdx + 1);
    const names: ir.Alias[] =
      nameNodes.length === 1 && nameNodes[0]!.name === '*'
        ? [{ _astname: 'alias', name: '*', asname: null }]
        : this.aliases(nameNodes);
    return {
      _astname: 'ImportFrom',
      module: moduleParts.length ? moduleParts.join('.') : null,
      names,
      level,
      ...loc,
    };
  }

  /** Parse `a.b as c, d` style alias lists. */
  private aliases(nodes: SyntaxNode[]): ir.Alias[] {
    const aliases: ir.Alias[] = [];
    for (const group of this.commaSeparated(nodes)) {
      const asIdx = group.findIndex((c) => c.name === 'as');
      const nameParts = (asIdx === -1 ? group : group.slice(0, asIdx))
        .filter((c) => c.name !== '.')
        .map((c) => this.text(c));
      const dotted = (asIdx === -1 ? group : group.slice(0, asIdx))
        .map((c) => this.text(c))
        .join('');
      void nameParts;
      aliases.push({
        _astname: 'alias',
        name: dotted,
        asname: asIdx === -1 ? null : this.text(group[asIdx + 1]!),
      });
    }
    return aliases;
  }

  // -- parameters -----------------------------------------------------------

  private parameters(paramList: SyntaxNode): ir.Arguments {
    const children = this.childrenOf(paramList).filter((c) => c.name !== '(' && c.name !== ')');
    const result: ir.Arguments = {
      _astname: 'arguments',
      args: [],
      vararg: null,
      kwonlyargs: [],
      kw_defaults: [],
      kwarg: null,
      defaults: [],
    };
    let seenStar = false;
    for (const group of this.commaSeparated(children)) {
      if (group.length === 0) continue;
      let idx = 0;
      let kind: 'normal' | 'vararg' | 'kwarg' = 'normal';
      if (group[0]!.name === '*') {
        idx = 1;
        if (group.length === 1) {
          seenStar = true; // bare `*` separator
          continue;
        }
        kind = 'vararg';
      } else if (group[0]!.name === '**') {
        idx = 1;
        kind = 'kwarg';
      }
      const nameNode = group[idx]!;
      const typeDef = group.find((c) => c.name === 'TypeDef');
      const assignIdx = group.findIndex((c) => c.name === 'AssignOp');
      const arg: ir.Arg = {
        _astname: 'arg',
        arg: this.text(nameNode),
        annotation: typeDef !== undefined ? this.typeDefExpression(typeDef) : null,
        lineno: this.lineOf(nameNode),
        col_offset: this.colOf(nameNode),
      };
      const defaultExpr =
        assignIdx === -1 ? null : this.expressionSequence(group.slice(assignIdx + 1), paramList);
      if (kind === 'vararg') {
        result.vararg = arg;
        seenStar = true;
      } else if (kind === 'kwarg') {
        result.kwarg = arg;
      } else if (seenStar) {
        result.kwonlyargs.push(arg);
        result.kw_defaults.push(defaultExpr);
      } else {
        result.args.push(arg);
        if (defaultExpr !== null) result.defaults.push(defaultExpr);
      }
    }
    return result;
  }

  // -- expressions ----------------------------------------------------------

  /** Split a flat token run on top-level commas. */
  private commaSeparated(nodes: SyntaxNode[]): SyntaxNode[][] {
    const groups: SyntaxNode[][] = [[]];
    for (const node of nodes) {
      if (node.name === ',') {
        groups.push([]);
      } else {
        groups[groups.length - 1]!.push(node);
      }
    }
    if (groups.length > 1 && groups[groups.length - 1]!.length === 0) {
      groups.pop(); // trailing comma
    }
    if (groups.length === 1 && groups[0]!.length === 0) return [];
    return groups;
  }

  /**
   * Convert a run of sibling nodes that forms one expression - or, when it
   * contains top-level commas, an unparenthesized tuple. `*expr` becomes
   * `Starred` (assignment targets, bare tuples).
   */
  private expressionSequence(
    nodes: SyntaxNode[],
    _parent: SyntaxNode,
    ctx: ir.ExprContext = LOAD,
  ): ir.Expr {
    const groups = this.commaSeparated(nodes);
    const hadComma = nodes.some((n) => n.name === ',') || groups.length > 1;
    const exprs = groups.map((group) => this.expressionGroup(group, ctx));
    if (!hadComma && exprs.length === 1) {
      return exprs[0]!;
    }
    const first = nodes[0]!;
    return {
      _astname: 'Tuple',
      elts: exprs,
      ctx,
      lineno: this.lineOf(first),
      col_offset: this.colOf(first),
    };
  }

  /** One comma-free expression group: `expr` or `*expr`. */
  private expressionGroup(group: SyntaxNode[], ctx: ir.ExprContext): ir.Expr {
    if (group.length === 0) {
      this.fail(this.tree.topNode, 'empty expression');
    }
    if (group[0]!.name === '*') {
      const star = group[0]!;
      return {
        _astname: 'Starred',
        value: this.expressionGroup(group.slice(1), ctx),
        ctx,
        lineno: this.lineOf(star),
        col_offset: this.colOf(star),
      };
    }
    if (group.length !== 1) {
      this.fail(group[0]!, `unexpected expression sequence`);
    }
    return this.expression(group[0]!, ctx);
  }

  private expression(node: SyntaxNode, ctx: ir.ExprContext = LOAD): ir.Expr {
    const loc = { lineno: this.lineOf(node), col_offset: this.colOf(node) };
    switch (node.name) {
      case 'VariableName':
        return { _astname: 'Name', id: this.text(node), ctx, ...loc };
      case 'Number':
        return this.number(node, loc);
      case 'String':
        return this.string(node, loc);
      case 'ContinuedString':
        return this.continuedString(node, loc);
      case 'FormatString':
        return this.formatString(node, loc);
      case 'Boolean':
        return {
          _astname: 'NameConstant',
          value: this.text(node) === 'True',
          ...loc,
        };
      case 'None':
        return { _astname: 'NameConstant', value: null, ...loc };
      case 'Ellipsis':
        return { _astname: 'Ellipsis', ...loc };
      case 'ParenthesizedExpression': {
        const inner = this.childrenOf(node).filter((c) => c.name !== '(' && c.name !== ')');
        return this.expressionSequence(inner, node, ctx);
      }
      case 'TupleExpression': {
        const inner = this.childrenOf(node).filter((c) => c.name !== '(' && c.name !== ')');
        const elts = this.commaSeparated(inner).map((g) => this.expressionGroup(g, ctx));
        return { _astname: 'Tuple', elts, ctx, ...loc };
      }
      case 'ArrayExpression': {
        const inner = this.childrenOf(node).filter((c) => c.name !== '[' && c.name !== ']');
        const elts = this.commaSeparated(inner).map((g) => this.expressionGroup(g, ctx));
        return { _astname: 'List', elts, ctx, ...loc };
      }
      case 'SetExpression': {
        const inner = this.childrenOf(node).filter((c) => c.name !== '{' && c.name !== '}');
        const elts = this.commaSeparated(inner).map((g) => this.expressionGroup(g, ctx));
        return { _astname: 'Set', elts, ...loc };
      }
      case 'DictionaryExpression':
        return this.dictionary(node, loc);
      case 'ArrayComprehensionExpression':
        return this.comprehension(node, 'ListComp', loc);
      case 'SetComprehensionExpression':
        return this.comprehension(node, 'SetComp', loc);
      case 'ComprehensionExpression':
        return this.comprehension(node, 'GeneratorExp', loc);
      case 'DictionaryComprehensionExpression':
        return this.dictComprehension(node, loc);
      case 'ConditionalExpression': {
        const children = this.childrenOf(node);
        const ifIdx = children.findIndex((c) => c.name === 'if');
        const elseIdx = children.findIndex((c) => c.name === 'else');
        return {
          _astname: 'IfExp',
          body: this.expressionSequence(children.slice(0, ifIdx), node),
          test: this.expressionSequence(children.slice(ifIdx + 1, elseIdx), node),
          orelse: this.expressionSequence(children.slice(elseIdx + 1), node),
          ...loc,
        };
      }
      case 'LambdaExpression': {
        const children = this.childrenOf(node);
        const paramList = children.find((c) => c.name === 'ParamList');
        const colonIdx = children.findIndex((c) => c.name === ':');
        return {
          _astname: 'Lambda',
          args:
            paramList !== undefined
              ? this.parameters(paramList)
              : {
                  _astname: 'arguments',
                  args: [],
                  vararg: null,
                  kwonlyargs: [],
                  kw_defaults: [],
                  kwarg: null,
                  defaults: [],
                },
          body: this.expressionSequence(children.slice(colonIdx + 1), node),
          ...loc,
        };
      }
      case 'UnaryExpression': {
        const children = this.childrenOf(node);
        const opNode = children[0]!;
        const opText = this.text(opNode);
        const opName =
          opNode.name === 'not'
            ? 'Not'
            : opText === '-'
              ? 'USub'
              : opText === '+'
                ? 'UAdd'
                : opText === '~'
                  ? 'Invert'
                  : null;
        if (opName === null) this.fail(opNode, `unsupported unary ${opText}`);
        return {
          _astname: 'UnaryOp',
          op: op(opName),
          operand: this.expression(children[1]!, ctx),
          ...loc,
        };
      }
      case 'BinaryExpression':
        return this.binaryExpression(node, loc);
      case 'MemberExpression':
        return this.memberExpression(node, ctx, loc);
      case 'CallExpression': {
        const children = this.childrenOf(node);
        const func = this.expression(children[0]!);
        const argList = children.find((c) => c.name === 'ArgList')!;
        const { args, keywords } = this.callArguments(argList);
        return { _astname: 'Call', func, args, keywords, ...loc };
      }
      case 'YieldExpression':
        return this.yieldValue(node, loc);
      case 'AwaitExpression': {
        const children = this.childrenOf(node);
        return {
          _astname: 'Await',
          value: this.expressionSequence(children.slice(1), node),
          ...loc,
        };
      }
      case 'NamedExpression': {
        // Walrus `target := value` (M3.6): grammar is
        // `test AssignOp{":="} test`.
        const children = this.childrenOf(node);
        const opIdx = children.findIndex((c) => c.name === 'AssignOp');
        if (opIdx === -1) this.fail(node, 'malformed named expression');
        return {
          _astname: 'NamedExpr',
          target: this.expressionSequence(children.slice(0, opIdx), node, STORE),
          value: this.expressionSequence(children.slice(opIdx + 1), node),
          ...loc,
        };
      }
      default:
        this.fail(node, `unsupported expression ${node.name}`);
    }
  }

  private binaryExpression(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Expr {
    const children = this.childrenOf(node);
    // Find the operator: ArithOp/BitOp/CompareOp node, or keyword tokens
    // (and / or / in / is / not / is not / not in).
    const opIdx = children.findIndex(
      (c, i) =>
        i > 0 &&
        (c.name === 'ArithOp' ||
          c.name === 'BitOp' ||
          c.name === 'CompareOp' ||
          c.name === 'and' ||
          c.name === 'or' ||
          c.name === 'in' ||
          c.name === 'is' ||
          c.name === 'not'),
    );
    if (opIdx === -1) this.fail(node, 'operator not found');
    const opNode = children[opIdx]!;
    const left = children.slice(0, opIdx);
    // `is not` / `not in` span two keyword tokens.
    let right = children.slice(opIdx + 1);
    let opText = this.text(opNode);
    if (opNode.name === 'is' && right[0]?.name === 'not') {
      opText = 'is not';
      right = right.slice(1);
    } else if (opNode.name === 'not' && right[0]?.name === 'in') {
      opText = 'not in';
      right = right.slice(1);
    }

    if (opNode.name === 'and' || opNode.name === 'or') {
      const opName = opNode.name === 'and' ? 'And' : 'Or';
      const rightExpr = this.expressionSequence(right, node);
      // CPython collapses same-op chains; the parser left-nests, so flatten
      // when the left CST child is a same-op BinaryExpression (parenthesized
      // groups keep their own BoolOp).
      const values: ir.Expr[] = [];
      if (
        left.length === 1 &&
        left[0]!.name === 'BinaryExpression' &&
        this.boolOpNameOf(left[0]!) === opName
      ) {
        const leftBool = this.expression(left[0]!) as ir.BoolOp;
        values.push(...leftBool.values);
      } else {
        values.push(this.expressionSequence(left, node));
      }
      values.push(rightExpr);
      return { _astname: 'BoolOp', op: op(opName), values, ...loc };
    }

    if (
      opNode.name === 'CompareOp' ||
      opNode.name === 'in' ||
      opNode.name === 'is' ||
      opNode.name === 'not'
    ) {
      const cmpName =
        opNode.name === 'CompareOp'
          ? COMPARE_OPS[opText]
          : opText === 'in'
            ? 'In'
            : opText === 'not in'
              ? 'NotIn'
              : opText === 'is'
                ? 'Is'
                : 'IsNot';
      if (cmpName === undefined) this.fail(opNode, `unsupported ${opText}`);
      const rightExpr = this.expressionSequence(right, node);
      // Chained comparison: flatten when the left CST child is itself a
      // comparison BinaryExpression.
      if (left.length === 1 && this.isComparisonNode(left[0]!)) {
        const leftCmp = this.expression(left[0]!) as ir.Compare;
        return {
          _astname: 'Compare',
          left: leftCmp.left,
          ops: [...leftCmp.ops, op(cmpName)],
          comparators: [...leftCmp.comparators, rightExpr],
          ...loc,
        };
      }
      return {
        _astname: 'Compare',
        left: this.expressionSequence(left, node),
        ops: [op(cmpName)],
        comparators: [rightExpr],
        ...loc,
      };
    }

    const binName = ARITH_OPS[opText] ?? BIT_OPS[opText];
    if (binName === undefined) this.fail(opNode, `unsupported ${opText}`);
    return {
      _astname: 'BinOp',
      left: this.expressionSequence(left, node),
      op: op(binName),
      right: this.expressionSequence(right, node),
      ...loc,
    };
  }

  /** BoolOp name of a BinaryExpression CST node, if it is one. */
  private boolOpNameOf(node: SyntaxNode): 'And' | 'Or' | null {
    for (let c = node.firstChild; c !== null; c = c.nextSibling) {
      if (c.name === 'and') return 'And';
      if (c.name === 'or') return 'Or';
    }
    return null;
  }

  /** Is this CST node a comparison BinaryExpression? */
  private isComparisonNode(node: SyntaxNode): boolean {
    if (node.name !== 'BinaryExpression') return false;
    for (let c = node.firstChild; c !== null; c = c.nextSibling) {
      if (c.name === 'CompareOp' || c.name === 'in' || c.name === 'is') {
        return true;
      }
      if (c.name === 'not' && c.nextSibling?.name === 'in') return true;
    }
    return false;
  }

  private memberExpression(
    node: SyntaxNode,
    ctx: ir.ExprContext,
    loc: { lineno: number; col_offset: number },
  ): ir.Expr {
    const children = this.childrenOf(node);
    const value = this.expression(children[0]!);
    if (children.some((c) => c.name === '.')) {
      const prop = children.find((c) => c.name === 'PropertyName')!;
      return {
        _astname: 'Attribute',
        value,
        attr: this.text(prop),
        ctx,
        ...loc,
      };
    }
    // Subscript: parse the bracket contents into Index/Slice/ExtSlice.
    const inner = children.filter((c, i) => i > 0 && c.name !== '[' && c.name !== ']');
    const slice = this.subscriptSlice(inner, node);
    return { _astname: 'Subscript', value, slice, ctx, ...loc };
  }

  private subscriptSlice(inner: SyntaxNode[], parent: SyntaxNode): ir.SliceKind {
    interface Segment {
      parts: SyntaxNode[][]; // split on `:`
      isSlice: boolean;
    }
    const segments: Segment[] = [];
    for (const group of splitOn(inner, ',')) {
      const parts = splitOn(group, ':');
      segments.push({ parts, isSlice: parts.length > 1 });
    }
    const toDim = (segment: Segment): ir.Index | ir.Slice => {
      if (!segment.isSlice) {
        return {
          _astname: 'Index',
          value: this.expressionSequence(segment.parts[0]!, parent),
        };
      }
      const [lower, upper, step] = segment.parts;
      return {
        _astname: 'Slice',
        lower: lower && lower.length ? this.expressionSequence(lower, parent) : null,
        upper: upper && upper.length ? this.expressionSequence(upper, parent) : null,
        step: step && step.length ? this.expressionSequence(step, parent) : null,
      };
    };
    if (segments.length === 1) {
      return toDim(segments[0]!);
    }
    // Multi-dim subscripts are always ExtSlice, even all-index ones
    // (`a[1, 2]` → ExtSlice([Index, Index])). CPython ≤3.8 and Skulpt made
    // that Index(Tuple), which the legacy tuple generator re-rendered as
    // `a[(1, 2)]` - the corpus (§16.1.2 #42) asserts the text-preserving
    // ExtSlice rendering, so the corpus wins over AST-shape fidelity here.
    return { _astname: 'ExtSlice', dims: segments.map(toDim) };
  }

  private callArguments(argList: SyntaxNode): {
    args: ir.Expr[];
    keywords: ir.Keyword[];
  } {
    const inner = this.childrenOf(argList).filter((c) => c.name !== '(' && c.name !== ')');
    const args: ir.Expr[] = [];
    const keywords: ir.Keyword[] = [];
    for (const group of this.commaSeparated(inner)) {
      if (group.length === 0) continue;
      const first = group[0]!;
      if (first.name === '*') {
        args.push({
          _astname: 'Starred',
          value: this.expressionSequence(group.slice(1), argList),
          ctx: LOAD,
          lineno: this.lineOf(first),
          col_offset: this.colOf(first),
        });
        continue;
      }
      if (first.name === '**') {
        keywords.push({
          _astname: 'keyword',
          arg: null,
          value: this.expressionSequence(group.slice(1), argList),
        });
        continue;
      }
      // Keyword argument: `VariableName = expr` at the top level of the group.
      if (
        group.length >= 3 &&
        first.name === 'VariableName' &&
        group[1]!.name === 'AssignOp' &&
        this.text(group[1]!) === '='
      ) {
        keywords.push({
          _astname: 'keyword',
          arg: this.text(first),
          value: this.expressionSequence(group.slice(2), argList),
        });
        continue;
      }
      args.push(this.expressionSequence(group, argList));
    }
    return { args, keywords };
  }

  private dictionary(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Dict {
    const inner = this.childrenOf(node).filter((c) => c.name !== '{' && c.name !== '}');
    const keys: (ir.Expr | null)[] = [];
    const values: ir.Expr[] = [];
    for (const group of this.commaSeparated(inner)) {
      if (group.length === 0) continue;
      if (group[0]!.name === '**') {
        keys.push(null);
        values.push(this.expressionSequence(group.slice(1), node));
        continue;
      }
      const parts = splitOn(group, ':');
      keys.push(this.expressionSequence(parts[0]!, node));
      values.push(this.expressionSequence(parts[1]!, node));
    }
    return { _astname: 'Dict', keys, values, ...loc };
  }

  /**
   * Parse the `for target in iter [if cond]* …` tail shared by all four
   * comprehension forms. `nodes` starts at the first `for`.
   */
  private comprehensionClauses(nodes: SyntaxNode[], parent: SyntaxNode): ir.Comprehension[] {
    const generators: ir.Comprehension[] = [];
    let i = 0;
    while (i < nodes.length) {
      if (nodes[i]!.name === 'for') {
        const inIdx = findFrom(nodes, i, 'in');
        let end = nodes.length;
        for (let j = inIdx + 1; j < nodes.length; j += 1) {
          if (nodes[j]!.name === 'for' || nodes[j]!.name === 'if') {
            end = j;
            break;
          }
        }
        generators.push({
          _astname: 'comprehension',
          target: this.expressionSequence(nodes.slice(i + 1, inIdx), parent, STORE),
          iter: this.expressionSequence(nodes.slice(inIdx + 1, end), parent),
          ifs: [],
          is_async: 0,
        });
        i = end;
      } else if (nodes[i]!.name === 'if') {
        let end = nodes.length;
        for (let j = i + 1; j < nodes.length; j += 1) {
          if (nodes[j]!.name === 'for' || nodes[j]!.name === 'if') {
            end = j;
            break;
          }
        }
        generators[generators.length - 1]!.ifs.push(
          this.expressionSequence(nodes.slice(i + 1, end), parent),
        );
        i = end;
      } else {
        this.fail(nodes[i]!, `unexpected ${nodes[i]!.name} in comprehension`);
      }
    }
    return generators;
  }

  private comprehension(
    node: SyntaxNode,
    kind: 'ListComp' | 'SetComp' | 'GeneratorExp',
    loc: { lineno: number; col_offset: number },
  ): ir.Expr {
    const inner = this.childrenOf(node).filter(
      (c) => !['(', ')', '[', ']', '{', '}'].includes(c.name),
    );
    const forIdx = inner.findIndex((c) => c.name === 'for');
    const elt = this.expressionSequence(inner.slice(0, forIdx), node);
    const generators = this.comprehensionClauses(inner.slice(forIdx), node);
    return { _astname: kind, elt, generators, ...loc } as ir.Expr;
  }

  private dictComprehension(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.DictComp {
    const inner = this.childrenOf(node).filter((c) => c.name !== '{' && c.name !== '}');
    const forIdx = inner.findIndex((c) => c.name === 'for');
    const head = inner.slice(0, forIdx);
    const parts = splitOn(head, ':');
    return {
      _astname: 'DictComp',
      key: this.expressionSequence(parts[0]!, node),
      value: this.expressionSequence(parts[1]!, node),
      generators: this.comprehensionClauses(inner.slice(forIdx), node),
      ...loc,
    };
  }

  // -- literals ---------------------------------------------------------------

  private number(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Num {
    const source = this.text(node);
    let numeric = source.replace(/_/g, '');
    if (/[jJ]$/.test(numeric)) {
      numeric = numeric.slice(0, -1); // imaginary part; source keeps the `j`
    }
    let n: number;
    if (/^0[oO]/.test(numeric)) {
      n = parseInt(numeric.slice(2), 8);
    } else if (/^0[bB]/.test(numeric)) {
      n = parseInt(numeric.slice(2), 2);
    } else {
      n = Number(numeric);
    }
    return { _astname: 'Num', n, source, ...loc };
  }

  private string(node: SyntaxNode, loc: { lineno: number; col_offset: number }): ir.Str | ir.Bytes {
    const source = this.text(node);
    const { value, isBytes } = decodePythonString(source);
    if (isBytes) {
      return { _astname: 'Bytes', s: value, source, ...loc };
    }
    return { _astname: 'Str', s: value, source, ...loc };
  }

  private continuedString(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.Str | ir.Bytes {
    const parts = this.childrenOf(node);
    let value = '';
    let isBytes = false;
    for (const part of parts) {
      const decoded = decodePythonString(this.text(part));
      value += decoded.value;
      isBytes = isBytes || decoded.isBytes;
    }
    const source = this.text(node);
    if (isBytes) return { _astname: 'Bytes', s: value, source, ...loc };
    return { _astname: 'Str', s: value, source, ...loc };
  }

  private formatString(
    node: SyntaxNode,
    loc: { lineno: number; col_offset: number },
  ): ir.JoinedStr {
    const source = this.text(node);
    const children = this.childrenOf(node);
    const values: (ir.Str | ir.FormattedValue)[] = [];
    // Literal chunks are the spans between replacements inside the quotes.
    const openMatch = /^[a-zA-Z]*('''|"""|'|")/.exec(source);
    const quote = openMatch ? openMatch[1]! : '"';
    const contentStart = node.from + (openMatch ? openMatch[0].length : 1);
    const contentEnd = node.to - quote.length;
    let cursor = contentStart;
    const pushLiteral = (from: number, to: number) => {
      if (to > from) {
        const raw = this.source.slice(from, to);
        values.push({
          _astname: 'Str',
          s: raw.replace(/\{\{/g, '{').replace(/\}\}/g, '}'),
          source: raw,
          lineno: this.lines.lineOf(from),
          col_offset: this.lines.colOf(from),
        });
      }
    };
    for (const child of children) {
      if (child.name !== 'FormatReplacement') continue;
      pushLiteral(cursor, child.from);
      values.push(this.formatReplacement(child));
      cursor = child.to;
    }
    pushLiteral(cursor, contentEnd);
    return { _astname: 'JoinedStr', values, source, ...loc };
  }

  private formatReplacement(node: SyntaxNode): ir.FormattedValue {
    const children = this.childrenOf(node);
    const exprNodes: SyntaxNode[] = [];
    let conversion = -1;
    let format_spec: ir.JoinedStr | null = null;
    for (const child of children) {
      if (child.name === '{' || child.name === '}') continue;
      if (child.name === 'FormatConversion') {
        conversion = this.text(child).charCodeAt(1);
      } else if (child.name === 'FormatSpec') {
        format_spec = {
          _astname: 'JoinedStr',
          values: [
            {
              _astname: 'Str',
              s: this.text(child).slice(1),
              source: this.text(child).slice(1),
              lineno: this.lineOf(child),
              col_offset: this.colOf(child),
            },
          ],
          lineno: this.lineOf(child),
          col_offset: this.colOf(child),
        };
      } else {
        exprNodes.push(child);
      }
    }
    return {
      _astname: 'FormattedValue',
      value: this.expressionSequence(exprNodes, node),
      conversion,
      format_spec,
      lineno: this.lineOf(node),
      col_offset: this.colOf(node),
    };
  }
}

function splitOn(nodes: SyntaxNode[], separator: string): SyntaxNode[][] {
  const groups: SyntaxNode[][] = [[]];
  for (const node of nodes) {
    if (node.name === separator) {
      groups.push([]);
    } else {
      groups[groups.length - 1]!.push(node);
    }
  }
  return groups;
}

function findFrom(nodes: SyntaxNode[], start: number, name: string): number {
  for (let i = start; i < nodes.length; i += 1) {
    if (nodes[i]!.name === name) return i;
  }
  return -1;
}

/**
 * Decode a Python string literal (prefix + quotes + escapes) to its value.
 * Handles r/b/u/f prefixes in any order/case, single/triple quotes, and the
 * standard escape set; raw strings skip escape processing.
 */
export function decodePythonString(literal: string): {
  value: string;
  isBytes: boolean;
  isRaw: boolean;
  isFString: boolean;
} {
  const prefixMatch = /^[a-zA-Z]*/.exec(literal)!;
  const prefix = prefixMatch[0].toLowerCase();
  const isBytes = prefix.includes('b');
  const isRaw = prefix.includes('r');
  const isFString = prefix.includes('f');
  let rest = literal.slice(prefixMatch[0].length);
  let quote: string;
  if (rest.startsWith("'''") || rest.startsWith('"""')) {
    quote = rest.slice(0, 3);
  } else {
    quote = rest.slice(0, 1);
  }
  rest = rest.slice(quote.length, rest.length - quote.length);
  if (isRaw) {
    return { value: rest, isBytes, isRaw, isFString };
  }
  let value = '';
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i]!;
    if (ch !== '\\') {
      value += ch;
      continue;
    }
    const next = rest[i + 1];
    i += 1;
    switch (next) {
      case undefined:
        value += '\\';
        i -= 1;
        break;
      case '\n':
        break; // line continuation
      case '\\':
        value += '\\';
        break;
      case "'":
        value += "'";
        break;
      case '"':
        value += '"';
        break;
      case 'n':
        value += '\n';
        break;
      case 'r':
        value += '\r';
        break;
      case 't':
        value += '\t';
        break;
      case 'b':
        value += '\b';
        break;
      case 'f':
        value += '\f';
        break;
      case 'v':
        value += '\v';
        break;
      case 'a':
        value += '\x07';
        break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7': {
        let digits = next;
        while (digits.length < 3 && /[0-7]/.test(rest[i + 1] ?? '')) {
          i += 1;
          digits += rest[i]!;
        }
        value += String.fromCharCode(parseInt(digits, 8));
        break;
      }
      case 'x': {
        const hex = rest.slice(i + 1, i + 3);
        i += 2;
        value += String.fromCharCode(parseInt(hex, 16));
        break;
      }
      case 'u': {
        const hex = rest.slice(i + 1, i + 5);
        i += 4;
        value += String.fromCharCode(parseInt(hex, 16));
        break;
      }
      case 'U': {
        const hex = rest.slice(i + 1, i + 9);
        i += 8;
        value += String.fromCodePoint(parseInt(hex, 16));
        break;
      }
      default:
        // Unknown escape: Python keeps the backslash.
        value += '\\' + next;
        break;
    }
  }
  return { value, isBytes, isRaw, isFString };
}
