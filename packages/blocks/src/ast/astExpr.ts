/** Port of legacy `ast/ast_Expr.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Expr',
  message0: 'do nothing with %1',
  args0: [{ type: 'input_value', name: 'VALUE' }],
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: COLOR.PYTHON,
});

generator.forBlock['ast_Expr'] = function (block) {
  // Numeric value.
  const value =
    generator.valueToCode(block, 'VALUE', generator.ORDER_ATOMIC) ||
    generator.blank;
  // TODO: Assemble JavaScript into code variable.
  return value + '\n';
};

registerConverter(
  'Expr',
  function (this: TextToBlocksConverter, node: ir.ExprStmt, parent: unknown) {
    const value = node.value;

    const converted = this.convert(value, node);

    if (converted!.constructor === Array) {
      return (converted as Element[])[0]!;
    } else if (this.isTopLevel(parent)) {
      // Returning `[element]` marks a naked top-level expression;
      // `convertBody` unwraps it into a peer block.
      return [this.convert(value, node) as Element];
    } else {
      return createBlock('ast_Expr', node.lineno, {}, {
        VALUE: this.convert(value, node) as Element,
      });
    }
  },
);
