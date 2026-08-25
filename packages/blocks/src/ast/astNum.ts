/** Port of legacy `ast/ast_Num.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import { numberLiteralValue } from '../cst/number-literal';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

/**
 * The block keeps a `field_number` (so editing behaves as before) plus the
 * literal's original source text in a mutation. Text generation re-emits
 * the source verbatim while the field still holds the value that source
 * denotes - so `0x10`, `1_000`, `1j` and integers beyond 2^53 survive the
 * trip - and falls back to the field's number once the user edits it.
 */
type NumBlock = Blockly.Block & { source_: string | null };

defineBlock('ast_Num', {
  init: function (this: NumBlock) {
    this.jsonInit({
      message0: '%1',
      args0: [{ type: 'field_number', name: 'NUM', value: 0 }],
      output: 'Number',
      colour: COLOR.MATH,
    });
    this.source_ = null;
  },
  mutationToDom: function (this: NumBlock) {
    if (this.source_ === null) {
      return null;
    }
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('source', this.source_);
    return container;
  },
  domToMutation: function (this: NumBlock, xmlElement: Element) {
    this.source_ = xmlElement.getAttribute('source');
  },
});

generator.forBlock['ast_Num'] = function (block) {
  const source = (block as NumBlock).source_;
  const fieldValue = block.getFieldValue('NUM');
  if (source !== null && numberLiteralValue(source) === Number(fieldValue)) {
    // Unedited literal: preserve its exact source form.
    const order = source.startsWith('-') ? generator.ORDER_UNARY_SIGN : generator.ORDER_ATOMIC;
    return [source, order];
  }
  // Numeric value.
  let code: number | string = parseFloat(fieldValue);
  let order: number;
  if (code == Infinity) {
    code = 'float("inf")';
    order = generator.ORDER_FUNCTION_CALL;
  } else if (code == -Infinity) {
    code = '-float("inf")';
    order = generator.ORDER_UNARY_SIGN;
  } else {
    order = code < 0 ? generator.ORDER_UNARY_SIGN : generator.ORDER_ATOMIC;
  }
  return [String(code), order];
};

registerConverter('Num', function (this: TextToBlocksConverter, node: ir.Num) {
  const n = node.n;
  return createBlock('ast_Num', node.lineno, { NUM: n }, {}, {}, { '@source': node.source });
});
