/** Port of legacy `ast/ast_Dict.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type DictBlock = Blockly.BlockSvg & {
  itemCount_: number;
  updateShape_(): void;
};

type DictItemBlock = Blockly.BlockSvg & {
  valueConnection_: Blockly.Connection | null | undefined;
};

defineBlock('ast_DictItem', {
  init: function (this: Blockly.Block) {
    this.appendValueInput('KEY').setCheck(null);
    this.appendValueInput('VALUE').setCheck(null).appendField(':');
    this.setInputsInline(true);
    this.setOutput(true, 'DictPair');
    this.setColour(COLOR.DICTIONARY);
  },
});

defineBlock('ast_Dict', {
  /**
   * Block for creating a dict with any number of elements of any type.
   * @this Blockly.Block
   */
  init: function (this: DictBlock) {
    this.setColour(COLOR.DICTIONARY);
    this.itemCount_ = 3;
    this.updateShape_();
    this.setOutput(true, 'Dict');
    this.setMutator(
      new Blockly.icons.MutatorIcon(['ast_Dict_create_with_item'], this),
    );
  },
  /**
   * Create XML to represent dict inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: DictBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('items', String(this.itemCount_));
    return container;
  },
  /**
   * Parse XML to restore the dict inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: DictBlock, xmlElement: Element) {
    this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
    this.updateShape_();
  },
  /**
   * Populate the mutator's dialog with this block's components.
   * @param {!Blockly.Workspace} workspace Mutator's workspace.
   * @return {!Blockly.Block} Root block in mutator.
   * @this Blockly.Block
   */
  decompose: function (this: DictBlock, workspace: Blockly.WorkspaceSvg) {
    const containerBlock = workspace.newBlock('ast_Dict_create_with_container');
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK')!.connection;
    for (let i = 0; i < this.itemCount_; i++) {
      const itemBlock = workspace.newBlock('ast_Dict_create_with_item');
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
  compose: function (this: DictBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock(
      'STACK',
    ) as DictItemBlock | null;
    // Count number of inputs.
    const connections: (Blockly.Connection | null | undefined)[] = [];
    while (itemBlock) {
      connections.push(itemBlock.valueConnection_);
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as DictItemBlock | null;
    }
    // Disconnect any children that don't belong.
    for (let i = 0; i < this.itemCount_; i++) {
      const connection = this.getInput('ADD' + i)!.connection!.targetConnection;
      if (connection && connections.indexOf(connection) == -1) {
        const key = connection.getSourceBlock().getInput('KEY')!;
        if (key.connection!.targetConnection) {
          key.connection!.targetConnection.getSourceBlock().unplug(true);
        }
        const value = connection.getSourceBlock().getInput('VALUE')!;
        if (value.connection!.targetConnection) {
          value.connection!.targetConnection.getSourceBlock().unplug(true);
        }
        connection.disconnect();
        connection.getSourceBlock().dispose();
      }
    }
    this.itemCount_ = connections.length;
    this.updateShape_();
    // Reconnect any child blocks.
    for (let i = 0; i < this.itemCount_; i++) {
      connections[i]?.reconnect(this, 'ADD' + i);
      if (!connections[i]) {
        const itemBlock = this.workspace.newBlock('ast_DictItem');
        itemBlock.setDeletable(false);
        itemBlock.setMovable(false);
        itemBlock.initSvg();
        this.getInput('ADD' + i)!.connection!.connect(
          itemBlock.outputConnection!,
        );
        itemBlock.render();
        //this.get(itemBlock, 'ADD'+i)
      }
    }
  },
  /**
   * Store pointers to any connected child blocks.
   * @param {!Blockly.Block} containerBlock Root block in mutator.
   * @this Blockly.Block
   */
  saveConnections: function (this: DictBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock(
      'STACK',
    ) as DictItemBlock | null;
    let i = 0;
    while (itemBlock) {
      const input = this.getInput('ADD' + i);
      itemBlock.valueConnection_ = input && input.connection!.targetConnection;
      i++;
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as DictItemBlock | null;
    }
  },
  /**
   * Modify this block to have the correct number of inputs.
   * @private
   * @this Blockly.Block
   */
  updateShape_: function (this: DictBlock) {
    if (this.itemCount_ && this.getInput('EMPTY')) {
      this.removeInput('EMPTY');
    } else if (!this.itemCount_ && !this.getInput('EMPTY')) {
      this.appendDummyInput('EMPTY').appendField('empty dictionary');
    }
    // Add new inputs.
    let i = 0;
    for (; i < this.itemCount_; i++) {
      if (!this.getInput('ADD' + i)) {
        const input = this.appendValueInput('ADD' + i).setCheck('DictPair');
        if (i === 0) {
          input
            .appendField('create dict with')
            .setAlign(Blockly.inputs.Align.RIGHT);
        }
      }
    }
    // Remove deleted inputs.
    while (this.getInput('ADD' + i)) {
      this.removeInput('ADD' + i);
      i++;
    }
    // Add the trailing "}"
    /*
        if (this.getInput('TAIL')) {
            this.removeInput('TAIL');
        }
        if (this.itemCount_) {
            let tail = this.appendDummyInput('TAIL')
                .appendField('}');
            tail.setAlign(Blockly.inputs.Align.RIGHT);
        }*/
  },
});

defineBlock('ast_Dict_create_with_container', {
  /**
   * Mutator block for dict container.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.DICTIONARY);
    this.appendDummyInput().appendField('Add new dict elements below');
    this.appendStatementInput('STACK');
    this.contextMenu = false;
  },
});

defineBlock('ast_Dict_create_with_item', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.DICTIONARY);
    this.appendDummyInput().appendField('Element');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

generator.forBlock['ast_Dict'] = function (block) {
  // Create a dict with any number of elements of any type.
  const typed = block as DictBlock;
  const elements = new Array<string>(typed.itemCount_);
  for (let i = 0; i < typed.itemCount_; i++) {
    const child = block.getInputTargetBlock('ADD' + i);
    if (child === null || child.type != 'ast_DictItem') {
      elements[i] = generator.blank + ': ' + generator.blank;
      continue;
    }
    const key =
      generator.valueToCode(child, 'KEY', generator.ORDER_NONE) ||
      generator.blank;
    const value =
      generator.valueToCode(child, 'VALUE', generator.ORDER_NONE) ||
      generator.blank;
    elements[i] = key + ': ' + value;
  }
  const code = '{' + elements.join(', ') + '}';
  return [code, generator.ORDER_ATOMIC];
};

registerConverter(
  'Dict',
  function (this: TextToBlocksConverter, node: ir.Dict, _parent: unknown) {
    // Legacy guarded against a null `keys` array (a Skulpt possibility);
    // the IR always delivers an array, but the guard is kept verbatim.
    const keys = node.keys as ir.Dict['keys'] | null;
    const values = node.values;

    if (keys === null) {
      return createBlock(
        'ast_Dict',
        node.lineno,
        {},
        {},
        { inline: 'false' },
        { '@items': 0 },
      );
    }

    const elements: Record<string, Element | null> = {};
    for (let i = 0; i < keys.length; i++) {
      // NOTE: a `null` key entry (a `**expansion`) was not handled by legacy
      // either — `this.convert(null, ...)` throws, and the statement falls
      // back to a raw block.
      const key = keys[i]!;
      const value = values[i]!;
      elements['ADD' + i] = createBlock(
        'ast_DictItem',
        node.lineno,
        {},
        {
          KEY: this.convert(key, node) as Element,
          VALUE: this.convert(value, node) as Element,
        },
        this.LOCKED_BLOCK,
      );
    }

    return createBlock(
      'ast_Dict',
      node.lineno,
      {},
      elements,
      {
        inline: 'false',
      },
      {
        '@items': keys.length,
      },
    );
  },
);
