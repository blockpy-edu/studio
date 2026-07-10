/** Port of legacy `ast/ast_Subscript.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type SubscriptBlock = Blockly.Block & {
  sliceKinds_: string[];
  setExistence(
    label: string,
    exist: boolean,
    isDummy: boolean,
  ): Blockly.Input | null;
  createSlice_(i: number, kind: string): void;
  updateShape_(): void;
};

defineBlock('ast_Subscript', {
  init: function (this: SubscriptBlock) {
    this.setInputsInline(true);
    this.setOutput(true);
    this.setColour(COLOR.SEQUENCES);
    this.sliceKinds_ = ['I'];

    this.appendValueInput('VALUE').setCheck(null);
    this.appendDummyInput('OPEN_BRACKET').appendField('[');
    this.appendDummyInput('CLOSE_BRACKET').appendField(']');
    this.updateShape_();
  },
  setExistence: function (
    this: SubscriptBlock,
    label: string,
    exist: boolean,
    isDummy: boolean,
  ) {
    if (exist && !this.getInput(label)) {
      if (isDummy) {
        return this.appendDummyInput(label);
      } else {
        return this.appendValueInput(label);
      }
    } else if (!exist && this.getInput(label)) {
      this.removeInput(label);
    }
    return null;
  },
  createSlice_: function (this: SubscriptBlock, i: number, kind: string) {
    // ,
    let input = this.setExistence('COMMA' + i, i !== 0, true);
    if (input) {
      input.appendField(',');
    }
    // Single index
    const isIndex = kind.charAt(0) === 'I';
    input = this.setExistence('INDEX' + i, isIndex, false);
    // First index
    input = this.setExistence(
      'SLICELOWER' + i,
      !isIndex && '1' === kind.charAt(1),
      false,
    );
    // First colon
    input = this.setExistence('SLICECOLON' + i, !isIndex, true);
    if (input) {
      input.appendField(':').setAlign(Blockly.inputs.Align.RIGHT);
    }
    // Second index
    input = this.setExistence(
      'SLICEUPPER' + i,
      !isIndex && '1' === kind.charAt(2),
      false,
    );
    // Second colon and third index
    input = this.setExistence(
      'SLICESTEP' + i,
      !isIndex && '1' === kind.charAt(3),
      false,
    );
    if (input) {
      input.appendField(':').setAlign(Blockly.inputs.Align.RIGHT);
    }
  },
  updateShape_: function (this: SubscriptBlock) {
    // Add new inputs.
    let i = 0;
    for (; i < this.sliceKinds_.length; i++) {
      this.createSlice_(i, this.sliceKinds_[i]!);
    }

    for (let j = 0; j < i; j++) {
      if (j !== 0) {
        this.moveInputBefore('COMMA' + j, 'CLOSE_BRACKET');
      }
      const kind = this.sliceKinds_[j]!;
      if (kind.charAt(0) === 'I') {
        this.moveInputBefore('INDEX' + j, 'CLOSE_BRACKET');
      } else {
        if (kind.charAt(1) === '1') {
          this.moveInputBefore('SLICELOWER' + j, 'CLOSE_BRACKET');
        }
        this.moveInputBefore('SLICECOLON' + j, 'CLOSE_BRACKET');
        if (kind.charAt(2) === '1') {
          this.moveInputBefore('SLICEUPPER' + j, 'CLOSE_BRACKET');
        }
        if (kind.charAt(3) === '1') {
          this.moveInputBefore('SLICESTEP' + j, 'CLOSE_BRACKET');
        }
      }
    }

    // Remove deleted inputs.
    // (Legacy quirk preserved: checks 'TARGET' + i and un-indexed
    // 'SLICECOLON', exactly as `ast_Subscript.js` did.)
    while (this.getInput('TARGET' + i) || this.getInput('SLICECOLON')) {
      this.removeInput('COMMA' + i, true);
      if (this.getInput('INDEX' + i)) {
        this.removeInput('INDEX' + i);
      } else {
        this.removeInput('SLICELOWER' + i, true);
        this.removeInput('SLICECOLON' + i, true);
        this.removeInput('SLICEUPPER' + i, true);
        this.removeInput('SLICESTEP' + i, true);
      }
      i++;
    }
  },
  /**
   * Create XML to represent list inputs.
   */
  mutationToDom: function (this: SubscriptBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    for (let i = 0; i < this.sliceKinds_.length; i++) {
      const parameter = Blockly.utils.xml.createElement('arg');
      parameter.setAttribute('name', this.sliceKinds_[i]!);
      container.appendChild(parameter);
    }
    return container;
  },
  /**
   * Parse XML to restore the list inputs.
   */
  domToMutation: function (this: SubscriptBlock, xmlElement: Element) {
    this.sliceKinds_ = [];
    for (let i = 0, childNode; (childNode = xmlElement.childNodes[i]); i++) {
      if (childNode.nodeName.toLowerCase() === 'arg') {
        this.sliceKinds_.push((childNode as Element).getAttribute('name')!);
      }
    }
    this.updateShape_();
  },
});

generator.forBlock['ast_Subscript'] = function (block) {
  const typed = block as SubscriptBlock;
  // Create a list with any number of elements of any type.
  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_MEMBER) ||
    generator.blank;
  const slices = new Array<string>(typed.sliceKinds_.length);
  for (let i = 0; i < typed.sliceKinds_.length; i++) {
    const kind = typed.sliceKinds_[i]!;
    if (kind.charAt(0) === 'I') {
      slices[i] =
        generator.valueToCode(block, 'INDEX' + i, generator.ORDER_MEMBER) ||
        generator.blank;
    } else {
      slices[i] = '';
      if (kind.charAt(1) === '1') {
        slices[i] +=
          generator.valueToCode(
            block,
            'SLICELOWER' + i,
            generator.ORDER_MEMBER,
          ) || generator.blank;
      }
      slices[i] += ':';
      if (kind.charAt(2) === '1') {
        slices[i] +=
          generator.valueToCode(
            block,
            'SLICEUPPER' + i,
            generator.ORDER_MEMBER,
          ) || generator.blank;
      }
      if (kind.charAt(3) === '1') {
        // Legacy precedence quirk preserved: `':' + code || blank` groups as
        // `(':' + code) || blank`, so the blank fallback never fires and an
        // empty step renders as a bare ':'.
        slices[i] +=
          ':' +
            generator.valueToCode(
              block,
              'SLICESTEP' + i,
              generator.ORDER_MEMBER,
            ) || generator.blank;
      }
    }
  }
  const code = value + '[' + slices.join(', ') + ']';
  return [code, generator.ORDER_MEMBER];
};

const isWeirdSliceCase = function (slice: ir.Slice): boolean {
  return (
    slice.lower == null &&
    slice.upper == null &&
    slice.step !== null &&
    slice.step._astname === 'NameConstant' &&
    slice.step.value === null
  );
};

function addSliceDim(
  this: TextToBlocksConverter,
  slice: ir.SliceKind,
  i: number,
  values: Record<string, Element | null>,
  mutations: string[],
  node: ir.Subscript,
): void {
  const sliceKind = slice._astname;
  if (sliceKind === 'Index') {
    values['INDEX' + i] = this.convert((slice as ir.Index).value, node) as Element;
    mutations.push('I');
  } else if (sliceKind === 'Slice') {
    const typedSlice = slice as ir.Slice;
    let L = '0',
      U = '0',
      S = '0';
    if (typedSlice.lower !== null) {
      values['SLICELOWER' + i] = this.convert(typedSlice.lower, node) as Element;
      L = '1';
    }
    if (typedSlice.upper !== null) {
      values['SLICEUPPER' + i] = this.convert(typedSlice.upper, node) as Element;
      U = '1';
    }
    if (typedSlice.step !== null && !isWeirdSliceCase(typedSlice)) {
      values['SLICESTEP' + i] = this.convert(typedSlice.step, node) as Element;
      S = '1';
    }
    mutations.push('S' + L + U + S);
  }
}

registerConverter(
  'Subscript',
  function (this: TextToBlocksConverter, node: ir.Subscript, _parent: unknown) {
    const value = node.value;
    const slice = node.slice;
    // (Legacy read `node.ctx` here but never used it.)

    const values: Record<string, Element | null> = {
      VALUE: this.convert(value, node) as Element,
    };
    const mutations: string[] = [];

    const sliceKind = slice._astname;
    if (sliceKind === 'ExtSlice') {
      const dims = (slice as ir.ExtSlice).dims;
      for (let i = 0; i < dims.length; i += 1) {
        const dim = dims[i]!;
        addSliceDim.call(this, dim, i, values, mutations, node);
      }
    } else {
      addSliceDim.call(this, slice, 0, values, mutations, node);
    }
    return createBlock(
      'ast_Subscript',
      node.lineno,
      {},
      values,
      { inline: 'true' },
      { arg: mutations },
    );
  },
);
