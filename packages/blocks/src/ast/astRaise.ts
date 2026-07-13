/** Port of legacy `ast/ast_Raise.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type RaiseBlock = Blockly.Block & {
  exc_: boolean;
  cause_: boolean;
  updateShape_(): void;
};

defineBlock('ast_Raise', {
  init: function (this: RaiseBlock) {
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.EXCEPTIONS);
    this.exc_ = true;
    this.cause_ = false;

    this.appendDummyInput().appendField('raise');
    this.updateShape_();
  },
  updateShape_: function (this: RaiseBlock) {
    if (this.exc_ && !this.getInput('EXC')) {
      this.appendValueInput('EXC').setCheck(null);
    } else if (!this.exc_ && this.getInput('EXC')) {
      this.removeInput('EXC');
    }
    if (this.cause_ && !this.getInput('CAUSE')) {
      this.appendValueInput('CAUSE').setCheck(null).appendField('from');
    } else if (!this.cause_ && this.getInput('CAUSE')) {
      this.removeInput('CAUSE');
    }
    if (this.cause_ && this.exc_) {
      this.moveInputBefore('EXC', 'CAUSE');
    }
  },
  /**
   * Create XML to represent list inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: RaiseBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('exc', String(this.exc_));
    container.setAttribute('cause', String(this.cause_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: RaiseBlock, xmlElement: Element) {
    this.exc_ = 'true' === xmlElement.getAttribute('exc');
    this.cause_ = 'true' === xmlElement.getAttribute('cause');
    this.updateShape_();
  },
});

generator.forBlock['ast_Raise'] = function (block) {
  const typed = block as RaiseBlock;
  // Legacy used `this.exc_`/`this.cause_`; generator functions are invoked
  // with the block as `this`, so these are the same values.
  if (typed.exc_) {
    const exc = generator.valueToCode(block, 'EXC', generator.ORDER_NONE) || generator.blank;
    if (typed.cause_) {
      const cause = generator.valueToCode(block, 'CAUSE', generator.ORDER_NONE) || generator.blank;
      return 'raise ' + exc + ' from ' + cause + '\n';
    } else {
      return 'raise ' + exc + '\n';
    }
  } else {
    return 'raise' + '\n';
  }
};

registerConverter(
  'Raise',
  function (this: TextToBlocksConverter, node: ir.Raise, _parent: unknown) {
    const exc = node.exc;
    const cause = node.cause;
    const values: Record<string, Element | null> = {};
    let hasExc = false,
      hasCause = false;
    if (exc !== null) {
      values['EXC'] = this.convert(exc, node) as Element;
      hasExc = true;
    }
    if (cause !== null) {
      values['CAUSE'] = this.convert(cause, node) as Element;
      hasCause = true;
    }
    return createBlock(
      'ast_Raise',
      node.lineno,
      {},
      values,
      {},
      {
        '@exc': hasExc,
        '@cause': hasCause,
      },
    );
  },
);
