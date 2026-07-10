/** Port of legacy `ast/ast_Tuple.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type TupleBlock = Blockly.BlockSvg & {
  itemCount_: number;
  updateShape_(): void;
};

type TupleItemBlock = Blockly.BlockSvg & {
  valueConnection_: Blockly.Connection | null | undefined;
};

defineBlock('ast_Tuple', {
  /**
   * Block for creating a tuple with any number of elements of any type.
   * @this Blockly.Block
   */
  init: function (this: TupleBlock) {
    this.setColour(COLOR.TUPLE);
    this.itemCount_ = 3;
    this.updateShape_();
    this.setOutput(true, 'Tuple');
    this.setMutator(
      new Blockly.icons.MutatorIcon(['ast_Tuple_create_with_item'], this),
    );
  },
  /**
   * Create XML to represent tuple inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: TupleBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('items', String(this.itemCount_));
    return container;
  },
  /**
   * Parse XML to restore the tuple inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: TupleBlock, xmlElement: Element) {
    this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
    this.updateShape_();
  },
  /**
   * Populate the mutator's dialog with this block's components.
   * @param {!Blockly.Workspace} workspace Mutator's workspace.
   * @return {!Blockly.Block} Root block in mutator.
   * @this Blockly.Block
   */
  decompose: function (this: TupleBlock, workspace: Blockly.WorkspaceSvg) {
    const containerBlock = workspace.newBlock(
      'ast_Tuple_create_with_container',
    );
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK')!.connection;
    for (let i = 0; i < this.itemCount_; i++) {
      const itemBlock = workspace.newBlock('ast_Tuple_create_with_item');
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
  compose: function (this: TupleBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock(
      'STACK',
    ) as TupleItemBlock | null;
    // Count number of inputs.
    const connections: (Blockly.Connection | null | undefined)[] = [];
    while (itemBlock) {
      connections.push(itemBlock.valueConnection_);
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as TupleItemBlock | null;
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
  saveConnections: function (this: TupleBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock(
      'STACK',
    ) as TupleItemBlock | null;
    let i = 0;
    while (itemBlock) {
      const input = this.getInput('ADD' + i);
      itemBlock.valueConnection_ = input && input.connection!.targetConnection;
      i++;
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as TupleItemBlock | null;
    }
  },
  /**
   * Modify this block to have the correct number of inputs.
   * @private
   * @this Blockly.Block
   */
  updateShape_: function (this: TupleBlock) {
    if (this.itemCount_ && this.getInput('EMPTY')) {
      this.removeInput('EMPTY');
    } else if (!this.itemCount_ && !this.getInput('EMPTY')) {
      this.appendDummyInput('EMPTY').appendField('()');
    }
    // Add new inputs.
    let i = 0;
    for (; i < this.itemCount_; i++) {
      if (!this.getInput('ADD' + i)) {
        const input = this.appendValueInput('ADD' + i);
        if (i === 0) {
          input.appendField('(').setAlign(Blockly.inputs.Align.RIGHT);
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
      const tail = this.appendDummyInput('TAIL');
      if (this.itemCount_ === 1) {
        tail.appendField(',)');
      } else {
        tail.appendField(')');
      }
      tail.setAlign(Blockly.inputs.Align.RIGHT);
    }
  },
});

defineBlock('ast_Tuple_create_with_container', {
  /**
   * Mutator block for tuple container.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.TUPLE);
    this.appendDummyInput().appendField('Add new tuple elements below');
    this.appendStatementInput('STACK');
    this.contextMenu = false;
  },
});

defineBlock('ast_Tuple_create_with_item', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.TUPLE);
    this.appendDummyInput().appendField('Element');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

generator.forBlock['ast_Tuple'] = function (block) {
  // Create a tuple with any number of elements of any type.
  const typed = block as TupleBlock;
  const elements = new Array<string>(typed.itemCount_);
  for (let i = 0; i < typed.itemCount_; i++) {
    elements[i] =
      generator.valueToCode(block, 'ADD' + i, generator.ORDER_NONE) ||
      generator.blank;
  }
  let requiredComma = '';
  if (typed.itemCount_ == 1) {
    requiredComma = ', ';
  }
  const code = '(' + elements.join(', ') + requiredComma + ')';
  return [code, generator.ORDER_ATOMIC];
};

registerConverter(
  'Tuple',
  function (this: TextToBlocksConverter, node: ir.Tuple, _parent: unknown) {
    const elts = node.elts;

    return createBlock(
      'ast_Tuple',
      node.lineno,
      {},
      this.convertElements('ADD', elts, node),
      {
        inline: elts.length > 4 ? 'false' : 'true',
      },
      {
        '@items': elts.length,
      },
    );
  },
);
