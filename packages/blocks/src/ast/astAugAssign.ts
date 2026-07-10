/** Port of legacy `ast/ast_AugAssign.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';
// Shared operator tables — legacy hung these on `BlockMirrorTextToBlocks` /
// script-level globals in `ast_BinOp.js` for this file to consume.
import {
  BINOPS_AUGASSIGN_DISPLAY,
  BINOPS_AUGASSIGN_DISPLAY_FULL,
  BINOPS_AUGASSIGN_PREPOSITION,
  BINOPS_BLOCKLY_GENERATE,
  BINOPS_SIMPLE,
} from './astBinOp';

type AugAssignBlock = Blockly.Block & {
  simpleTarget_: boolean;
  allOptions_: boolean;
  initialPreposition_: string;
  updatePreposition_(value: string): void;
  updateShape_(): void;
};

defineBlock('ast_AugAssign', {
  init: function (this: AugAssignBlock) {
    const block = this;
    this.simpleTarget_ = true;
    this.allOptions_ = false;
    this.initialPreposition_ = 'by';
    this.appendDummyInput('OP')
      .appendField(
        new Blockly.FieldDropdown(
          function () {
            return block.allOptions_
              ? BINOPS_AUGASSIGN_DISPLAY_FULL
              : BINOPS_AUGASSIGN_DISPLAY;
          },
          function (this: Blockly.Field, value: string) {
            const block = (this as any).sourceBlock_ as AugAssignBlock;
            block.updatePreposition_(value);
            return undefined;
          } as any,
        ),
        'OP_NAME',
      )
      .appendField(' ');
    this.appendDummyInput('PREPOSITION_ANCHOR')
      .setAlign(Blockly.inputs.Align.RIGHT)
      .appendField('by', 'PREPOSITION');
    this.appendValueInput('VALUE');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.VARIABLES);
    this.updateShape_();
    this.updatePreposition_(this.initialPreposition_);
  },

  updatePreposition_: function (this: AugAssignBlock, value: string) {
    const preposition = BINOPS_AUGASSIGN_PREPOSITION[value];
    this.setFieldValue(preposition as string, 'PREPOSITION');
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: AugAssignBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('simple', String(this.simpleTarget_));
    container.setAttribute('options', String(this.allOptions_));
    container.setAttribute('preposition', this.initialPreposition_);
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: AugAssignBlock, xmlElement: Element) {
    this.simpleTarget_ = 'true' === xmlElement.getAttribute('simple');
    this.allOptions_ = 'true' === xmlElement.getAttribute('options');
    this.initialPreposition_ = xmlElement.getAttribute('preposition')!;
    this.updateShape_();
    this.updatePreposition_(this.initialPreposition_);
  },
  updateShape_: function (this: AugAssignBlock) {
    // Add new inputs.
    (this.getField('OP_NAME') as Blockly.FieldDropdown).getOptions(false);
    if (this.simpleTarget_) {
      if (!this.getInput('VAR_ANCHOR')) {
        this.appendDummyInput('VAR_ANCHOR').appendField(
          new Blockly.FieldVariable('variable'),
          'VAR',
        );
        this.moveInputBefore('VAR_ANCHOR', 'PREPOSITION_ANCHOR');
      }
      if (this.getInput('TARGET')) {
        this.removeInput('TARGET');
      }
    } else {
      if (this.getInput('VAR_ANCHOR')) {
        this.removeInput('VAR_ANCHOR');
      }
      if (!this.getInput('TARGET')) {
        this.appendValueInput('TARGET');
        this.moveInputBefore('TARGET', 'PREPOSITION_ANCHOR');
      }
    }
  },
});

generator.forBlock['ast_AugAssign'] = function (block) {
  const typed = block as AugAssignBlock;
  // Create a list with any number of elements of any type.
  let target: string;
  if (typed.simpleTarget_) {
    target = generator.getVariableName(block.getFieldValue('VAR'));
  } else {
    target =
      generator.valueToCode(block, 'TARGET', generator.ORDER_NONE) ||
      generator.blank;
  }

  const operator = BINOPS_BLOCKLY_GENERATE[block.getFieldValue('OP_NAME')]![0];

  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) ||
    generator.blank;
  return target + operator + '= ' + value + '\n';
};

registerConverter(
  'AugAssign',
  function (this: TextToBlocksConverter, node: ir.AugAssign, _parent: unknown) {
    const target = node.target;
    const op = node.op._astname;
    const value = node.value;

    const values: Record<string, Element | null> = {
      VALUE: this.convert(value, node) as Element,
    };
    const fields: Record<string, string> = { OP_NAME: op };
    const simpleTarget = target._astname === 'Name';
    if (simpleTarget) {
      fields['VAR'] = (target as ir.Name).id;
    } else {
      // Legacy quirk preserved: converts `value` (not `target`) into the
      // TARGET input, exactly as `ast_AugAssign.js` did.
      values['TARGET'] = this.convert(value, node) as Element;
    }

    const preposition = op;

    const allOptions = BINOPS_SIMPLE.indexOf(op) === -1;

    return createBlock(
      'ast_AugAssign',
      node.lineno,
      fields,
      values,
      {
        inline: 'true',
      },
      {
        '@options': allOptions,
        '@simple': simpleTarget,
        '@preposition': preposition,
      },
    );
  },
);
