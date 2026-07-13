/**
 * @blockpy/blocks — Blockly Python block set, generator, and CST→workspace
 * builder (spec §8.3). Importing this package registers the full block set.
 */
import './ast';

export { TextToBlocksConverter } from './text-to-blocks';
export type { ConverterConfiguration, ConvertSourceResult } from './text-to-blocks';
export { workspaceToPython, xmlToWorkspace, xmlToPython } from './blocks-to-text';
export { parseSource, LineIndex } from './cst/parse';
export type { ParseOutcome, ParseDiagnostic } from './cst/parse';
export { sourceToAst, AstParseError, decodePythonString } from './cst/to-ast';
export type { SourceAst, SourceComment } from './cst/to-ast';
export { generator, Order, installGeneratorShims } from './generator';
export { installVariablesFlyout, variablesFlyoutBlocks } from './variables-flyout';
export { COLOR } from './colors';
export { createBlock, rawBlock, xmlToString } from './xml';
export {
  FUNCTION_SIGNATURES,
  METHOD_SIGNATURES,
  MODULE_FUNCTION_SIGNATURES,
  MODULE_FUNCTION_IMPORTS,
  getFunctionBlock,
} from './ast';
export type { FunctionSignature } from './ast';
export type * as ir from './ir/types';

export const PACKAGE_NAME = '@blockpy/blocks';
