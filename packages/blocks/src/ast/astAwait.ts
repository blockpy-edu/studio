/**
 * `await ___` value block (M3.6) — Studio addition, no BlockMirror ancestor.
 * Statement-position awaits ride the ast_Expr wrapper (with its legacy
 * ORDER_ATOMIC paren quirk, same as unknown bare calls).
 */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Await',
  message0: 'await %1',
  args0: [{ type: 'input_value', name: 'VALUE' }],
  inputsInline: false,
  output: null,
  colour: COLOR.FUNCTIONS,
});

generator.forBlock['ast_Await'] = function (block) {
  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_LAMBDA) ||
    generator.blank;
  return ['await ' + value, generator.ORDER_LAMBDA];
};

registerConverter(
  'Await',
  function (this: TextToBlocksConverter, node: ir.Await, _parent: unknown) {
    return createBlock('ast_Await', node.lineno, {}, {
      VALUE: this.convert(node.value, node) as Element,
    });
  },
);
