/**
 * Port of legacy `ast/ast_Lambda.js`.
 *
 * Legacy shares its mutation/shape methods with `Blockly.Blocks['ast_FunctionDef']`
 * and its converter calls `this.parseArgs` (defined in `ast_FunctionDef.js`).
 * Both are owned by `./astFunctionDef`; `parseArgs` is imported from there
 * (assumed named export matching the legacy prototype method name), and the
 * block methods are read off `Blockly.Blocks['ast_FunctionDef']`, which the
 * side effect of that import guarantees is defined first.
 */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';
import { parseArgs } from './astFunctionDef';

type LambdaBlock = Blockly.Block & {
  decoratorsCount_: number;
  parametersCount_: number;
  hasReturn_: boolean;
  updateShape_(): void;
};

defineBlock('ast_Lambda', {
  init: function (this: LambdaBlock) {
    this.appendDummyInput()
      .appendField('lambda')
      .setAlign(Blockly.inputs.Align.RIGHT);
    this.decoratorsCount_ = 0;
    this.parametersCount_ = 0;
    this.hasReturn_ = false;
    this.appendValueInput('BODY')
      .appendField('body')
      .setAlign(Blockly.inputs.Align.RIGHT)
      .setCheck(null);
    this.setInputsInline(false);
    this.setOutput(true);
    this.setColour(COLOR.FUNCTIONS);
    this.updateShape_();
  },
  mutationToDom: (Blockly.Blocks['ast_FunctionDef'] as any).mutationToDom,
  domToMutation: (Blockly.Blocks['ast_FunctionDef'] as any).domToMutation,
  updateShape_: (Blockly.Blocks['ast_FunctionDef'] as any).updateShape_,
  setReturnAnnotation_: (Blockly.Blocks['ast_FunctionDef'] as any)
    .setReturnAnnotation_,
});

generator.forBlock['ast_Lambda'] = function (block) {
  const typed = block as LambdaBlock;
  // Parameters
  const parameters = new Array<string>(typed.parametersCount_);
  for (let i = 0; i < typed.parametersCount_; i++) {
    parameters[i] =
      generator.valueToCode(block, 'PARAMETER' + i, generator.ORDER_NONE) ||
      generator.blank;
  }
  // Body
  const body =
    generator.valueToCode(block, 'BODY', generator.ORDER_LAMBDA) ||
    generator.PASS;
  return [
    'lambda ' + parameters.join(', ') + ': ' + body,
    generator.ORDER_LAMBDA,
  ];
};

registerConverter(
  'Lambda',
  function (this: TextToBlocksConverter, node: ir.Lambda, _parent: unknown) {
    const args = node.args;
    const body = node.body;

    const values: Record<string, Element | null> = {
      BODY: this.convert(body, node) as Element,
    };

    let parsedArgs = 0;
    if (args !== null) {
      // Legacy called `this.parseArgs(args, values, node.lineno)` — three
      // args, leaving `ast_FunctionDef.js`'s fourth `node` parameter
      // undefined.
      parsedArgs = parseArgs.call(this, args, values, node.lineno);
    }

    return createBlock(
      'ast_Lambda',
      node.lineno,
      {},
      values,
      {
        inline: 'false',
      },
      {
        '@decorators': 0,
        '@parameters': parsedArgs,
        '@returns': false,
      },
    );
  },
);
