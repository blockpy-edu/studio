/**
 * Python code generator — Blockly's stock python generator with the
 * BlockMirror customizations applied (port of legacy `blockly_shims.js`).
 *
 * The customizations, verbatim from legacy:
 *  - `blank` placeholder (`'___'`) emitted for empty inputs,
 *  - `imported_` tracking reset on init,
 *  - `finish()` emits imports but drops variable initializations,
 *  - four-space INDENT and the exact Python-3 keyword reservation list,
 *  - `scrubNakedValue` keeps naked top-level expressions bare (no newline),
 *  - case-SENSITIVE variable naming (Blockly's Names DB lowercases name keys
 *    and compares case-insensitively by default, which would rename `dog`
 *    vs `Dog`; legacy patched both — reimplemented here against the
 *    Blockly 11 `Names` internals: Map-of-Maps db + dbReverse).
 */
import * as Blockly from 'blockly/core';
import { Order, PythonGenerator, pythonGenerator } from 'blockly/python';

export interface LegacyPythonGenerator extends PythonGenerator {
  /** Placeholder rendered for empty inputs (`'___'`). */
  blank: string;
  /** Modules already imported this generation pass. */
  imported_: Record<string, string>;
  // Deprecated Blockly ORDER_ aliases — still present at runtime in v11 and
  // used verbatim by the ported legacy generators.
  ORDER_ATOMIC: number;
  ORDER_COLLECTION: number;
  ORDER_STRING_CONVERSION: number;
  ORDER_MEMBER: number;
  ORDER_FUNCTION_CALL: number;
  ORDER_EXPONENTIATION: number;
  ORDER_UNARY_SIGN: number;
  ORDER_BITWISE_NOT: number;
  ORDER_MULTIPLICATIVE: number;
  ORDER_ADDITIVE: number;
  ORDER_BITWISE_SHIFT: number;
  ORDER_BITWISE_AND: number;
  ORDER_BITWISE_XOR: number;
  ORDER_BITWISE_OR: number;
  ORDER_COMPARISON: number;
  ORDER_LOGICAL_NOT: number;
  ORDER_LOGICAL_AND: number;
  ORDER_LOGICAL_OR: number;
  ORDER_CONDITIONAL: number;
  ORDER_LAMBDA: number;
  ORDER_NONE: number;
  ORDER_RELATIONAL: number;
}

export const generator = pythonGenerator as unknown as LegacyPythonGenerator;
export { Order };

let installed = false;

/**
 * Apply the legacy generator/naming shims. Idempotent; called by the block
 * registry before any block is defined.
 */
export function installGeneratorShims(): void {
  if (installed) return;
  installed = true;

  generator.blank = '___';

  {
    const origInit = generator.init;
    generator.init = function (workspace: Blockly.Workspace) {
      // Keep track of datasets that are already imported
      generator.imported_ = Object.create(null);
      origInit.call(this, workspace);
    };
  }

  generator.finish = function (code: string): string {
    // Convert the definitions dictionary into a list.
    const imports: string[] = [];
    const definitions: string[] = [];
    const defs = (this as unknown as { definitions_: Record<string, string> }).definitions_;
    for (const name in defs) {
      const def = defs[name]!;
      if (def.match(/^(from\s+\S+\s+)?import\s+\S+/)) {
        imports.push(def);
      } else {
        definitions.push(def);
      }
    }
    (this as unknown as { definitions_: object }).definitions_ = Object.create(null);
    (this as unknown as { functionNames_: object }).functionNames_ = Object.create(null);
    generator.imported_ = Object.create(null);
    this.isInitialized = false;

    this.nameDB_!.reset();
    // acbart: Don't actually inject initializations - we don't need 'em.
    const allDefs = imports.join('\n') + '\n\n'; // + definitions.join('\n\n');
    return allDefs.replace(/\n\n+/g, '\n\n').replace(/\n*$/, '\n\n\n') + code;
  };

  generator.INDENT = '    ';

  (generator as unknown as { RESERVED_WORDS_: string }).RESERVED_WORDS_ =
    'False,None,True,and,as,assert,break,class,' +
    'continue,def,elif,del,else,except,finally,for,' +
    'from,global,if,import,in,is,lambda,nonlocal,' +
    'not,or,pass,raise,return,try,while,with,yield';

  /**
   * Naked values are top-level blocks with outputs that aren't plugged into
   * anything.
   */
  generator.scrubNakedValue = function (line: string): string {
    // acbart: Remove extra new line
    return line;
  };

  installCaseSensitiveNames();
}

/**
 * Blockly 11 `Names.getName` keys its per-type map by `name.toLowerCase()`
 * and `Names.equals` compares case-insensitively. Legacy BlockMirror patched
 * both so `dog` and `Dog` stay distinct variables. Same behavior, current
 * internals (db: Map<type, Map<key, safeName>>).
 */
function installCaseSensitiveNames(): void {
  // Standalone shape (not an intersection with Blockly.Names — its private
  // members would reduce the intersection to `never`).
  interface NamesInternals {
    db: Map<string, Map<string, string>>;
    variablePrefix: string;
    getNameForUserVariable(id: string): string | null;
    getDistinctName(name: string, type: Blockly.Names.NameType): string;
  }

  Blockly.Names.prototype.getName = function (
    this: NamesInternals,
    nameOrId: string,
    type: Blockly.Names.NameType | string,
  ): string {
    let name = nameOrId;
    if (type === Blockly.Names.NameType.VARIABLE) {
      const varName = this.getNameForUserVariable(nameOrId);
      if (varName) name = varName;
    }
    const isVarType =
      type === Blockly.Names.NameType.VARIABLE ||
      type === Blockly.Names.NameType.DEVELOPER_VARIABLE;
    const prefix = isVarType ? this.variablePrefix : '';
    if (!this.db.has(type)) this.db.set(type, new Map());
    const typeDb = this.db.get(type)!;
    // Legacy patch: key by the exact name, not name.toLowerCase().
    if (typeDb.has(name)) {
      return prefix + typeDb.get(name)!;
    }
    const safeName = this.getDistinctName(name, type as Blockly.Names.NameType);
    typeDb.set(name, safeName.substring(prefix.length));
    return safeName;
  };

  (Blockly.Names as unknown as { equals(a: string, b: string): boolean }).equals = function (
    name1: string,
    name2: string,
  ): boolean {
    return name1 === name2;
  };
}
