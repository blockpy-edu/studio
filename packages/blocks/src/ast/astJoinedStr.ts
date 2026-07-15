/** Port of legacy `ast/ast_JoinedStr.js` (f-strings). */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_FormattedValue',
  message0: '%1',
  args0: [{ type: 'input_value', name: 'VALUE' }],
  output: 'FormattedValueStr',
  inputsInline: false,
  colour: COLOR.TEXT,
});

defineBlocks({
  type: 'ast_JoinedStrStr',
  message0: '%1',
  args0: [{ type: 'field_input', name: 'TEXT', value: '' }],
  output: 'FormattedValueStr',
  inputsInline: false,
  colour: COLOR.TEXT,
});

defineBlocks({
  type: 'ast_FormattedValueFull',
  tooltip: '',
  helpUrl: '',
  message0: '%1 : %2 ! %3 %4',
  args0: [
    {
      type: 'input_value',
      name: 'VALUE',
    },
    {
      type: 'field_input',
      name: 'FORMAT_SPEC',
      text: '',
    },
    {
      type: 'field_dropdown',
      name: 'CONVERSION',
      options: [
        ['plain', '-1'],
        ['repr', 'r'],
        ['str', 's'],
        ['ascii', 'a'],
      ],
    },
    {
      type: 'input_dummy',
      name: 'NAME',
    },
  ],
  output: 'FormattedValueStr',
  colour: COLOR.TEXT,
});

type JoinedStrBlock = Blockly.BlockSvg & {
  itemCount_: number;
  updateShape_(): void;
};

type JoinedStrItemBlock = Blockly.BlockSvg & {
  valueConnection_: Blockly.Connection | null | undefined;
};

defineBlock('ast_JoinedStr', {
  /**
   * Block for JoinedStr and FormattedValue
   */
  init: function (this: JoinedStrBlock) {
    this.setColour(COLOR.TEXT);
    this.itemCount_ = 3;
    this.updateShape_();
    this.setInputsInline(true);
    this.setOutput(true, 'String');
    this.setMutator(
      new Blockly.icons.MutatorIcon(
        [
          'ast_JoinedStr_create_with_item_S',
          'ast_JoinedStr_create_with_item_FV',
          'ast_JoinedStr_create_with_item_FVF',
        ],
        this,
      ),
    );
  },

  /**
   * Create XML to represent dict inputs.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: JoinedStrBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('items', String(this.itemCount_));
    return container;
  },

  /**
   * Parse XML to restore the dict inputs.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: JoinedStrBlock, xmlElement: Element) {
    this.itemCount_ = parseInt(xmlElement.getAttribute('items')!, 10);
    this.updateShape_();
  },

  /**
   * Populate the mutator's dialog with this block's components.
   * @param {!Blockly.Workspace} workspace Mutator's workspace.
   * @return {!Blockly.Block} Root block in mutator.
   * @this Blockly.Block
   */
  decompose: function (this: JoinedStrBlock, workspace: Blockly.WorkspaceSvg) {
    const containerBlock = workspace.newBlock('ast_JoinedStr_create_with_container');
    containerBlock.initSvg();
    let connection = containerBlock.getInput('STACK')!.connection;
    for (let i = 0; i < this.itemCount_; i++) {
      const piece = this.getInput('ADD' + i)!.connection!;
      const pieceType = piece.targetConnection!.getSourceBlock().type;
      // console.log(piece, pieceType);
      const createName =
        pieceType === 'ast_JoinedStrStr'
          ? 'ast_JoinedStr_create_with_item_S'
          : pieceType === 'ast_FormattedValueFull'
            ? 'ast_JoinedStr_create_with_item_FVF'
            : 'ast_JoinedStr_create_with_item_FV';
      const itemBlock = workspace.newBlock(createName);
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
  compose: function (this: JoinedStrBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK') as JoinedStrItemBlock | null;
    // Count number of inputs.
    const connections: (Blockly.Connection | null | undefined)[] = [];
    const blockTypes: string[] = [];
    while (itemBlock) {
      connections.push(itemBlock.valueConnection_);
      blockTypes.push(itemBlock.type);
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as JoinedStrItemBlock | null;
    }
    // Disconnect any children that don't belong.
    for (let i = 0; i < this.itemCount_; i++) {
      const connection = this.getInput('ADD' + i)!.connection!.targetConnection;
      if (connection && connections.indexOf(connection) == -1) {
        const value = connection.getSourceBlock().getInput('VALUE');
        if (value && value.connection!.targetConnection) {
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
        const createName =
          blockTypes[i] === 'ast_JoinedStr_create_with_item_S'
            ? 'ast_JoinedStrStr'
            : blockTypes[i] === 'ast_JoinedStr_create_with_item_FVF'
              ? 'ast_FormattedValueFull'
              : 'ast_FormattedValue';
        const itemBlock = this.workspace.newBlock(createName);
        itemBlock.setDeletable(false);
        itemBlock.setMovable(false);
        itemBlock.initSvg();
        this.getInput('ADD' + i)!.connection!.connect(itemBlock.outputConnection!);
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
  saveConnections: function (this: JoinedStrBlock, containerBlock: Blockly.Block) {
    let itemBlock = containerBlock.getInputTargetBlock('STACK') as JoinedStrItemBlock | null;
    let i = 0;
    while (itemBlock) {
      const input = this.getInput('ADD' + i);
      itemBlock.valueConnection_ = input && input.connection!.targetConnection;
      i++;
      itemBlock = (itemBlock.nextConnection &&
        itemBlock.nextConnection.targetBlock()) as JoinedStrItemBlock | null;
    }
  },

  /**
   * Modify this block to have the correct number of inputs.
   * @private
   * @this Blockly.Block
   */
  updateShape_: function (this: JoinedStrBlock) {
    if (this.itemCount_ && this.getInput('EMPTY')) {
      this.removeInput('EMPTY');
    } else if (!this.itemCount_ && !this.getInput('EMPTY')) {
      this.appendDummyInput('EMPTY').appendField('empty string');
    }
    // Add new inputs.
    let i = 0;
    for (; i < this.itemCount_; i++) {
      if (!this.getInput('ADD' + i)) {
        const input = this.appendValueInput('ADD' + i).setCheck('FormattedValueStr');
        if (i === 0) {
          input.appendField('Join:').setAlign(Blockly.inputs.Align.RIGHT);
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

defineBlock('ast_JoinedStr_create_with_container', {
  /**
   * Mutator block for JoinedStr container.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.TEXT);
    this.appendDummyInput().appendField('Add new values and strings below');
    this.appendStatementInput('STACK');
    this.contextMenu = false;
  },
});

defineBlock('ast_JoinedStr_create_with_item_S', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.TEXT);
    this.appendDummyInput().appendField('Text');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

defineBlock('ast_JoinedStr_create_with_item_FV', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.VARIABLES);
    this.appendDummyInput().appendField('Expression');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

defineBlock('ast_JoinedStr_create_with_item_FVF', {
  /**
   * Mutator block for adding items.
   * @this Blockly.Block
   */
  init: function (this: Blockly.Block) {
    this.setColour(COLOR.VARIABLES);
    this.appendDummyInput().appendField('Formatted Expression');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.contextMenu = false;
  },
});

generator.forBlock['ast_JoinedStr'] = function (block) {
  // Create a dict with any number of elements of any type.
  const typed = block as JoinedStrBlock;
  const elements = new Array<string>(typed.itemCount_);
  const strings: string[] = [];
  const indices: number[] = [];
  for (let i = 0; i < typed.itemCount_; i++) {
    const child = block.getInputTargetBlock('ADD' + i);
    if (
      child === null ||
      (child.type != 'ast_JoinedStrStr' &&
        child.type != 'ast_FormattedValue' &&
        child.type != 'ast_FormattedValueFull')
    ) {
      elements[i] = generator.blank;
      continue;
    }
    if (child.type === 'ast_JoinedStrStr') {
      const value = child.getFieldValue('TEXT') || generator.blank;
      elements[i] = value;
      indices.push(i);
      strings.push(value);
    } else if (child.type === 'ast_FormattedValue') {
      const value = generator.valueToCode(child, 'VALUE', generator.ORDER_NONE) || generator.blank;
      elements[i] = `{${value}}`;
    } else if (child.type === 'ast_FormattedValueFull') {
      const value = generator.valueToCode(child, 'VALUE', generator.ORDER_NONE) || generator.blank;
      let formatSpec = child.getFieldValue('FORMAT_SPEC');
      formatSpec = formatSpec ? `:${formatSpec}` : '';
      const conversion = child.getFieldValue('CONVERSION');
      elements[i] = `{${value}${formatSpec}${conversion === '-1' ? '' : `!${conversion}`}}`;
    }
  }

  let code;
  if (strings.some((s) => s.includes('\n'))) {
    indices.forEach((i) => {
      elements[i] = elements[i]!.replace(/'''/g, "\\'\\'\\'");
    });
    code = "f'''" + elements.join('') + "'''";
  } else {
    let quote = '"';
    if (strings.some((s) => s.includes("'"))) {
      if (!strings.some((s) => s.includes('"'))) {
        quote = "'";
      } else {
        indices.forEach((i) => {
          elements[i] = elements[i]!.replace(/"/g, '\\"');
        });
      }
    }
    code = 'f' + quote + elements.join('') + quote;
  }
  return [code, generator.ORDER_ATOMIC];
};

registerConverter(
  'JoinedStr',
  function (this: TextToBlocksConverter, node: ir.JoinedStr, _parent: unknown) {
    const values = node.values;
    const elements: Record<string, Element | null> = {};
    values.forEach((v, i) => {
      if (v._astname === 'FormattedValue') {
        // console.log(v);
        // Legacy Skulpt delivered `conversion` as the raw character
        // ('s'/'r'/'a') or undefined; the IR delivers the CPython ord
        // (115/114/97) or -1. Map it back to the legacy character form so the
        // plain-ness check and the CONVERSION dropdown behave identically.
        const conversion = formattedValueConversion(v.conversion);
        if (!conversion && !v.format_spec) {
          elements['ADD' + i] = createBlock(
            'ast_FormattedValue',
            v.lineno,
            {},
            {
              VALUE: this.convert(v.value, node) as Element,
            },
            this.LOCKED_BLOCK,
          );
        } else {
          // Legacy read the Skulpt string internals (`.s.v`); the IR `.s` is
          // already the plain JS string.
          const format_spec = v.format_spec
            ? chompExclamation((v.format_spec.values[0] as ir.Str).s)
            : '';
          // Can there ever be a non-1 length format_spec?
          elements['ADD' + i] = createBlock(
            'ast_FormattedValueFull',
            v.lineno,
            {
              FORMAT_SPEC: format_spec,
              // '' (no conversion) is not a dropdown option, so the field
              // keeps its default 'plain' value - same net effect as legacy
              // passing Skulpt's undefined here.
              CONVERSION: conversion,
            },
            {
              VALUE: this.convert(v.value, node) as Element,
            },
            this.LOCKED_BLOCK,
          );
        }
      } else if (v._astname === 'Str') {
        const text = v.s; // legacy: Sk.ffi.remapToJs(v.s)
        elements['ADD' + i] = createBlock(
          'ast_JoinedStrStr',
          v.lineno,
          {
            TEXT: text,
          },
          {},
          this.LOCKED_BLOCK,
        );
      }
    });
    return createBlock(
      'ast_JoinedStr',
      node.lineno,
      {},
      elements,
      { inline: values.length > 3 ? 'false' : 'true' },
      {
        '@items': values.length,
      },
    );
  },
);

function chompExclamation(text: string): string {
  // Remove any text starting with an exclamation mark in the text
  return text.replace(/!.*$/, '');
}

function formattedValueConversion(conversion: number): string {
  switch (conversion) {
    case -1:
      return '';
    case 115:
      return 's';
    case 114:
      return 'r';
    case 97:
      return 'a';
    default:
      return '';
  }
}
