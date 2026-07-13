/** Port of legacy `ast/ast_List.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type ListBlock = Blockly.BlockSvg & {
  itemCount_: number;
  updateShape_(): void;
};

type ListItemBlock = Blockly.BlockSvg & {
  valueConnection_: Blockly.Connection | null | undefined;
};

defineBlock('ast_List', {
  /**
   * Block for creating a list with any number of elements of any type.
   * @this Blockly.Block
   */
  init: function (this: ListBlock) {
    this.setHelpUrl(Blockly.Msg['LISTS_CREATE_WITH_HELPURL']!);
    this.setColour(COLOR.LIST);
    this.itemCount_ = 3;
    this.updateShape_();
    this.setOutput(true, 'List');
    this.setMutator(new Blockly.icons.MutatorIcon(['ast_List_create_with_item'], this));
  },
  /**
   * Create XML to represent list inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: ListBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('items', String(this.itemCount_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: ListBlock, xmlElement: Element) {
    this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
    this.updateShape_();
  },
  /**
   * Populate the mutator's dialog with this block's components.
   * @param {!Blockly.Workspace} workspace Mutator's workspace.
   * @return {!Blockly.Block} Root block in mutator.
   * @this Blockly.Block
   */
  decompose: function (this: ListBlock, workspace: Blockly.WorkspaceSvg) {
    const containerBlock = workspace.newBlock('ast_List_create_with_container');
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK')!.connection;
    for (let i = 0; i < this.itemCount_; i++) {
      const itemBlock = workspace.newBlock('ast_List_create_with_item');
      itemBlock.initSvg();
      connection!.connect(itemBlock.previousConnection!);
      connection = itemBlock.nextConnection;
    }
    return containerBlock;
  },
  /**
   * Reconfigure this block based on the mutator dialog's components.
   * @param {!Blockly.Block} containerBlock Root block in mutator.
   * @this Blockly.Block
   */
  compose: function (this: ListBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK') as ListItemBlock | null;
    // Count number of inputs.
    const connections: (Blockly.Connection | null | undefined)[] = [];
    while (itemBlock) {
      connections.push(itemBlock.valueConnection_);
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as ListItemBlock | null;
    }
    // Disconnect any children that don't belong.
    for (let i = 0; i < this.itemCount_; i++) {
      const connection = this.getInput('ADD' + i)!.connection!.targetConnection;
      if (connection && connections.indexOf(connection) == -1) {
        connection.disconnect();
      }
    }
    this.itemCount_ = connections.length;
    this.updateShape_();
    // Reconnect any child blocks.
    for (let i = 0; i < this.itemCount_; i++) {
      connections[i]?.reconnect(this, 'ADD' + i);
    }
  },
  /**
   * Store pointers to any connected child blocks.
   * @param {!Blockly.Block} containerBlock Root block in mutator.
   * @this Blockly.Block
   */
  saveConnections: function (this: ListBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK') as ListItemBlock | null;
    let i = 0;
    while (itemBlock) {
      const input = this.getInput('ADD' + i);
      itemBlock.valueConnection_ = input && input.connection!.targetConnection;
      i++;
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as ListItemBlock | null;
    }
  },
  /**
   * Modify this block to have the correct number of inputs.
   * @private
   * @this Blockly.Block
   */
  updateShape_: function (this: ListBlock) {
    if (this.itemCount_ && this.getInput('EMPTY')) {
      this.removeInput('EMPTY');
    } else if (!this.itemCount_ && !this.getInput('EMPTY')) {
      this.appendDummyInput('EMPTY').appendField('create empty list []');
    }
    // Add new inputs.
    let i = 0;
    for (; i < this.itemCount_; i++) {
      if (!this.getInput('ADD' + i)) {
        const input = this.appendValueInput('ADD' + i);
        if (i == 0) {
          input.appendField('create list with [');
        } else {
          input.appendField(',').setAlign(Blockly.inputs.Align.RIGHT);
        }
      }
    }
    // Remove deleted inputs.
    while (this.getInput('ADD' + i)) {
      this.removeInput('ADD' + i);
      i++;
    }
    // Add the trailing "]"
    if (this.getInput('TAIL')) {
      this.removeInput('TAIL');
    }
    if (this.itemCount_) {
      this.appendDummyInput('TAIL').appendField(']').setAlign(Blockly.inputs.Align.RIGHT);
    }
  },
});

defineBlock('ast_List_create_with_container', {
  /**
   * Mutator block for list container.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.LIST);
    this.appendDummyInput().appendField('Add new list elements below');
    this.appendStatementInput('STACK');
    this.contextMenu = false;
  },
});

defineBlock('ast_List_create_with_item', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.LIST);
    this.appendDummyInput().appendField('Element');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

generator.forBlock['ast_List'] = function (block) {
  // Create a list with any number of elements of any type.
  const typed = block as ListBlock;
  const elements = new Array<string>(typed.itemCount_);
  for (let i = 0; i < typed.itemCount_; i++) {
    elements[i] = generator.valueToCode(block, 'ADD' + i, generator.ORDER_NONE) || generator.blank;
  }
  const code = '[' + elements.join(', ') + ']';
  return [code, generator.ORDER_ATOMIC];
};

registerConverter(
  'List',
  function (this: TextToBlocksConverter, node: ir.ListExpr, _parent: unknown) {
    const elts = node.elts;

    return createBlock(
      'ast_List',
      node.lineno,
      {},
      this.convertElements('ADD', elts, node),
      {
        inline: elts.length > 3 ? 'false' : 'true',
      },
      {
        '@items': elts.length,
      },
    );
  },
);
