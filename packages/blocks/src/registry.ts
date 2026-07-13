/**
 * Registration points for the per-AST-node block modules (`src/ast/*`).
 *
 * Each ported module registers, at import time:
 *  - its Blockly block definition(s) (JSON via `defineBlocks` and/or
 *    imperative `Blockly.Blocks[...] = {...}`),
 *  - its python generator (`generator.forBlock[...]`),
 *  - its IR→XML converter (`registerConverter`), dispatched by `_astname`
 *    from `TextToBlocksConverter.convert`.
 */
import * as Blockly from 'blockly/core';
// Standard block library — registers the extensions the ported blocks apply
// (e.g. `contextMenu_variableSetterGetter`), exactly as the legacy bundle
// always had them loaded.
import 'blockly/blocks';
import * as En from 'blockly/msg/en';

// Studio imports `blockly/core` directly, which — unlike the full `blockly`
// entry — never populates `Blockly.Msg`. Without a locale the DEFAULT
// context menu throws on `Msg.DELETE_X_BLOCKS.replace(...)` at right-click
// and every Msg-driven label (variables flyout button, rename/delete
// entries) renders blank (M3.1).
Blockly.setLocale(En as unknown as { [key: string]: string });
import { installGeneratorShims } from './generator';
import type { TextToBlocksConverter } from './text-to-blocks';
import type { AnyNode } from './ir/types';

export type ConverterResult = Element | Element[] | null;
/**
 * What `TextToBlocksConverter.convert` passes as `parent`: the enclosing IR
 * node, or `undefined` only for the root `Module`.
 */
export type ConverterParent = AnyNode | undefined;
export type Converter<N extends AnyNode = AnyNode> = (
  this: TextToBlocksConverter,
  node: N,
  parent: ConverterParent,
) => ConverterResult;

const converters = new Map<string, Converter>();

export function registerConverter<N extends AnyNode>(astname: string, fn: Converter<N>): void {
  // Dispatch is keyed by `_astname`, which pins the node type registered
  // here; the map stores the wide signature (single controlled narrowing).
  converters.set(astname, fn as Converter);
}

export function getConverter(astname: string): Converter | undefined {
  return converters.get(astname);
}

/** Define Blockly blocks from JSON, installing the generator shims first. */
export function defineBlocks(...jsonDefs: object[]): void {
  installGeneratorShims();
  Blockly.common.defineBlocksWithJsonArray(jsonDefs);
}

/** Access point for imperative block definitions (legacy `Blockly.Blocks`). */
export function defineBlock(
  type: string,
  // Loose on purpose: legacy definitions type `this` as their own augmented
  // block shape, which is narrower than Blockly.Block.
  definition: Record<string, unknown>,
): void {
  installGeneratorShims();
  Blockly.Blocks[type] = definition as unknown as (typeof Blockly.Blocks)[string];
}
