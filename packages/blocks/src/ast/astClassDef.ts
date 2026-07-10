/** Port of legacy `ast/ast_ClassDef.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type ClassDefBlock = Blockly.Block & {
  decorators_: number;
  bases_: number;
  keywords_: number;
  updateShape_(): void;
};

defineBlock('ast_ClassDef', {
  init: function (this: ClassDefBlock) {
    this.decorators_ = 0;
    this.bases_ = 0;
    this.keywords_ = 0;
    this.appendDummyInput('HEADER')
      .appendField('Class')
      .appendField(new Blockly.FieldVariable('item'), 'NAME');
    this.appendStatementInput('BODY').setCheck(null);
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.OO);
    this.updateShape_();
  },
  // TODO: Not mutable currently
  updateShape_: function (this: ClassDefBlock) {
    for (let i = 0; i < this.decorators_; i++) {
      const input = this.appendValueInput('DECORATOR' + i)
        .setCheck(null)
        .setAlign(Blockly.inputs.Align.RIGHT);
      if (i === 0) {
        input.appendField('decorated by');
      }
      this.moveInputBefore('DECORATOR' + i, 'BODY');
    }
    for (let i = 0; i < this.bases_; i++) {
      const input = this.appendValueInput('BASE' + i)
        .setCheck(null)
        .setAlign(Blockly.inputs.Align.RIGHT);
      if (i === 0) {
        input.appendField('inherits from');
      }
      this.moveInputBefore('BASE' + i, 'BODY');
    }

    for (let i = 0; i < this.keywords_; i++) {
      this.appendValueInput('KEYWORDVALUE' + i)
        .setCheck(null)
        .setAlign(Blockly.inputs.Align.RIGHT)
        .appendField(new Blockly.FieldTextInput('metaclass'), 'KEYWORDNAME' + i)
        .appendField('=');
      this.moveInputBefore('KEYWORDVALUE' + i, 'BODY');
    }
  },
  /**
   * Create XML to represent the (non-editable) name and arguments.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: ClassDefBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('decorators', String(this.decorators_));
    container.setAttribute('bases', String(this.bases_));
    container.setAttribute('keywords', String(this.keywords_));
    return container;
  },
  /**
   * Parse XML to restore the (non-editable) name and parameters.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: ClassDefBlock, xmlElement: Element) {
    this.decorators_ = parseInt(xmlElement.getAttribute('decorators')!, 10);
    this.bases_ = parseInt(xmlElement.getAttribute('bases')!, 10);
    this.keywords_ = parseInt(xmlElement.getAttribute('keywords')!, 10);
    this.updateShape_();
  },
});

generator.forBlock['ast_ClassDef'] = function (block) {
  const typed = block as ClassDefBlock;
  // Name
  const name = generator.getVariableName(block.getFieldValue('NAME'));
  // Decorators
  const decorators = new Array<string>(typed.decorators_);
  for (let i = 0; i < typed.decorators_; i++) {
    const decorator =
      generator.valueToCode(block, 'DECORATOR' + i, generator.ORDER_NONE) ||
      generator.blank;
    decorators[i] = '@' + decorator + '\n';
  }
  // Bases
  const bases = new Array<string>(typed.bases_);
  for (let i = 0; i < typed.bases_; i++) {
    bases[i] =
      generator.valueToCode(block, 'BASE' + i, generator.ORDER_NONE) ||
      generator.blank;
  }
  // Keywords
  const keywords = new Array<string>(typed.keywords_);
  for (let i = 0; i < typed.keywords_; i++) {
    const name = block.getFieldValue('KEYWORDNAME' + i);
    const value =
      generator.valueToCode(block, 'KEYWORDVALUE' + i, generator.ORDER_NONE) ||
      generator.blank;
    if (name == '**') {
      keywords[i] = '**' + value;
    } else {
      keywords[i] = name + '=' + value;
    }
  }
  // Body:
  const body = generator.statementToCode(block, 'BODY') || generator.PASS;
  // Put it together
  let args: string | string[] = bases.concat(keywords);
  args = args.length === 0 ? '' : '(' + args.join(', ') + ')';
  return decorators.join('') + 'class ' + name + args + ':\n' + body;
};

registerConverter(
  'ClassDef',
  function (this: TextToBlocksConverter, node: ir.ClassDef, _parent: unknown) {
    const name = node.name;
    const bases = node.bases;
    const keywords = node.keywords;
    const body = node.body;
    const decorator_list = node.decorator_list;

    const values: Record<string, Element | null> = {};
    const fields: Record<string, string> = { NAME: name };

    if (decorator_list !== null) {
      for (let i = 0; i < decorator_list.length; i++) {
        values['DECORATOR' + i] = this.convert(
          decorator_list[i],
          node,
        ) as Element;
      }
    }

    if (bases !== null) {
      for (let i = 0; i < bases.length; i++) {
        values['BASE' + i] = this.convert(bases[i], node) as Element;
      }
    }

    if (keywords !== null) {
      for (let i = 0; i < keywords.length; i++) {
        values['KEYWORDVALUE' + i] = this.convert(
          keywords[i]!.value,
          node,
        ) as Element;
        const arg = keywords[i]!.arg;
        if (arg === null) {
          fields['KEYWORDNAME' + i] = '**';
        } else {
          fields['KEYWORDNAME' + i] = arg;
        }
      }
    }

    return createBlock(
      'ast_ClassDef',
      node.lineno,
      fields,
      values,
      {
        inline: 'false',
      },
      {
        '@decorators': decorator_list === null ? 0 : decorator_list.length,
        '@bases': bases === null ? 0 : bases.length,
        '@keywords': keywords === null ? 0 : keywords.length,
      },
      {
        BODY: this.convertBody(body, node),
      },
    );
  },
);
