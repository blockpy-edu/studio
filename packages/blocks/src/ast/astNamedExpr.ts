/**
 * Walrus operator `target := value` block (M3.6) — Studio addition, no
 * BlockMirror ancestor (the legacy block set predates Python 3.8). Reported
 * at the lowest precedence so enclosing expressions re-parenthesize exactly
 * like the source (`if (n := f()) > 4:`).
 */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_NamedExpr',
  message0: '%1 := %2',
  args0: [
    { type: 'input_value', name: 'TARGET' },
    { type: 'input_value', name: 'VALUE' },
  ],
  inputsInline: true,
  output: null,
  colour: COLOR.VARIABLES,
});

generator.forBlock['ast_NamedExpr'] = function (block) {
  const target =
    generator.valueToCode(block, 'TARGET', generator.ORDER_ATOMIC) ||
    generator.blank;
  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_LAMBDA) ||
    generator.blank;
  return [target + ' := ' + value, generator.ORDER_LAMBDA];
};

registerConverter(
  'NamedExpr',
  function (this: TextToBlocksConverter, node: ir.NamedExpr, _parent: unknown) {
    return createBlock('ast_NamedExpr', node.lineno, {}, {
      TARGET: this.convert(node.target, node) as Element,
      VALUE: this.convert(node.value, node) as Element,
    });
  },
);
