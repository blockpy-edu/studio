/**
 * Port of legacy `ast/ast_Comp.js` — the four comprehension kinds
 * (ListComp, SetComp, GeneratorExp, DictComp) plus their shared
 * `ast_comprehensionFor` / `ast_comprehensionIf` clause blocks and the
 * mutator dialog blocks.
 */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type CompBlock = Blockly.Block & {
  itemCount_: number;
  updateShape_(): void;
};

// Mutator dialog blocks stash the workspace connection they mirror on an
// ad hoc `valueConnection_` property (stock Blockly list-mutator pattern).
type MutatorItemBlock = Blockly.Block & {
  valueConnection_?: Blockly.Connection | null;
};

/** The four comprehension IR kinds this module's shared converter handles. */
type CompNode = ir.ListComp | ir.SetComp | ir.GeneratorExp | ir.DictComp;

defineBlocks({
  type: 'ast_comprehensionFor',
  message0: 'for %1 in %2',
  args0: [
    { type: 'input_value', name: 'TARGET' },
    { type: 'input_value', name: 'ITER' },
  ],
  inputsInline: true,
  output: 'ComprehensionFor',
  colour: COLOR.SEQUENCES,
});

defineBlocks({
  type: 'ast_comprehensionIf',
  message0: 'if %1',
  args0: [{ type: 'input_value', name: 'TEST' }],
  inputsInline: true,
  output: 'ComprehensionIf',
  colour: COLOR.SEQUENCES,
});

defineBlock('ast_Comp_create_with_container', {
  /**
   * Mutator block for dict container.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.SEQUENCES);
    this.appendDummyInput().appendField('Add new comprehensions below');
    this.appendDummyInput().appendField('   For clause');
    this.appendStatementInput('STACK');
    this.contextMenu = false;
  },
});

defineBlock('ast_Comp_create_with_for', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.SEQUENCES);
    this.appendDummyInput().appendField('For clause');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

defineBlock('ast_Comp_create_with_if', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.SEQUENCES);
    this.appendDummyInput().appendField('If clause');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

const COMP_SETTINGS: Record<string, { start: string; end: string; color: number }> = {
  ListComp: { start: '[', end: ']', color: COLOR.LIST },
  SetComp: { start: '{', end: '}', color: COLOR.SET },
  GeneratorExp: {
    start: '(',
    end: ')',
    color: COLOR.SEQUENCES,
  },
  DictComp: {
    start: '{',
    end: '}',
    color: COLOR.DICTIONARY,
  },
};

['ListComp', 'SetComp', 'GeneratorExp', 'DictComp'].forEach(function (kind) {
  defineBlock('ast_' + kind, {
    /**
     * Block for creating a dict with any number of elements of any type.
     * @this Blockly.Block
     */
    init: function (this: CompBlock) {
      this.setStyle('loop_blocks');
      this.setColour(COMP_SETTINGS[kind]!.color);
      this.itemCount_ = 3;
      const input = this.appendValueInput('ELT').appendField(COMP_SETTINGS[kind]!.start);
      if (kind === 'DictComp') {
        input.setCheck('DictPair');
      }
      this.appendDummyInput('END_BRACKET').appendField(COMP_SETTINGS[kind]!.end);
      this.updateShape_();
      this.setOutput(true);
      this.setMutator(
        new Blockly.icons.MutatorIcon(
          ['ast_Comp_create_with_for', 'ast_Comp_create_with_if'],
          // MutatorIcon wants a BlockSvg; blocks are BlockSvg on any rendered
          // workspace (headless test workspaces never open mutators).
          this as CompBlock & Blockly.BlockSvg,
        ),
      );
    },
    /**
     * Create XML to represent dict inputs.
     * @return {!Element} XML storage element.
     * @this Blockly.Block
     */
    mutationToDom: function (this: CompBlock) {
      const container = Blockly.utils.xml.createElement('mutation');
      container.setAttribute('items', String(this.itemCount_));
      return container;
    },
    /**
     * Parse XML to restore the dict inputs.
     * @param {!Element} xmlElement XML storage element.
     * @this Blockly.Block
     */
    domToMutation: function (this: CompBlock, xmlElement: Element) {
      this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
      this.updateShape_();
    },
    /**
     * Populate the mutator's dialog with this block's components.
     * @param {!Blockly.Workspace} workspace Mutator's workspace.
     * @return {!Blockly.Block} Root block in mutator.
     * @this Blockly.Block
     */
    decompose: function (this: CompBlock, workspace: Blockly.WorkspaceSvg) {
      const containerBlock = workspace.newBlock('ast_Comp_create_with_container');
      containerBlock.initSvg();
      let connection: Blockly.Connection | null = containerBlock.getInput('STACK')!.connection;
      const generators: Blockly.BlockSvg[] = [];
      for (let i = 1; i < this.itemCount_; i++) {
        const generatorConnection = this.getInput('GENERATOR' + i)!.connection!;
        let createName;
        if (generatorConnection.targetConnection!.getSourceBlock().type === 'ast_comprehensionIf') {
          createName = 'ast_Comp_create_with_if';
        } else if (
          generatorConnection.targetConnection!.getSourceBlock().type === 'ast_comprehensionFor'
        ) {
          createName = 'ast_Comp_create_with_for';
        } else {
          throw Error(
            'Unknown block type: ' + generatorConnection.targetConnection!.getSourceBlock().type,
          );
        }
        const itemBlock = workspace.newBlock(createName);
        itemBlock.initSvg();
        connection!.connect(itemBlock.previousConnection!);
        connection = itemBlock.nextConnection;
        generators.push(itemBlock);
      }
      return containerBlock;
    },
    /**
     * Reconfigure this block based on the mutator dialog's components.
     * @param {!Blockly.Block} containerBlock Root block in mutator.
     * @this Blockly.Block
     */
    compose: function (this: CompBlock, containerBlock: MutatorItemBlock) {
      let itemBlock = containerBlock.getInputTargetBlock('STACK') as MutatorItemBlock | null;
      // Count number of inputs.
      const connections: (Blockly.Connection | null | undefined)[] = [
        containerBlock.valueConnection_,
      ];
      const blockTypes: string[] = ['ast_Comp_create_with_for'];
      while (itemBlock) {
        connections.push(itemBlock.valueConnection_);
        blockTypes.push(itemBlock.type);
        itemBlock = (itemBlock.nextConnection &&
          itemBlock.nextConnection.targetBlock()) as MutatorItemBlock | null;
      }
      // Disconnect any children that don't belong.
      for (let i = 1; i < this.itemCount_; i++) {
        const connection = this.getInput('GENERATOR' + i)!.connection!.targetConnection;
        if (connection && connections.indexOf(connection) === -1) {
          const connectedBlock = connection.getSourceBlock();
          if (connectedBlock.type === 'ast_comprehensionIf') {
            const testField = connectedBlock.getInput('TEST')!;
            if (testField.connection!.targetConnection) {
              testField.connection!.targetConnection.getSourceBlock().unplug(true);
            }
          } else if (connectedBlock.type === 'ast_comprehensionFor') {
            const iterField = connectedBlock.getInput('ITER')!;
            if (iterField.connection!.targetConnection) {
              iterField.connection!.targetConnection.getSourceBlock().unplug(true);
            }
            const targetField = connectedBlock.getInput('TARGET')!;
            if (targetField.connection!.targetConnection) {
              targetField.connection!.targetConnection.getSourceBlock().unplug(true);
            }
          } else {
            throw Error('Unknown block type: ' + connectedBlock.type);
          }
          connection.disconnect();
          connection.getSourceBlock().dispose();
        }
      }
      this.itemCount_ = connections.length;
      this.updateShape_();
      // Reconnect any child blocks.
      for (let i = 1; i < this.itemCount_; i++) {
        connections[i]?.reconnect(this, 'GENERATOR' + i);
        // TODO: glitch when inserting into middle, deletes children values
        if (!connections[i]) {
          let createName;
          if (blockTypes[i] === 'ast_Comp_create_with_if') {
            createName = 'ast_comprehensionIf';
          } else if (blockTypes[i] === 'ast_Comp_create_with_for') {
            createName = 'ast_comprehensionFor';
          } else {
            throw Error('Unknown block type: ' + blockTypes[i]);
          }
          // Mutator composition only runs on rendered workspaces (BlockSvg).
          const itemBlock = this.workspace.newBlock(createName) as Blockly.BlockSvg;
          itemBlock.setDeletable(false);
          itemBlock.setMovable(false);
          itemBlock.initSvg();
          this.getInput('GENERATOR' + i)!.connection!.connect(itemBlock.outputConnection!);
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
    saveConnections: function (this: CompBlock, containerBlock: MutatorItemBlock) {
      containerBlock.valueConnection_ = this.getInput('GENERATOR0')!.connection!.targetConnection;
      let itemBlock = containerBlock.getInputTargetBlock('STACK') as MutatorItemBlock | null;
      let i = 1;
      while (itemBlock) {
        const input = this.getInput('GENERATOR' + i);
        itemBlock.valueConnection_ = input && input.connection!.targetConnection;
        i++;
        itemBlock = (itemBlock.nextConnection &&
          itemBlock.nextConnection.targetBlock()) as MutatorItemBlock | null;
      }
    },
    /**
     * Modify this block to have the correct number of inputs.
     * @private
     * @this Blockly.Block
     */
    updateShape_: function (this: CompBlock) {
      // Add new inputs.
      let i = 0;
      for (; i < this.itemCount_; i++) {
        if (!this.getInput('GENERATOR' + i)) {
          const input = this.appendValueInput('GENERATOR' + i);
          if (i === 0) {
            input.setCheck('ComprehensionFor');
          } else {
            input.setCheck(['ComprehensionFor', 'ComprehensionIf']);
          }
          this.moveInputBefore('GENERATOR' + i, 'END_BRACKET');
        }
      }
      // Remove deleted inputs.
      while (this.getInput('GENERATOR' + i)) {
        this.removeInput('GENERATOR' + i);
        i++;
      }
    },
  });

  generator.forBlock['ast_' + kind] = function (block) {
    // elt
    let elt;
    if (kind === 'DictComp') {
      const child = block.getInputTargetBlock('ELT');
      if (child === null || child.type !== 'ast_DictItem') {
        elt = generator.blank + ': ' + generator.blank;
      } else {
        const key = generator.valueToCode(child, 'KEY', generator.ORDER_NONE) || generator.blank;
        const value =
          generator.valueToCode(child, 'VALUE', generator.ORDER_NONE) || generator.blank;
        elt = key + ': ' + value;
      }
    } else {
      elt = generator.valueToCode(block, 'ELT', generator.ORDER_NONE) || generator.blank;
    }
    // generators
    const elements = new Array<string>((block as CompBlock).itemCount_);
    const BAD_DEFAULT = elt + ' for ' + generator.blank + ' in' + generator.blank;
    for (let i = 0; i < (block as CompBlock).itemCount_; i++) {
      const child = block.getInputTargetBlock('GENERATOR' + i);
      if (child === null) {
        elements[i] = BAD_DEFAULT;
      } else if (child.type === 'ast_comprehensionIf') {
        const test = generator.valueToCode(child, 'TEST', generator.ORDER_NONE) || generator.blank;
        elements[i] = 'if ' + test;
      } else if (child.type === 'ast_comprehensionFor') {
        const target =
          generator.valueToCode(child, 'TARGET', generator.ORDER_NONE) || generator.blank;
        const iter = generator.valueToCode(child, 'ITER', generator.ORDER_NONE) || generator.blank;
        elements[i] = 'for ' + target + ' in ' + iter;
      } else {
        elements[i] = BAD_DEFAULT;
      }
    }
    // Put it all together
    const code =
      COMP_SETTINGS[kind]!.start + elt + ' ' + elements.join(' ') + COMP_SETTINGS[kind]!.end;
    return [code, generator.ORDER_ATOMIC];
  };

  registerConverter(kind, function (this: TextToBlocksConverter, node: CompNode, _parent: unknown) {
    const generators = node.generators;

    const elements: Record<string, Element | null> = {};
    if (kind === 'DictComp') {
      // `kind` is the block-registration loop variable, so TS cannot
      // narrow `node` by it; the branch guard guarantees the kind.
      const key = (node as ir.DictComp).key;
      const value = (node as ir.DictComp).value;
      elements['ELT'] = createBlock(
        'ast_DictItem',
        node.lineno,
        {},
        {
          KEY: this.convert(key, node) as Element,
          VALUE: this.convert(value, node) as Element,
        },
        {
          inline: 'true',
          deletable: 'false',
          movable: 'false',
        },
      );
    } else {
      const elt = (node as Exclude<CompNode, ir.DictComp>).elt;
      elements['ELT'] = this.convert(elt, node) as Element;
    }
    const DEFAULT_SETTINGS = {
      inline: 'true',
      deletable: 'false',
      movable: 'false',
    };
    let g = 0;
    for (let i = 0; i < generators.length; i++) {
      const target = generators[i]!.target;
      const iter = generators[i]!.iter;
      const ifs = generators[i]!.ifs;
      elements['GENERATOR' + g] = createBlock(
        'ast_comprehensionFor',
        node.lineno,
        {},
        {
          ITER: this.convert(iter, node) as Element,
          TARGET: this.convert(target, node) as Element,
        },
        DEFAULT_SETTINGS,
      );
      g += 1;
      if (ifs) {
        for (let j = 0; j < ifs.length; j++) {
          elements['GENERATOR' + g] = createBlock(
            'ast_comprehensionIf',
            node.lineno,
            {},
            {
              TEST: this.convert(ifs[j]!, node) as Element,
            },
            DEFAULT_SETTINGS,
          );
          g += 1;
        }
      }
    }

    return createBlock(
      'ast_' + kind,
      node.lineno,
      {},
      elements,
      {
        inline: 'false',
      },
      {
        '@items': g,
      },
    );
  });
});
