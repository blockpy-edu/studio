/** Port of legacy `ast/ast_With.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_WithItem',
  output: 'WithItem',
  message0: 'context %1',
  args0: [{ type: 'input_value', name: 'CONTEXT' }],
  enableContextMenu: false,
  colour: COLOR.CONTROL,
  inputsInline: false,
});
generator.forBlock['ast_WithItem'] = function (block) {
  const context =
    generator.valueToCode(block, 'CONTEXT', generator.ORDER_NONE) ||
    generator.blank;
  return [context, generator.ORDER_NONE];
};

defineBlocks({
  type: 'ast_WithItemAs',
  output: 'WithItem',
  message0: 'context %1 as %2',
  args0: [
    { type: 'input_value', name: 'CONTEXT' },
    { type: 'input_value', name: 'AS' },
  ],
  enableContextMenu: false,
  colour: COLOR.CONTROL,
  inputsInline: true,
});
generator.forBlock['ast_WithItemAs'] = function (block) {
  const context =
    generator.valueToCode(block, 'CONTEXT', generator.ORDER_NONE) ||
    generator.blank;
  const as =
    generator.valueToCode(block, 'AS', generator.ORDER_NONE) || generator.blank;
  return [context + ' as ' + as, generator.ORDER_NONE];
};

type WithBlock = Blockly.Block & {
  itemCount_: number;
  renames_: boolean[];
  updateShape_(): void;
};

defineBlock('ast_With', {
  init: function (this: WithBlock) {
    this.appendValueInput('ITEM0').appendField('with');
    this.appendStatementInput('BODY').setCheck(null);
    this.itemCount_ = 1;
    this.renames_ = [false];
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.CONTROL);
    this.updateShape_();
  },
  /**
   * Create XML to represent list inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: WithBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('items', String(this.itemCount_));
    for (let i = 0; i < this.itemCount_; i++) {
      const parameter = Blockly.utils.xml.createElement('as');
      parameter.setAttribute('name', String(this.renames_[i]));
      container.appendChild(parameter);
    }
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: WithBlock, xmlElement: Element) {
    this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
    this.renames_ = [];
    for (let i = 0, childNode: any; (childNode = xmlElement.childNodes[i]); i++) {
      if (childNode.nodeName.toLowerCase() === 'as') {
        this.renames_.push('true' === childNode.getAttribute('name'));
      }
    }
    this.updateShape_();
  },
  updateShape_: function (this: WithBlock) {
    // With clauses
    let i = 1;
    for (; i < this.itemCount_; i++) {
      let input = this.getInput('ITEM' + i);
      if (!input) {
        input = this.appendValueInput('ITEM' + i);
      }
    }
    // Remove deleted inputs.
    while (this.getInput('ITEM' + i)) {
      this.removeInput('ITEM' + i);
      i++;
    }
    // Reposition everything
    for (i = 0; i < this.itemCount_; i++) {
      this.moveInputBefore('ITEM' + i, 'BODY');
    }
  },
});

generator.forBlock['ast_With'] = function (block) {
  const typed = block as WithBlock;
  // Contexts
  const items = new Array<string>(typed.itemCount_);
  for (let i = 0; i < typed.itemCount_; i++) {
    items[i] =
      generator.valueToCode(block, 'ITEM' + i, generator.ORDER_NONE) ||
      generator.blank;
  }
  // Body
  const body = generator.statementToCode(block, 'BODY') || generator.PASS;
  return 'with ' + items.join(', ') + ':\n' + body;
};

registerConverter(
  'With',
  function (this: TextToBlocksConverter, node: ir.With, _parent: unknown) {
    const items = node.items;
    const body = node.body;

    const values: Record<string, Element | null> = {};
    const mutations: Record<string, any> = { '@items': items.length };

    const renamedItems: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const hasRename = items[i]!.optional_vars;
      renamedItems.push(hasRename);
      const innerValues: Record<string, Element | null> = {
        CONTEXT: this.convert(items[i]!.context_expr, node) as Element,
      };
      if (hasRename) {
        innerValues['AS'] = this.convert(
          items[i]!.optional_vars,
          node,
        ) as Element;
        values['ITEM' + i] = createBlock(
          'ast_WithItemAs',
          node.lineno,
          {},
          innerValues,
          this.LOCKED_BLOCK,
        );
      } else {
        values['ITEM' + i] = createBlock(
          'ast_WithItem',
          node.lineno,
          {},
          innerValues,
          this.LOCKED_BLOCK,
        );
      }
    }
    mutations['as'] = renamedItems;

    return createBlock(
      'ast_With',
      node.lineno,
      {},
      values,
      {
        inline: 'false',
      },
      mutations,
      {
        BODY: this.convertBody(body, node),
      },
    );
  },
);
