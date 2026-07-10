/** Port of legacy `ast/ast_FunctionDef.js`. */
// TODO: what if a user deletes a parameter through the context menu?
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

// The mutator container
defineBlocks({
  type: 'ast_FunctionHeaderMutator',
  message0: 'Setup parameters below: %1 %2 returns %3',
  args0: [
    { type: 'input_dummy' },
    { type: 'input_statement', name: 'STACK', align: 'RIGHT' },
    { type: 'field_checkbox', name: 'RETURNS', checked: true, align: 'RIGHT' },
  ],
  colour: COLOR.FUNCTIONS,
  enableContextMenu: false,
});

// The elements you can put into the mutator
(
  [
    ['Parameter', 'Parameter', '', false, false],
    ['ParameterType', 'Parameter with type', '', true, false],
    ['ParameterDefault', 'Parameter with default value', '', false, true],
    [
      'ParameterDefaultType',
      'Parameter with type and default value',
      '',
      true,
      true,
    ],
    ['ParameterVararg', 'Variable length parameter', '*', false, false],
    ['ParameterVarargType', 'Variable length parameter with type', '*', true, false],
    ['ParameterKwarg', 'Keyworded Variable length parameter', '**', false],
    [
      'ParameterKwargType',
      'Keyworded Variable length parameter with type',
      '**',
      true,
      false,
    ],
  ] as [string, string, string, boolean, boolean?][]
).forEach(function (parameterTypeTuple) {
  const parameterType = parameterTypeTuple[0],
    parameterDescription = parameterTypeTuple[1],
    parameterPrefix = parameterTypeTuple[2],
    parameterTyped = parameterTypeTuple[3],
    parameterDefault = parameterTypeTuple[4];
  defineBlocks({
    type: 'ast_FunctionMutant' + parameterType,
    message0: parameterDescription,
    previousStatement: null,
    nextStatement: null,
    colour: COLOR.FUNCTIONS,
    enableContextMenu: false,
  });
  const realParameterBlock: any = {
    type: 'ast_Function' + parameterType,
    output: 'Parameter',
    message0: parameterPrefix + (parameterPrefix ? ' ' : '') + '%1',
    args0: [{ type: 'field_variable', name: 'NAME', variable: 'param' }],
    colour: COLOR.FUNCTIONS,
    enableContextMenu: false,
    inputsInline: parameterTyped && parameterDefault,
  };
  if (parameterTyped) {
    realParameterBlock['message0'] += ' : %2';
    realParameterBlock['args0'].push({ type: 'input_value', name: 'TYPE' });
  }
  if (parameterDefault) {
    realParameterBlock['message0'] += ' = %' + (parameterTyped ? 3 : 2);
    realParameterBlock['args0'].push({ type: 'input_value', name: 'DEFAULT' });
  }
  defineBlocks(realParameterBlock);

  generator.forBlock['ast_Function' + parameterType] = function (block) {
    const name = generator.getVariableName(block.getFieldValue('NAME'));
    let typed = '';
    if (parameterTyped) {
      typed =
        ': ' +
        (generator.valueToCode(block, 'TYPE', generator.ORDER_NONE) ||
          generator.blank);
    }
    let defaulted = '';
    if (parameterDefault) {
      defaulted =
        '=' +
        (generator.valueToCode(block, 'DEFAULT', generator.ORDER_NONE) ||
          generator.blank);
    }
    return [parameterPrefix + name + typed + defaulted, generator.ORDER_ATOMIC];
  };
});

// TODO: Figure out an elegant "complexity" flag feature to allow different levels of Mutators

export type FunctionDefBlock = Blockly.Block & {
  decoratorsCount_: number;
  parametersCount_: number;
  hasReturn_: boolean;
  mutatorComplexity_: number;
  returnConnection_?: any;
  updateShape_(): void;
  setReturnAnnotation_(status: boolean): void;
};

defineBlock('ast_FunctionDef', {
  init: function (this: FunctionDefBlock) {
    this.appendDummyInput()
      .appendField('define')
      .appendField(new Blockly.FieldTextInput('function'), 'NAME');
    this.decoratorsCount_ = 0;
    this.parametersCount_ = 0;
    this.hasReturn_ = false;
    this.mutatorComplexity_ = 0;
    this.appendStatementInput('BODY').setCheck(null);
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.FUNCTIONS);
    this.updateShape_();
    (this as any).setMutator(
      new Blockly.icons.MutatorIcon(
        ['ast_FunctionMutantParameter', 'ast_FunctionMutantParameterType'],
        this as any,
      ),
    );
  },
  /**
   * Create XML to represent list inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: FunctionDefBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('decorators', String(this.decoratorsCount_));
    container.setAttribute('parameters', String(this.parametersCount_));
    container.setAttribute('returns', String(this.hasReturn_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: FunctionDefBlock, xmlElement: Element) {
    this.decoratorsCount_ = parseInt(xmlElement.getAttribute('decorators')!, 10);
    this.parametersCount_ = parseInt(xmlElement.getAttribute('parameters')!, 10);
    this.hasReturn_ = 'true' === xmlElement.getAttribute('returns');
    this.updateShape_();
  },
  setReturnAnnotation_: function (this: FunctionDefBlock, status: boolean) {
    const currentReturn = this.getInput('RETURNS');
    if (status) {
      if (!currentReturn) {
        this.appendValueInput('RETURNS')
          .setCheck(null)
          .setAlign(Blockly.inputs.Align.RIGHT)
          .appendField('returns');
      }
      this.moveInputBefore('RETURNS', 'BODY');
    } else if (!status && currentReturn) {
      this.removeInput('RETURNS');
    }
    this.hasReturn_ = status;
  },
  updateShape_: function (this: FunctionDefBlock) {
    // Set up decorators and parameters
    const block = this as any;
    (
      [
        ['DECORATOR', 'decoratorsCount_', null, 'decorated by'],
        ['PARAMETER', 'parametersCount_', 'Parameter', 'parameters:'],
      ] as [string, string, string | null, string][]
    ).forEach(function (childTypeTuple) {
      const childTypeName = childTypeTuple[0],
        countVariable = childTypeTuple[1],
        inputCheck = childTypeTuple[2],
        childTypeMessage = childTypeTuple[3];
      let i = 0;
      for (; i < block[countVariable]; i++) {
        if (!block.getInput(childTypeName + i)) {
          const input = block
            .appendValueInput(childTypeName + i)
            .setCheck(inputCheck)
            .setAlign(Blockly.inputs.Align.RIGHT);
          if (i === 0) {
            input.appendField(childTypeMessage);
          }
        }
        block.moveInputBefore(childTypeName + i, 'BODY');
      }
      // Remove deleted inputs.
      while (block.getInput(childTypeName + i)) {
        block.removeInput(childTypeName + i);
        i++;
      }
    });
    // Set up optional Returns annotation
    this.setReturnAnnotation_(this.hasReturn_);
  },
  /**
   * Populate the mutator's dialog with this block's components.
   * @param {!Blockly.Workspace} workspace Mutator's workspace.
   * @return {!Blockly.Block} Root block in mutator.
   * @this Blockly.Block
   */
  decompose: function (this: any, workspace: any) {
    const containerBlock = workspace.newBlock('ast_FunctionHeaderMutator');
    containerBlock.initSvg();

    // Check/uncheck the allow statement box.
    if (this.getInput('RETURNS')) {
      containerBlock.setFieldValue(this.hasReturn_ ? 'TRUE' : 'FALSE', 'RETURNS');
    } else {
      // TODO: set up "canReturns" for lambda mode
      //containerBlock.getField('RETURNS').setVisible(false);
    }

    // Set up parameters
    let connection = containerBlock.getInput('STACK').connection;
    const parameters = [];
    for (let i = 0; i < this.parametersCount_; i++) {
      const parameter = this.getInput('PARAMETER' + i).connection;
      const sourceType = parameter.targetConnection.getSourceBlock().type;
      const createName =
        'ast_FunctionMutant' + sourceType.substring('ast_Function'.length);
      const itemBlock = workspace.newBlock(createName);
      itemBlock.initSvg();
      connection.connect(itemBlock.previousConnection);
      connection = itemBlock.nextConnection;
      parameters.push(itemBlock);
    }
    return containerBlock;
  },
  /**
   * Reconfigure this block based on the mutator dialog's components.
   * @param {!Blockly.Block} containerBlock Root block in mutator.
   * @this Blockly.Block
   */
  compose: function (this: any, containerBlock: any) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK');
    // Count number of inputs.
    const connections: any[] = [];
    const blockTypes: string[] = [];
    while (itemBlock) {
      connections.push(itemBlock.valueConnection_);
      blockTypes.push(itemBlock.type);
      itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
    }
    // Disconnect any children that don't belong.
    for (let i = 0; i < this.parametersCount_; i++) {
      const connection = this.getInput('PARAMETER' + i).connection.targetConnection;
      if (connection && connections.indexOf(connection) === -1) {
        // Disconnect all children of this block
        const connectedBlock = connection.getSourceBlock();
        for (let j = 0; j < connectedBlock.inputList.length; j++) {
          const field = connectedBlock.inputList[j].connection;
          if (field && field.targetConnection) {
            field.targetConnection.getSourceBlock().unplug(true);
          }
        }
        connection.disconnect();
        connection.getSourceBlock().dispose();
      }
    }
    this.parametersCount_ = connections.length;
    this.updateShape_();
    // Reconnect any child blocks.
    for (let i = 0; i < this.parametersCount_; i++) {
      connections[i]?.reconnect(this, 'PARAMETER' + i);
      if (!connections[i]) {
        const createName =
          'ast_Function' + blockTypes[i]!.substring('ast_FunctionMutant'.length);
        const itemBlock = this.workspace.newBlock(createName);
        itemBlock.setDeletable(false);
        itemBlock.setMovable(false);
        itemBlock.initSvg();
        this.getInput('PARAMETER' + i).connection.connect(
          itemBlock.outputConnection,
        );
        itemBlock.render();
        //this.get(itemBlock, 'ADD'+i)
      }
    }
    // Show/hide the returns annotation
    let hasReturns = containerBlock.getFieldValue('RETURNS');
    if (hasReturns !== null) {
      hasReturns = hasReturns === 'TRUE';
      if (this.hasReturn_ != hasReturns) {
        if (hasReturns) {
          this.setReturnAnnotation_(true);
          this.returnConnection_?.reconnect(this, 'RETURNS');
          this.returnConnection_ = null;
        } else {
          const returnConnection = this.getInput('RETURNS').connection;
          this.returnConnection_ = returnConnection.targetConnection;
          if (this.returnConnection_) {
            const returnBlock = returnConnection.targetBlock();
            returnBlock.unplug();
            returnBlock.bumpNeighbours_();
          }
          this.setReturnAnnotation_(false);
        }
      }
    }
  },
  /**
   * Store pointers to any connected child blocks.
   * @param {!Blockly.Block} containerBlock Root block in mutator.
   * @this Blockly.Block
   */
  saveConnections: function (this: any, containerBlock: any) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK');
    let i = 0;
    while (itemBlock) {
      const input = this.getInput('PARAMETER' + i);
      itemBlock.valueConnection_ = input && input.connection.targetConnection;
      i++;
      itemBlock = itemBlock.nextConnection && itemBlock.nextConnection.targetBlock();
    }
  },
});

generator.forBlock['ast_FunctionDef'] = function (block) {
  const typed = block as FunctionDefBlock;
  // Name
  const name = generator.getVariableName(block.getFieldValue('NAME'));
  // Decorators
  const decorators = new Array<string>(typed.decoratorsCount_);
  for (let i = 0; i < typed.decoratorsCount_; i++) {
    const decorator =
      generator.valueToCode(block, 'DECORATOR' + i, generator.ORDER_NONE) ||
      generator.blank;
    decorators[i] = '@' + decorator + '\n';
  }
  // Parameters
  const parameters = new Array<string>(typed.parametersCount_);
  for (let i = 0; i < typed.parametersCount_; i++) {
    parameters[i] =
      generator.valueToCode(block, 'PARAMETER' + i, generator.ORDER_NONE) ||
      generator.blank;
  }
  // Return annotation
  let returns = '';
  // Legacy used `this.hasReturn_`; generator functions are invoked with the
  // block as `this`, so this is the same value.
  if (typed.hasReturn_) {
    // Legacy quirk preserved: `+` binds tighter than `||`, so the blank
    // fallback on the right never fires.
    returns =
      ' -> ' + generator.valueToCode(block, 'RETURNS', generator.ORDER_NONE) ||
      generator.blank;
  }
  // Body
  const body = generator.statementToCode(block, 'BODY') || generator.PASS;
  return (
    decorators.join('') +
    'def ' +
    name +
    '(' +
    parameters.join(', ') +
    ')' +
    returns +
    ':\n' +
    body
  );
};

/**
 * Legacy `BlockMirrorTextToBlocks.prototype.parseArg` — exported as a
 * standalone helper (call with the converter as `this`); also used by
 * `astLambda`.
 */
export function parseArg(
  this: TextToBlocksConverter,
  arg: ir.Arg,
  type: string,
  lineno: number,
  values: Record<string, Element | null>,
  node: any,
): Element {
  const settings = {
    movable: false,
    deletable: false,
  };
  if (arg.annotation === null) {
    return createBlock(type, lineno, { NAME: arg.arg }, values, settings);
  } else {
    values['TYPE'] = this.convert(arg.annotation, node) as Element;
    return createBlock(
      type + 'Type',
      lineno,
      { NAME: arg.arg },
      values,
      settings,
    );
  }
}

/**
 * Legacy `BlockMirrorTextToBlocks.prototype.parseArgs` — exported as a
 * standalone helper (call with the converter as `this`); also used by
 * `astLambda`, which passes no `node` (matching legacy).
 */
export function parseArgs(
  this: TextToBlocksConverter,
  args: ir.Arguments,
  values: Record<string, Element | null>,
  lineno: number,
  node?: any,
): number {
  const positional = args.args,
    vararg = args.vararg,
    kwonlyargs = args.kwonlyargs,
    kwarg = args.kwarg,
    defaults = args.defaults,
    kw_defaults = args.kw_defaults;
  let totalArgs = 0;
  // args (positional)
  if (positional !== null) {
    // "If there are fewer defaults, they correspond to the last n arguments."
    const defaultOffset = defaults ? defaults.length - positional.length : 0;
    for (let i = 0; i < positional.length; i++) {
      const childValues: Record<string, Element | null> = {};
      let type = 'ast_FunctionParameter';
      if (defaults[defaultOffset + i]) {
        childValues['DEFAULT'] = this.convert(
          defaults[defaultOffset + i],
          node,
        ) as Element;
        type += 'Default';
      }
      values['PARAMETER' + totalArgs] = parseArg.call(
        this,
        positional[i]!,
        type,
        lineno,
        childValues,
        node,
      );
      totalArgs += 1;
    }
  }
  // *arg
  if (vararg !== null) {
    values['PARAMETER' + totalArgs] = parseArg.call(
      this,
      vararg,
      'ast_FunctionParameterVararg',
      lineno,
      {},
      node,
    );
    totalArgs += 1;
  }
  // keyword arguments that must be referenced by name
  if (kwonlyargs !== null) {
    for (let i = 0; i < kwonlyargs.length; i++) {
      const childValues: Record<string, Element | null> = {};
      let type = 'ast_FunctionParameter';
      if (kw_defaults[i]) {
        childValues['DEFAULT'] = this.convert(kw_defaults[i], node) as Element;
        type += 'Default';
      }
      values['PARAMETER' + totalArgs] = parseArg.call(
        this,
        kwonlyargs[i]!,
        type,
        lineno,
        childValues,
        node,
      );
      totalArgs += 1;
    }
  }
  // **kwarg
  if (kwarg) {
    values['PARAMETER' + totalArgs] = parseArg.call(
      this,
      kwarg,
      'ast_FunctionParameterKwarg',
      lineno,
      {},
      node,
    );
    totalArgs += 1;
  }

  return totalArgs;
}

registerConverter(
  'FunctionDef',
  function (
    this: TextToBlocksConverter,
    node: ir.FunctionDef,
    _parent: unknown,
  ) {
    const name = node.name;
    const args = node.args;
    const body = node.body;
    const decorator_list = node.decorator_list;
    const returns = node.returns;

    const values: Record<string, Element | null> = {};

    if (decorator_list !== null) {
      for (let i = 0; i < decorator_list.length; i++) {
        values['DECORATOR' + i] = this.convert(
          decorator_list[i],
          node,
        ) as Element;
      }
    }

    let parsedArgs = 0;
    if (args !== null) {
      parsedArgs = parseArgs.call(this, args, values, node.lineno, node);
    }

    // Legacy compared against `Sk.builtin.none.none$`; the IR uses `null`.
    const hasReturn =
      returns !== null &&
      (returns._astname !== 'NameConstant' || returns.value !== null);
    if (hasReturn) {
      values['RETURNS'] = this.convert(returns, node) as Element;
    }

    return createBlock(
      'ast_FunctionDef',
      node.lineno,
      {
        NAME: name,
      },
      values,
      {
        inline: 'false',
      },
      {
        '@decorators': decorator_list === null ? 0 : decorator_list.length,
        '@parameters': parsedArgs,
        '@returns': hasReturn,
      },
      {
        BODY: this.convertBody(body, node),
      },
    );
  },
);
