/** Port of legacy `ast/ast_Assign.js` — reference example for PORTING.md. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type AssignBlock = Blockly.Block & {
  targetCount_: number;
  simpleTarget_: boolean;
  updateShape_(): void;
};

defineBlock('ast_Assign', {
  init: function (this: AssignBlock) {
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.VARIABLES);
    this.targetCount_ = 1;
    this.simpleTarget_ = true;
    this.updateShape_();
    Blockly.Extensions.apply('contextMenu_variableSetterGetter', this, false);
  },
  updateShape_: function (this: AssignBlock) {
    if (!this.getInput('VALUE')) {
      this.appendDummyInput().appendField('set');
      this.appendValueInput('VALUE').appendField('=');
    }
    let i = 0;
    if (this.targetCount_ === 1 && this.simpleTarget_) {
      this.setInputsInline(true);
      if (!this.getInput('VAR_ANCHOR')) {
        this.appendDummyInput('VAR_ANCHOR').appendField(
          new Blockly.FieldVariable('variable'),
          'VAR',
        );
      }
      this.moveInputBefore('VAR_ANCHOR', 'VALUE');
    } else {
      this.setInputsInline(true);
      // Add new inputs.
      for (; i < this.targetCount_; i++) {
        if (!this.getInput('TARGET' + i)) {
          const input = this.appendValueInput('TARGET' + i);
          if (i !== 0) {
            input.appendField('and').setAlign(Blockly.inputs.Align.RIGHT);
          }
        }
        this.moveInputBefore('TARGET' + i, 'VALUE');
      }
      // Kill simple VAR
      if (this.getInput('VAR_ANCHOR')) {
        this.removeInput('VAR_ANCHOR');
      }
    }
    // Remove deleted inputs.
    while (this.getInput('TARGET' + i)) {
      this.removeInput('TARGET' + i);
      i++;
    }
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: AssignBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('targets', String(this.targetCount_));
    container.setAttribute('simple', String(this.simpleTarget_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: AssignBlock, xmlElement: Element) {
    this.targetCount_ = parseInt(xmlElement.getAttribute('targets')!, 10);
    this.simpleTarget_ = 'true' === xmlElement.getAttribute('simple');
    this.updateShape_();
  },
});

generator.forBlock['ast_Assign'] = function (block) {
  const typed = block as AssignBlock;
  // Create a list with any number of elements of any type.
  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) ||
    generator.blank;
  const targets = new Array<string>(typed.targetCount_);
  if (typed.targetCount_ === 1 && typed.simpleTarget_) {
    targets[0] = generator.getVariableName(block.getFieldValue('VAR'));
  } else {
    for (let i = 0; i < typed.targetCount_; i++) {
      targets[i] =
        generator.valueToCode(block, 'TARGET' + i, generator.ORDER_NONE) ||
        generator.blank;
    }
  }
  return targets.join(' = ') + ' = ' + value + '\n';
};

registerConverter(
  'Assign',
  function (this: TextToBlocksConverter, node: ir.Assign, _parent: unknown) {
    const targets = node.targets;
    const value = node.value;

    let values: Record<string, Element | null>;
    const fields: Record<string, string> = {};
    const simpleTarget =
      targets.length === 1 && targets[0]!._astname === 'Name';
    if (simpleTarget) {
      values = {};
      fields['VAR'] = (targets[0] as ir.Name).id;
    } else {
      values = this.convertElements('TARGET', targets, node);
    }
    values['VALUE'] = this.convert(value, node) as Element;

    return createBlock(
      'ast_Assign',
      node.lineno,
      fields,
      values,
      {
        inline: 'true',
      },
      {
        '@targets': targets.length,
        '@simple': simpleTarget,
      },
    );
  },
);
