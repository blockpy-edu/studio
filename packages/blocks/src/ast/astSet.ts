/** Port of legacy `ast/ast_Set.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type SetBlock = Blockly.BlockSvg & {
  itemCount_: number;
  updateShape_(): void;
};

type SetItemBlock = Blockly.BlockSvg & {
  valueConnection_: Blockly.Connection | null | undefined;
};

defineBlock('ast_Set', {
  /**
   * Block for creating a set with any number of elements of any type.
   * @this Blockly.Block
   */
  init: function (this: SetBlock) {
    this.setColour(COLOR.SET);
    this.itemCount_ = 3;
    this.updateShape_();
    this.setOutput(true, 'Set');
    this.setMutator(new Blockly.icons.MutatorIcon(['ast_Set_create_with_item'], this));
  },
  /**
   * Create XML to represent set inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: SetBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('items', String(this.itemCount_));
    return container;
  },
  /**
   * Parse XML to restore the set inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: SetBlock, xmlElement: Element) {
    this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
    this.updateShape_();
  },
  /**
   * Populate the mutator's dialog with this block's components.
   * @param {!Blockly.Workspace} workspace Mutator's workspace.
   * @return {!Blockly.Block} Root block in mutator.
   * @this Blockly.Block
   */
  decompose: function (this: SetBlock, workspace: Blockly.WorkspaceSvg) {
    const containerBlock = workspace.newBlock('ast_Set_create_with_container');
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK')!.connection;
    for (let i = 0; i < this.itemCount_; i++) {
      const itemBlock = workspace.newBlock('ast_Set_create_with_item');
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
  compose: function (this: SetBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK') as SetItemBlock | null;
    // Count number of inputs.
    const connections: (Blockly.Connection | null | undefined)[] = [];
    while (itemBlock) {
      connections.push(itemBlock.valueConnection_);
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as SetItemBlock | null;
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
  saveConnections: function (this: SetBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK') as SetItemBlock | null;
    let i = 0;
    while (itemBlock) {
      const input = this.getInput('ADD' + i);
      itemBlock.valueConnection_ = input && input.connection!.targetConnection;
      i++;
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as SetItemBlock | null;
    }
  },
  /**
   * Modify this block to have the correct number of inputs.
   * @private
   * @this Blockly.Block
   */
  updateShape_: function (this: SetBlock) {
    if (this.itemCount_ && this.getInput('EMPTY')) {
      this.removeInput('EMPTY');
    } else if (!this.itemCount_ && !this.getInput('EMPTY')) {
      this.appendDummyInput('EMPTY').appendField('create empty set');
    }
    // Add new inputs.
    let i = 0;
    for (; i < this.itemCount_; i++) {
      if (!this.getInput('ADD' + i)) {
        const input = this.appendValueInput('ADD' + i);
        if (i === 0) {
          input.appendField('create set with {').setAlign(Blockly.inputs.Align.RIGHT);
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
      this.appendDummyInput('TAIL').appendField('}').setAlign(Blockly.inputs.Align.RIGHT);
    }
  },
});

defineBlock('ast_Set_create_with_container', {
  /**
   * Mutator block for set container.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.SET);
    this.appendDummyInput().appendField('Add new set elements below');
    this.appendStatementInput('STACK');
    this.contextMenu = false;
  },
});

defineBlock('ast_Set_create_with_item', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.SET);
    this.appendDummyInput().appendField('Element');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

generator.forBlock['ast_Set'] = function (block) {
  // Create a set with any number of elements of any type.
  const typed = block as SetBlock;
  if (typed.itemCount_ === 0) {
    return ['set()', generator.ORDER_FUNCTION_CALL];
  }
  const elements = new Array<string>(typed.itemCount_);
  for (let i = 0; i < typed.itemCount_; i++) {
    elements[i] = generator.valueToCode(block, 'ADD' + i, generator.ORDER_NONE) || generator.blank;
  }
  const code = '{' + elements.join(', ') + '}';
  return [code, generator.ORDER_ATOMIC];
};

registerConverter(
  'Set',
  function (this: TextToBlocksConverter, node: ir.SetExpr, _parent: unknown) {
    const elts = node.elts;

    return createBlock(
      'ast_Set',
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
