/** Port of legacy `ast/ast_While.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type WhileBlock = Blockly.Block & {
  orelse_: boolean | number;
  updateShape_(): void;
};

defineBlock('ast_While', {
  init: function (this: WhileBlock) {
    this.orelse_ = 0;
    this.appendValueInput('TEST').appendField('while');
    this.appendStatementInput('BODY')
      .setCheck(null)
      .setAlign(Blockly.inputs.Align.RIGHT);
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.CONTROL);
    this.updateShape_();
  },
  // TODO: Not mutable currently
  updateShape_: function (this: WhileBlock) {
    if (this.orelse_ && !this.getInput('ELSE')) {
      this.appendDummyInput('ORELSETEST').appendField('else:');
      this.appendStatementInput('ORELSEBODY').setCheck(null);
    } else if (!this.orelse_ && this.getInput('ELSE')) {
      // Legacy quirk preserved: this branch referenced an undefined global
      // `block`; it is unreachable because no input is ever named 'ELSE'.
      this.removeInput('ORELSETEST');
      this.removeInput('ORELSEBODY');
    }
  },
  /**
   * Create XML to represent the (non-editable) name and arguments.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: WhileBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('orelse', String(this.orelse_));
    return container;
  },
  /**
   * Parse XML to restore the (non-editable) name and parameters.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: WhileBlock, xmlElement: Element) {
    this.orelse_ = 'true' === xmlElement.getAttribute('orelse');
    this.updateShape_();
  },
});

generator.forBlock['ast_While'] = function (block) {
  const typed = block as WhileBlock;
  // Test
  const test =
    'while ' +
    (generator.valueToCode(block, 'TEST', generator.ORDER_NONE) ||
      generator.blank) +
    ':\n';
  // Body:
  const body = generator.statementToCode(block, 'BODY') || generator.PASS;
  // Orelse:
  let orelse = '';
  // Legacy used `this.orelse_`; generator functions are invoked with the
  // block as `this`, so this is the same value.
  if (typed.orelse_) {
    orelse =
      'else:\n' +
      (generator.statementToCode(block, 'ORELSEBODY') || generator.PASS);
  }
  return test + body + orelse;
};

registerConverter(
  'While',
  function (this: TextToBlocksConverter, node: ir.While, _parent: unknown) {
    const test = node.test;
    const body = node.body;
    const orelse = node.orelse;

    const values: Record<string, Element | null> = {
      TEST: this.convert(test, node) as Element,
    };
    const statements: Record<string, Element[] | null> = {
      BODY: this.convertBody(body, node),
    };

    let hasOrelse = false;
    if (orelse !== null && orelse.length > 0) {
      statements['ORELSEBODY'] = this.convertBody(orelse, node);
      hasOrelse = true;
    }

    return createBlock(
      'ast_While',
      node.lineno,
      {},
      values,
      {},
      {
        '@orelse': hasOrelse,
      },
      statements,
    );
  },
);
