/** Port of legacy `ast/ast_Call.js`. */
// TODO: Support stuff like "append" where the message is after the value input
// TODO: Handle updating function/method definition -> update call
// TODO: Do a pretraversal to determine if a given function returns
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import type { ConverterParent } from '../registry';
import { createBlock } from '../xml';
import type { MutationValue } from '../xml';
import { MODULE_FUNCTION_IMPORTS } from './signatures';
import type { FunctionSignature } from './signatures';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type CallBlock = Blockly.Block & {
  givenColour_: number;
  arguments_: string[];
  argumentVarModels_: Blockly.VariableModel[];
  argumentCount_: number;
  quarkConnections_: Record<string, Blockly.Connection | null>;
  quarkIds_: string[] | null;
  showParameterNames_: boolean;
  returns_: boolean;
  isMethod_: boolean;
  name_: string | null;
  message_: string;
  premessage_: string;
  module_: string;
  updateShape_(): void;
  getProcedureCall(): string | null;
  renameProcedure(oldName: string | null, newName: string): void;
  setProcedureParameters_(paramNames: string[], paramIds: (string | null)[]): boolean;
  setReturn_(returnState: boolean, forceRerender: boolean): void;
  parseArgument_(argument: string): string;
  getDrawnArgumentCount_(): number;
};

defineBlock('ast_Call', {
  /**
   * Block for calling a procedure with no return value.
   * @this Blockly.Block
   */
  init: function (this: CallBlock) {
    this.givenColour_ = COLOR.FUNCTIONS;
    this.setInputsInline(true);
    // Regular ('NAME') or Keyword (either '**' or '*NAME')
    this.arguments_ = [];
    this.argumentVarModels_ = [];
    // acbart: Added count to keep track of unused parameters
    this.argumentCount_ = 0;
    this.quarkConnections_ = {};
    this.quarkIds_ = null;
    // acbart: Show parameter names, if they exist
    this.showParameterNames_ = false;
    // acbart: Whether this block returns
    this.returns_ = true;
    // acbart: added simpleName to handle complex function calls (e.g., chained)
    this.isMethod_ = false;
    this.name_ = null;
    this.message_ = 'function';
    this.premessage_ = '';
    this.module_ = '';
    this.updateShape_();
  },

  /**
   * Returns the name of the procedure this block calls.
   * @return {string} Procedure name.
   * @this Blockly.Block
   */
  getProcedureCall: function (this: CallBlock) {
    return this.name_;
  },
  /**
   * Notification that a procedure is renaming.
   * If the name matches this block's procedure, rename it.
   * Also rename if it was previously null.
   * @param {string} oldName Previous name of procedure.
   * @param {string} newName Renamed procedure.
   * @this Blockly.Block
   */
  renameProcedure: function (this: CallBlock, oldName: string | null, newName: string) {
    if (this.name_ === null || Blockly.Names.equals(oldName!, this.name_)) {
      this.name_ = newName;
      this.updateShape_();
    }
  },
  /**
   * Notification that the procedure's parameters have changed.
   * @param {!Array.<string>} paramNames New param names, e.g. ['x', 'y', 'z'].
   * @param {!Array.<string>} paramIds IDs of params (consistent for each
   *     parameter through the life of a mutator, regardless of param renaming),
   *     e.g. ['piua', 'f8b_', 'oi.o'].
   * @private
   * @this Blockly.Block
   */
  setProcedureParameters_: function (
    this: CallBlock,
    paramNames: string[],
    paramIds: (string | null)[],
  ) {
    // Data structures:
    // this.arguments = ['x', 'y']
    //     Existing param names.
    // this.quarkConnections_ {piua: null, f8b_: Blockly.Connection}
    //     Look-up of paramIds to connections plugged into the call block.
    // this.quarkIds_ = ['piua', 'f8b_']
    //     Existing param IDs.
    // Note that quarkConnections_ may include IDs that no longer exist, but
    // which might reappear if a param is reattached in the mutator.
    const defBlock = Blockly.Procedures.getDefinition(
      this.getProcedureCall() as string,
      this.workspace,
    );
    // `mutator` lives on BlockSvg; a headless definition block simply has
    // neither, matching legacy's truthiness probing. The pre-v11 method name
    // `isVisible()` is preserved verbatim (v11 renamed it `bubbleIsVisible`).
    const mutatorOpen =
      defBlock &&
      (defBlock as Blockly.BlockSvg).mutator &&
      (
        (defBlock as Blockly.BlockSvg).mutator as unknown as {
          isVisible(): boolean;
        }
      ).isVisible();
    if (!mutatorOpen) {
      this.quarkConnections_ = {};
      this.quarkIds_ = null;
    }
    if (!paramIds) {
      // Reset the quarks (a mutator is about to open).
      return false;
    }
    // Test arguments (arrays of strings) for changes. '\n' is not a valid
    // argument name character, so it is a valid delimiter here.
    if (paramNames.join('\n') == this.arguments_.join('\n')) {
      // No change.
      this.quarkIds_ = paramIds as string[];
      return false;
    }
    if (paramIds.length !== paramNames.length) {
      throw RangeError('paramNames and paramIds must be the same length.');
    }
    this.setCollapsed(false);
    if (!this.quarkIds_) {
      // Initialize tracking for this block.
      this.quarkConnections_ = {};
      this.quarkIds_ = [];
    }
    // Switch off rendering while the block is rebuilt. `Block.rendered` is
    // readonly in Blockly 11's typings; legacy toggled it directly.
    const savedRendered = this.rendered;
    (this as { rendered: boolean }).rendered = false;
    // Update the quarkConnections_ with existing connections.
    for (let i = 0; i < this.arguments_.length; i++) {
      const input = this.getInput('ARG' + i);
      if (input) {
        const connection = input.connection!.targetConnection;
        this.quarkConnections_[this.quarkIds_[i] as string] = connection;
        if (mutatorOpen && connection && paramIds.indexOf(this.quarkIds_[i]!) === -1) {
          // This connection should no longer be attached to this block.
          connection.disconnect();
          // Legacy `bumpNeighbours_()`; renamed in modern Blockly.
          connection.getSourceBlock().bumpNeighbours();
        }
      }
    }
    // Rebuild the block's arguments.
    this.arguments_ = ([] as string[]).concat(paramNames);
    this.argumentCount_ = this.arguments_.length;
    // And rebuild the argument model list.
    this.argumentVarModels_ = [];
    /*
    // acbart: Function calls don't create variables, what do they know?
    for (let i = 0; i < this.arguments_.length; i++) {
        let argumentName = this.arguments_[i];
        var variable = Blockly.Variables.getVariable(
            this.workspace, null, this.arguments_[i], '');
        if (variable) {
            this.argumentVarModels_.push(variable);
        }
    }*/

    this.updateShape_();
    this.quarkIds_ = paramIds as string[];
    // Reconnect any child blocks.
    if (this.quarkIds_) {
      for (let i = 0; i < this.arguments_.length; i++) {
        const quarkId: string = this.quarkIds_[i]!;
        if (quarkId in this.quarkConnections_) {
          const connection: Blockly.Connection | null | undefined = this.quarkConnections_[quarkId];
          if (!connection?.reconnect(this, 'ARG' + i)) {
            // Block no longer exists or has been attached elsewhere.
            delete this.quarkConnections_[quarkId];
          }
        }
      }
    }
    // Restore rendering and show the changes.
    (this as { rendered: boolean }).rendered = savedRendered;
    if (this.rendered) {
      // Rendered implies BlockSvg.
      (this as CallBlock & Blockly.BlockSvg).render();
    }
    return true;
  },
  /**
   * Modify this block to have the correct number of arguments.
   * @private
   * @this Blockly.Block
   */
  updateShape_: function (this: CallBlock) {
    // If it's a method, add in the caller
    if (this.isMethod_ && !this.getInput('FUNC')) {
      const func = this.appendValueInput('FUNC');
      // If there's a premessage, add it in
      if (this.premessage_ !== '') {
        func.appendField(this.premessage_);
      }
    } else if (!this.isMethod_ && this.getInput('FUNC')) {
      this.removeInput('FUNC');
    }

    const drawnArgumentCount = this.getDrawnArgumentCount_();
    let message = this.getInput('MESSAGE_AREA');
    // Zero arguments, just do {message()}
    if (drawnArgumentCount === 0) {
      if (message) {
        message.removeField('MESSAGE');
      } else {
        message = this.appendDummyInput('MESSAGE_AREA').setAlign(Blockly.inputs.Align.RIGHT);
      }
      // Legacy source: `this.message_ + "\ ("` (the `\ ` escape is a space).
      message.appendField(new Blockly.FieldLabel(this.message_ + ' ('), 'MESSAGE');
      // One argument, no MESSAGE_AREA
    } else if (message) {
      this.removeInput('MESSAGE_AREA');
    }
    // Process arguments
    let i;
    for (i = 0; i < drawnArgumentCount; i++) {
      const argument = this.arguments_[i]!;
      let argumentName = this.parseArgument_(argument);
      if (i === 0) {
        argumentName = this.message_ + ' (' + argumentName;
      }
      let field = this.getField('ARGNAME' + i);
      if (field) {
        // Ensure argument name is up to date.
        // The argument name field is deterministic based on the mutation,
        // no need to fire a change event.
        Blockly.Events.disable();
        try {
          field.setValue(argumentName);
        } finally {
          Blockly.Events.enable();
        }
      } else {
        // Add new input.
        field = new Blockly.FieldLabel(argumentName);
        const input = this.appendValueInput('ARG' + i)
          .setAlign(Blockly.inputs.Align.RIGHT)
          .appendField(field, 'ARGNAME' + i);
        // Legacy called input.init() unconditionally - it always ran on a
        // rendered workspace. Blockly 11's Input.init() has no headless
        // guard (Field.init touches the SVG root), so skip it headless;
        // rendered workspaces initialize fields during render anyway.
        if (this.workspace.rendered) {
          input.init();
        }
      }
      if (argumentName) {
        field.setVisible(true);
      } else {
        field.setVisible(false);
      }
    }

    // Closing parentheses
    if (!this.getInput('CLOSE_PAREN')) {
      this.appendDummyInput('CLOSE_PAREN')
        .setAlign(Blockly.inputs.Align.RIGHT)
        .appendField(new Blockly.FieldLabel(')'));
    }

    // Move everything into place
    if (drawnArgumentCount === 0) {
      if (this.isMethod_) {
        this.moveInputBefore('FUNC', 'MESSAGE_AREA');
      }
      this.moveInputBefore('MESSAGE_AREA', 'CLOSE_PAREN');
    } else {
      if (this.isMethod_) {
        this.moveInputBefore('FUNC', 'CLOSE_PAREN');
      }
    }
    for (let j = 0; j < i; j++) {
      this.moveInputBefore('ARG' + j, 'CLOSE_PAREN');
    }

    // Set return state
    this.setReturn_(this.returns_, false);
    // Remove deleted inputs.
    while (this.getInput('ARG' + i)) {
      this.removeInput('ARG' + i);
      i++;
    }

    this.setColour(this.givenColour_);
  },
  /**
   * Create XML to represent the (non-editable) name and arguments.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: CallBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    const name = this.getProcedureCall();
    container.setAttribute('name', name === null ? '*' : name);
    container.setAttribute('arguments', String(this.argumentCount_));
    container.setAttribute('returns', String(this.returns_));
    container.setAttribute('parameters', String(this.showParameterNames_));
    container.setAttribute('method', String(this.isMethod_));
    container.setAttribute('message', this.message_);
    container.setAttribute('premessage', this.premessage_);
    container.setAttribute('module', this.module_);
    container.setAttribute('colour', String(this.givenColour_));
    for (let i = 0; i < this.arguments_.length; i++) {
      const parameter = Blockly.utils.xml.createElement('arg');
      parameter.setAttribute('name', this.arguments_[i]!);
      container.appendChild(parameter);
    }
    return container;
  },
  /**
   * Parse XML to restore the (non-editable) name and parameters.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: CallBlock, xmlElement: Element) {
    this.name_ = xmlElement.getAttribute('name');
    this.name_ = this.name_ === '*' ? null : this.name_;
    this.argumentCount_ = parseInt(xmlElement.getAttribute('arguments')!, 10);
    this.showParameterNames_ = 'true' === xmlElement.getAttribute('parameters');
    this.returns_ = 'true' === xmlElement.getAttribute('returns');
    this.isMethod_ = 'true' === xmlElement.getAttribute('method');
    this.message_ = xmlElement.getAttribute('message')!;
    this.premessage_ = xmlElement.getAttribute('premessage')!;
    this.module_ = xmlElement.getAttribute('module')!;
    this.givenColour_ = parseInt(xmlElement.getAttribute('colour')!, 10);

    const args: string[] = [];
    const paramIds: (string | null)[] = [];
    for (let i = 0, childNode; (childNode = xmlElement.childNodes[i] as Element | undefined); i++) {
      if (childNode.nodeName.toLowerCase() === 'arg') {
        args.push(childNode.getAttribute('name')!);
        paramIds.push(childNode.getAttribute('paramId'));
      }
    }
    const result = this.setProcedureParameters_(args, paramIds);
    if (!result) {
      this.updateShape_();
    }
    if (this.name_ !== null) {
      this.renameProcedure(this.getProcedureCall(), this.name_);
    }
  },
  /**
   * Return all variables referenced by this block.
   * @return {!Array.<!Blockly.VariableModel>} List of variable models.
   * @this Blockly.Block
   */
  getVarModels: function (this: CallBlock) {
    return this.argumentVarModels_;
  },
  /**
   * Add menu option to find the definition block for this call.
   * @param {!Array} options List of menu options to add to.
   * @this Blockly.Block
   */
  customContextMenu: function (
    this: CallBlock,
    options: Blockly.ContextMenuRegistry.LegacyContextMenuOption[],
  ) {
    // Context menus only exist on rendered (WorkspaceSvg) workspaces.
    if (!(this.workspace as Blockly.WorkspaceSvg).isMovable()) {
      // If we center on the block and the workspace isn't movable we could
      // loose blocks at the edges of the workspace.
      return;
    }

    const workspace = this.workspace as Blockly.WorkspaceSvg;

    // Highlight Definition - built up field-by-field, exactly as legacy did.
    const option = {
      enabled: true,
    } as Blockly.ContextMenuRegistry.LegacyContextMenuOption;
    option.text = Blockly.Msg['PROCEDURES_HIGHLIGHT_DEF']!;
    const name = this.getProcedureCall();
    option.callback = function () {
      const def = Blockly.Procedures.getDefinition(
        name as string,
        workspace,
      ) as Blockly.BlockSvg | null;
      if (def) {
        workspace.centerOnBlock(def.id);
        def.select();
      }
    };
    options.push(option);

    // Show Parameter Names (arrows capture the block lexically).
    options.push({
      enabled: true,
      text: 'Show/Hide parameters',
      callback: () => {
        this.showParameterNames_ = !this.showParameterNames_;
        this.updateShape_();
        // Context menus only exist rendered (BlockSvg).
        (this as CallBlock & Blockly.BlockSvg).render();
      },
    });

    // Change Return Type
    options.push({
      enabled: true,
      text: this.returns_ ? 'Make statement' : 'Make expression',
      callback: () => {
        this.returns_ = !this.returns_;
        this.setReturn_(this.returns_, true);
      },
    });
  },
  /**
   * Notification that the procedure's return state has changed.
   * @param {boolean} returnState New return state
   * @param forceRerender Whether to render
   * @this Blockly.Block
   */
  setReturn_: function (this: CallBlock, returnState: boolean, forceRerender: boolean) {
    this.unplug(true);
    if (returnState) {
      this.setPreviousStatement(false);
      this.setNextStatement(false);
      this.setOutput(true);
    } else {
      this.setOutput(false);
      this.setPreviousStatement(true);
      this.setNextStatement(true);
    }
    if (forceRerender) {
      if (this.rendered) {
        // Rendered implies BlockSvg.
        (this as CallBlock & Blockly.BlockSvg).render();
      }
    }
  },
  //defType_: 'procedures_defnoreturn',
  parseArgument_: function (this: CallBlock, argument: string) {
    if (argument.startsWith('KWARGS:')) {
      // KWARG
      return 'unpack';
    } else if (argument.startsWith('KEYWORD:')) {
      return argument.substring(8) + '=';
    } else {
      if (this.showParameterNames_) {
        if (argument.startsWith('KNOWN_ARG:')) {
          return argument.substring(10) + '=';
        }
      }
    }
    return '';
  },
  getDrawnArgumentCount_: function (this: CallBlock) {
    return Math.min(this.argumentCount_, this.arguments_.length);
  },
});

generator.forBlock['ast_Call'] = function (block) {
  const typed = block as CallBlock;
  // TODO: Handle import
  if (typed.module_) {
    // `definitions_` is protected on CodeGenerator; legacy wrote it directly.
    (generator as unknown as { definitions_: Record<string, string | undefined> }).definitions_[
      'import_' + typed.module_
    ] = MODULE_FUNCTION_IMPORTS[typed.module_];
  }
  // generator.definitions_['import_matplotlib'] = 'import matplotlib.pyplot as plt';
  // Get the caller
  let funcName = '';
  if (typed.isMethod_) {
    funcName =
      generator.valueToCode(block, 'FUNC', generator.ORDER_FUNCTION_CALL) || generator.blank;
  }
  // Legacy `this.name_` - Blockly invokes forBlock with the block as `this`.
  funcName += typed.name_;
  // Build the arguments
  const args: string[] = [];
  for (let i = 0; i < typed.arguments_.length; i++) {
    const value = generator.valueToCode(block, 'ARG' + i, generator.ORDER_NONE) || generator.blank;
    const argument = typed.arguments_[i]!;
    if (argument.startsWith('KWARGS:')) {
      args[i] = '**' + value;
    } else if (argument.startsWith('KEYWORD:')) {
      args[i] = argument.substring(8) + '=' + value;
    } else {
      args[i] = value;
    }
  }
  // Return the result
  const code = funcName + '(' + args.join(', ') + ')';
  if (typed.returns_) {
    return [code, generator.ORDER_FUNCTION_CALL];
  } else {
    return code + '\n';
  }
};

/**
 * Collapse a `Name`/`Attribute` chain into a dotted module string, or
 * `null`/`undefined` when the chain contains anything else - port of the
 * legacy `BlockMirrorTextToBlocks.prototype.getAsModule` (defined in
 * `ast_Call.js`). The implicit-`undefined` return on an unresolvable
 * Attribute chain is legacy behavior, preserved.
 */
export function getAsModule(node: ir.Expr): string | null | undefined {
  if (node._astname === 'Name') {
    return node.id;
  } else if (node._astname === 'Attribute') {
    const origin = getAsModule(node.value);
    if (origin !== null) {
      return origin + '.' + node.attr;
    }
    return undefined;
  } else {
    return null;
  }
}

//                              messageBefore, message, name
// function call: print() -> "print" ([message]) ; print
// Module function: plt.show() -> "show plot" ([plot]) ; plt.show
// Method call: "test".title() -> "make" [str] "title case" () ; .title ; isMethod = true

registerConverter(
  'Call',
  function (this: TextToBlocksConverter, node: ir.Call, parent: ConverterParent) {
    const func = node.func;
    const args = node.args;
    const keywords = node.keywords;

    // Can we make any guesses about this based on its name?
    let signature: FunctionSignature | null | undefined = null;
    let isMethod = false;
    let module: string | null = null;
    let premessage = '';
    let message = '';
    let name = '';
    let caller: ir.Expr | null = null;
    let colour: number = COLOR.FUNCTIONS;

    if (func._astname === 'Name') {
      message = name = func.id;
      if (name in this.FUNCTION_SIGNATURES) {
        signature = this.FUNCTION_SIGNATURES[func.id];
      }
    } else if (func._astname === 'Attribute') {
      isMethod = true;
      caller = func.value;
      const potentialModule = getAsModule(caller);
      const attributeName = func.attr;
      message = '.' + attributeName;
      if ((potentialModule as string) in this.MODULE_FUNCTION_SIGNATURES) {
        signature = this.MODULE_FUNCTION_SIGNATURES[potentialModule as string]![attributeName];
        module = potentialModule as string;
        message = name = potentialModule + message;
        isMethod = false;
      } else if (attributeName in this.METHOD_SIGNATURES) {
        signature = this.METHOD_SIGNATURES[attributeName];
        name = message;
      } else {
        name = message;
      }
    } else {
      isMethod = true;
      message = '';
      name = '';
      caller = func;
      // (lambda x: x)()
    }
    let returns = true;

    if (signature !== null && signature !== undefined) {
      if (signature.custom) {
        try {
          return signature.custom(node, parent, this);
        } catch (e) {
          console.error(e);
          // We tried to be fancy and failed, better fall back to default behavior!
        }
      }
      if ('returns' in signature) {
        returns = signature.returns!;
      }
      if ('message' in signature) {
        message = signature.message!;
      }
      if ('premessage' in signature) {
        premessage = signature.premessage!;
      }
      if ('colour' in signature) {
        colour = signature.colour!;
      }
    }

    // A Call always sits under a parent node (the root is a Module).
    returns = returns || parent!._astname !== 'Expr';

    const argumentsNormal: Record<string, Element | null> = {};
    // TODO: do I need to be limiting only the *args* length, not keywords?
    const argumentsMutation: Record<string, MutationValue> = {
      '@arguments': (args !== null ? args.length : 0) + (keywords !== null ? keywords.length : 0),
      '@returns': returns,
      '@parameters': true,
      '@method': isMethod,
      '@name': name,
      '@message': message,
      '@premessage': premessage,
      '@colour': colour,
      '@module': module || '',
    };
    // Handle arguments
    let overallI = 0;
    if (args !== null) {
      for (let i = 0; i < args.length; i += 1, overallI += 1) {
        argumentsNormal['ARG' + overallI] = this.convert(args[i]!, node) as Element;
        argumentsMutation['UNKNOWN_ARG:' + overallI] = null;
      }
    }
    if (keywords !== null) {
      for (let i = 0; i < keywords.length; i += 1, overallI += 1) {
        const keyword = keywords[i]!;
        const arg = keyword.arg;
        const value = keyword.value;
        if (arg === null) {
          argumentsNormal['ARG' + overallI] = this.convert(value, node) as Element;
          argumentsMutation['KWARGS:' + overallI] = null;
        } else {
          argumentsNormal['ARG' + overallI] = this.convert(value, node) as Element;
          argumentsMutation['KEYWORD:' + arg] = null;
        }
      }
    }
    // Build actual block
    let newBlock;
    if (isMethod) {
      // Every isMethod branch above assigns `caller`.
      argumentsNormal['FUNC'] = this.convert(caller!, node) as Element;
      newBlock = createBlock(
        'ast_Call',
        node.lineno,
        {},
        argumentsNormal,
        { inline: true },
        argumentsMutation,
      );
    } else {
      newBlock = createBlock(
        'ast_Call',
        node.lineno,
        {},
        argumentsNormal,
        { inline: true },
        argumentsMutation,
      );
    }
    // Return as either statement or expression
    if (returns) {
      return newBlock;
    } else {
      return [newBlock];
    }
  },
);
