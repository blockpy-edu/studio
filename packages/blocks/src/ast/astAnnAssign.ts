/** Port of legacy `ast/ast_AnnAssign.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock, type MutationValue } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type AnnAssignFullBlock = Blockly.Block & {
  initialized_: boolean;
  updateShape_(): void;
};

defineBlock('ast_AnnAssignFull', {
  init: function (this: AnnAssignFullBlock) {
    this.appendValueInput('TARGET').setCheck(null).appendField('set');
    this.appendValueInput('ANNOTATION').setCheck(null).appendField(':');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.VARIABLES);
    this.initialized_ = true;
    this.updateShape_();
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: AnnAssignFullBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('initialized', String(this.initialized_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: AnnAssignFullBlock, xmlElement: Element) {
    this.initialized_ = 'true' === xmlElement.getAttribute('initialized');
    this.updateShape_();
  },
  updateShape_: function (this: AnnAssignFullBlock) {
    // Add new inputs.
    if (this.initialized_ && !this.getInput('VALUE')) {
      this.appendValueInput('VALUE')
        .appendField('=')
        .setAlign(Blockly.inputs.Align.RIGHT);
    }
    if (!this.initialized_ && this.getInput('VALUE')) {
      this.removeInput('VALUE');
    }
  },
});

export const ANNOTATION_OPTIONS: [string, string][] = [
  ['int', 'int'],
  ['float', 'float'],
  ['str', 'str'],
  ['bool', 'bool'],
  ['None', 'None'],
];

export const ANNOTATION_GENERATE: Record<string, string> = {};
ANNOTATION_OPTIONS.forEach(function (ann) {
  ANNOTATION_GENERATE[ann[1]] = ann[0];
});

type AnnAssignBlock = Blockly.Block & {
  strAnnotations_: boolean;
  initialized_: boolean;
  updateShape_(): void;
};

defineBlock('ast_AnnAssign', {
  init: function (this: AnnAssignBlock) {
    this.appendDummyInput()
      .appendField('set')
      .appendField(new Blockly.FieldVariable('item'), 'TARGET')
      .appendField(':')
      .appendField(new Blockly.FieldDropdown(ANNOTATION_OPTIONS), 'ANNOTATION');
    this.appendValueInput('VALUE').setCheck(null).appendField('=');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.VARIABLES);
    this.strAnnotations_ = false;
    this.initialized_ = true;
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: AnnAssignBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('str', String(this.strAnnotations_));
    container.setAttribute('initialized', String(this.initialized_));
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: AnnAssignBlock, xmlElement: Element) {
    this.strAnnotations_ = 'true' === xmlElement.getAttribute('str');
    this.initialized_ = 'true' === xmlElement.getAttribute('initialized');
    this.updateShape_();
  },
  updateShape_: function (this: AnnAssignBlock) {
    // Add new inputs.
    if (this.initialized_ && !this.getInput('VALUE')) {
      this.appendValueInput('VALUE')
        .appendField('=')
        .setAlign(Blockly.inputs.Align.RIGHT);
    }
    if (!this.initialized_ && this.getInput('VALUE')) {
      this.removeInput('VALUE');
    }
  },
});

generator.forBlock['ast_AnnAssignFull'] = function (block) {
  const typed = block as AnnAssignFullBlock;
  // Create a list with any number of elements of any type.
  const target =
    generator.valueToCode(block, 'TARGET', generator.ORDER_NONE) ||
    generator.blank;
  const annotation =
    generator.valueToCode(block, 'ANNOTATION', generator.ORDER_NONE) ||
    generator.blank;
  let value = '';
  if (typed.initialized_) {
    // Legacy precedence quirk preserved: `' = ' + code || blank` groups as
    // `(' = ' + code) || blank`, so the blank fallback never fires.
    value =
      ' = ' + generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) ||
      generator.blank;
  }
  return target + ': ' + annotation + value + '\n';
};

generator.forBlock['ast_AnnAssign'] = function (block) {
  const typed = block as AnnAssignBlock;
  // Create a list with any number of elements of any type.
  const target = generator.getVariableName(block.getFieldValue('TARGET'));
  let annotation = block.getFieldValue('ANNOTATION');
  if (typed.strAnnotations_) {
    annotation = (generator as any).quote_(annotation);
  }
  let value = '';
  if (typed.initialized_) {
    // Legacy precedence quirk preserved (see ast_AnnAssignFull above).
    value =
      ' = ' + generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) ||
      generator.blank;
  }
  return target + ': ' + annotation + value + '\n';
};

function getBuiltinAnnotation(
  this: TextToBlocksConverter,
  annotation: ir.Expr,
): string | false {
  let result: string | false = false;
  // Can we turn it into a basic type?
  if (annotation._astname === 'Name') {
    result = annotation.id;
  } else if (annotation._astname === 'Str') {
    result = annotation.s;
  }

  // Potentially filter out unknown annotations
  if (result !== false && this.strictAnnotations) {
    if (this.strictAnnotations.indexOf(result) !== -1) {
      return result;
    } else {
      return false;
    }
  } else {
    return result;
  }
}

registerConverter(
  'AnnAssign',
  function (this: TextToBlocksConverter, node: ir.AnnAssign, _parent: unknown) {
    const target = node.target;
    const annotation = node.annotation;
    const value = node.value;

    const values: Record<string, Element | null> = {};
    const mutations: Record<string, MutationValue> = { '@initialized': false };
    if (value !== null) {
      values['VALUE'] = this.convert(value, node) as Element;
      mutations['@initialized'] = true;
    }

    // TODO: This controls whether the annotation is stored in __annotations__
    // (legacy read `node.simple` here but never used it).

    const builtinAnnotation = getBuiltinAnnotation.call(this, annotation);

    if (
      target._astname === 'Name' &&
      target.id !== generator.blank &&
      builtinAnnotation !== false
    ) {
      mutations['@str'] = annotation._astname === 'Str';
      return createBlock(
        'ast_AnnAssign',
        node.lineno,
        {
          TARGET: target.id,
          ANNOTATION: builtinAnnotation,
        },
        values,
        {
          inline: 'true',
        },
        mutations,
      );
    } else {
      values['TARGET'] = this.convert(target, node) as Element;
      values['ANNOTATION'] = this.convert(annotation, node) as Element;
      return createBlock(
        'ast_AnnAssignFull',
        node.lineno,
        {},
        values,
        {
          inline: 'true',
        },
        mutations,
      );
    }
  },
);
