/** Port of legacy `ast/ast_If.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type IfBlock = Blockly.Block & {
  orelse_: boolean | number;
  elifs_: number;
  updateShape_(): void;
};

defineBlock('ast_If', {
  init: function (this: IfBlock) {
    this.orelse_ = 0;
    this.elifs_ = 0;
    this.appendValueInput('TEST').appendField('if');
    this.appendStatementInput('BODY')
      .setCheck(null)
      .setAlign(Blockly.inputs.Align.RIGHT);
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.LOGIC);
    this.updateShape_();
  },
  // TODO: Not mutable currently
  updateShape_: function (this: IfBlock) {
    let i = 0;
    for (; i < this.elifs_; i++) {
      if (!this.getInput('ELIF' + i)) {
        this.appendValueInput('ELIFTEST' + i).appendField('elif');
        this.appendStatementInput('ELIFBODY' + i).setCheck(null);
      }
    }
    // Remove deleted inputs.
    while (this.getInput('ELIFTEST' + i)) {
      this.removeInput('ELIFTEST' + i);
      this.removeInput('ELIFBODY' + i);
      i++;
    }

    if (this.orelse_ && !this.getInput('ELSE')) {
      this.appendDummyInput('ORELSETEST').appendField('else:');
      this.appendStatementInput('ORELSEBODY').setCheck(null);
    } else if (!this.orelse_ && this.getInput('ELSE')) {
      // Legacy quirk preserved: this branch referenced an undefined global
      // `block`; it is unreachable because no input is ever named 'ELSE'.
      this.removeInput('ORELSETEST');
      this.removeInput('ORELSEBODY');
    }

    for (i = 0; i < this.elifs_; i++) {
      if (this.orelse_) {
        this.moveInputBefore('ELIFTEST' + i, 'ORELSETEST');
        this.moveInputBefore('ELIFBODY' + i, 'ORELSETEST');
      } else if (i + 1 < this.elifs_) {
        this.moveInputBefore('ELIFTEST' + i, 'ELIFTEST' + (i + 1));
        this.moveInputBefore('ELIFBODY' + i, 'ELIFBODY' + (i + 1));
      }
    }
  },
  /**
   * Create XML to represent the (non-editable) name and arguments.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: IfBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('orelse', String(this.orelse_));
    container.setAttribute('elifs', String(this.elifs_));
    return container;
  },
  /**
   * Parse XML to restore the (non-editable) name and parameters.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: IfBlock, xmlElement: Element) {
    this.orelse_ = 'true' === xmlElement.getAttribute('orelse');
    this.elifs_ = parseInt(xmlElement.getAttribute('elifs')!, 10) || 0;
    this.updateShape_();
  },
});

generator.forBlock['ast_If'] = function (block) {
  const typed = block as IfBlock;
  // Test
  const test =
    'if ' +
    (generator.valueToCode(block, 'TEST', generator.ORDER_NONE) ||
      generator.blank) +
    ':\n';
  // Body:
  const body = generator.statementToCode(block, 'BODY') || generator.PASS;
  // Elifs
  const elifs = new Array<string>(typed.elifs_);
  for (let i = 0; i < typed.elifs_; i++) {
    let clause =
      'elif ' +
      (generator.valueToCode(block, 'ELIFTEST' + i, generator.ORDER_NONE) ||
        generator.blank);
    clause +=
      ':\n' +
      (generator.statementToCode(block, 'ELIFBODY' + i) || generator.PASS);
    elifs[i] = clause;
  }
  // Orelse:
  let orelse = '';
  // Legacy used `this.orelse_`; generator functions are invoked with the
  // block as `this`, so this is the same value.
  if (typed.orelse_) {
    orelse =
      'else:\n' +
      (generator.statementToCode(block, 'ORELSEBODY') || generator.PASS);
  }
  return test + body + elifs.join('') + orelse;
};

registerConverter(
  'If',
  function (this: TextToBlocksConverter, node: ir.If, _parent: unknown) {
    const test = node.test;
    const body = node.body;
    let orelse: any = node.orelse;

    let hasOrelse = false;
    let elifCount = 0;

    const values: Record<string, Element | null> = {
      TEST: this.convert(test, node) as Element,
    };
    const statements: Record<string, Element[] | null> = {
      BODY: this.convertBody(body, node),
    };

    while (orelse !== undefined && orelse.length > 0) {
      if (orelse.length === 1) {
        if (orelse[0]._astname === 'If') {
          // This is an ELIF
          this.heights.shift();
          values['ELIFTEST' + elifCount] = this.convert(
            orelse[0].test,
            node,
          ) as Element;
          statements['ELIFBODY' + elifCount] = this.convertBody(
            orelse[0].body,
            node,
          );
          elifCount++;
        } else {
          hasOrelse = true;
          statements['ORELSEBODY'] = this.convertBody(orelse, node);
        }
      } else {
        hasOrelse = true;
        statements['ORELSEBODY'] = this.convertBody(orelse, node);
      }
      orelse = orelse[0].orelse;
    }

    return createBlock(
      'ast_If',
      node.lineno,
      {},
      values,
      {},
      {
        '@orelse': hasOrelse,
        '@elifs': elifCount,
      },
      statements,
    );
  },
);
