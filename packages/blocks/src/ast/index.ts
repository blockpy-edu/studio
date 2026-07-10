/**
 * Block-module barrel — importing this registers every block definition,
 * generator, and IR→XML converter (the legacy bundle's load-everything
 * equivalent). Modules self-register via side effects.
 */
import './core';

// Literals & data structures
import './astNum';
import './astStr';
import './astNameConstant';
import './astList';
import './astTuple';
import './astSet';
import './astDict';
import './astStarred';
import './astJoinedStr';

// Operators & expressions
import './astBinOp';
import './astBoolOp';
import './astCompare';
import './astUnaryOp';
import './astIfExp';
import './astLambda';
import './astComp';
import './astName';

// Statements
import './astAssign';
import './astAugAssign';
import './astAnnAssign';
import './astExpr';
import './astAssert';
import './astDelete';
import './astGlobal';
import './astNonlocal';
import './astBreak';
import './astContinue';
import './astReturn';
import './astYield';
import './astYieldFrom';
import './astAttribute';
import './astSubscript';

// Control flow & definitions
import './astIf';
import './astWhile';
import './astFor';
import './astTry';
import './astWith';
import './astRaise';
import './astClassDef';
import './astFunctionDef';

// Calls & imports
import './astCall';
import './astImport';

// Fallbacks & comments
import './astRaw';
import './astComment';

export {
  FUNCTION_SIGNATURES,
  METHOD_SIGNATURES,
  MODULE_FUNCTION_SIGNATURES,
  MODULE_FUNCTION_IMPORTS,
  getFunctionBlock,
} from './signatures';
export type { FunctionSignature } from './signatures';
