/**
 * Lezer parse + diagnostics — the B1–B3 "blockable" gate (spec §8).
 *
 * Per spike S2: Lezer error-recovers, so "has any error node" is the correct
 * unparseable test — blocks must never be generated from a recovered tree.
 * The one deliberate tolerance closes the S2 known-gap: `@lezer/python`
 * rejects valueless `yield` (which BlockMirror and CPython support) by
 * emitting a ZERO-WIDTH error node right after the `yield` keyword inside a
 * YieldStatement/YieldExpression. That exact pattern is treated as parseable
 * and `cst/to-ast.ts` produces `Yield { value: null }` for it.
 */
import { parser } from '@lezer/python';
import type { SyntaxNode, Tree } from '@lezer/common';

export interface ParseDiagnostic {
  from: number;
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** 0-based column of `from`. */
  col: number;
}

export interface ParseOutcome {
  tree: Tree;
  /** Error nodes that make the tree unusable for block generation. */
  errors: ParseDiagnostic[];
  /** True when Blocks/Split views may be generated from this source (B3). */
  blockable: boolean;
}

/** Precomputed offsets of each line start, for offset→line/col mapping. */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }

  /** 1-based line containing `pos`. */
  lineOf(pos: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  /** 0-based column of `pos`. */
  colOf(pos: number): number {
    return pos - this.starts[this.lineOf(pos) - 1]!;
  }
}

/** The S2 known-gap tolerance: zero-width error right after bare `yield`. */
export function isTolerableYieldError(node: SyntaxNode): boolean {
  if (node.from !== node.to) return false;
  const parent = node.parent;
  if (parent === null || (parent.name !== 'YieldStatement' && parent.name !== 'YieldExpression')) {
    return false;
  }
  const prev = node.prevSibling;
  return prev !== null && prev.name === 'yield';
}

export function parseSource(source: string): ParseOutcome {
  const tree = parser.parse(source);
  const lines = new LineIndex(source);
  const errors: ParseDiagnostic[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.type.isError) {
        const node = ref.node;
        if (!isTolerableYieldError(node)) {
          errors.push({
            from: node.from,
            to: node.to,
            line: lines.lineOf(node.from),
            col: lines.colOf(node.from),
          });
        }
      }
    },
  });
  return { tree, errors, blockable: errors.length === 0 };
}
