/** Port of legacy `ast/ast_Yield.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks(
  {
    type: 'ast_YieldFull',
    message0: 'yield %1',
    args0: [{ type: 'input_value', name: 'VALUE' }],
    inputsInline: false,
    output: null,
    colour: COLOR.FUNCTIONS,
  },
  {
    type: 'ast_Yield',
    message0: 'yield',
    inputsInline: false,
    output: null,
    colour: COLOR.FUNCTIONS,
  },
);

generator.forBlock['ast_Yield'] = function () {
  return ['yield', generator.ORDER_LAMBDA];
};

generator.forBlock['ast_YieldFull'] = function (block) {
  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_LAMBDA) ||
    generator.blank;
  return ['yield ' + value, generator.ORDER_LAMBDA];
};

registerConverter(
  'Yield',
  function (this: TextToBlocksConverter, node: ir.Yield, _parent: unknown) {
    const value = node.value;

    if (value == null) {
      return createBlock('ast_Yield', node.lineno);
    } else {
      return createBlock('ast_YieldFull', node.lineno, {}, {
        VALUE: this.convert(value, node) as Element,
      });
    }
  },
);
