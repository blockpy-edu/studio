/** Port of legacy `ast/ast_NameConstant.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_NameConstantNone',
  message0: 'None',
  args0: [],
  output: 'None',
  colour: COLOR.LOGIC,
});

defineBlocks({
  type: 'ast_NameConstantBoolean',
  message0: '%1',
  args0: [
    {
      type: 'field_dropdown',
      name: 'BOOL',
      options: [
        ['True', 'TRUE'],
        ['False', 'FALSE'],
      ],
    },
  ],
  output: 'Boolean',
  colour: COLOR.LOGIC,
});

generator.forBlock['ast_NameConstantBoolean'] = function (block) {
  // Boolean values true and false.
  const code = block.getFieldValue('BOOL') == 'TRUE' ? 'True' : 'False';
  return [code, generator.ORDER_ATOMIC];
};

generator.forBlock['ast_NameConstantNone'] = function () {
  // Boolean values true and false.
  const code = 'None';
  return [code, generator.ORDER_ATOMIC];
};

registerConverter('NameConstant', function (this: TextToBlocksConverter, node: ir.NameConstant) {
  const value = node.value;

  // Legacy compared against the Sk.builtin singletons; the IR delivers the
  // plain values null / true / false.
  if (value === null) {
    return createBlock('ast_NameConstantNone', node.lineno, {});
  } else if (value === true) {
    return createBlock('ast_NameConstantBoolean', node.lineno, {
      BOOL: 'TRUE',
    });
  } else if (value === false) {
    return createBlock('ast_NameConstantBoolean', node.lineno, {
      BOOL: 'FALSE',
    });
  }
  // Unreachable (value is exhaustively null | true | false); legacy fell
  // off the end returning undefined here.
  return null;
});
