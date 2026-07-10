/** Port of legacy `ast/ast_Num.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Num',
  message0: '%1',
  args0: [{ type: 'field_number', name: 'NUM', value: 0 }],
  output: 'Number',
  colour: COLOR.MATH,
});

generator.forBlock['ast_Num'] = function (block) {
  // Numeric value.
  let code: number | string = parseFloat(block.getFieldValue('NUM'));
  let order: number;
  if (code == Infinity) {
    code = 'float("inf")';
    order = generator.ORDER_FUNCTION_CALL;
  } else if (code == -Infinity) {
    code = '-float("inf")';
    order = generator.ORDER_UNARY_SIGN;
  } else {
    order =
      code < 0 ? generator.ORDER_UNARY_SIGN : generator.ORDER_ATOMIC;
  }
  return [String(code), order];
};

registerConverter(
  'Num',
  function (this: TextToBlocksConverter, node: ir.Num) {
    const n = node.n;
    return createBlock('ast_Num', node.lineno, {
      NUM: n,
    });
  },
);
