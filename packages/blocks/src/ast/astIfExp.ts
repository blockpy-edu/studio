/** Port of legacy `ast/ast_IfExp.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_IfExp',
  message0: '%1 if %2 else %3',
  args0: [
    { type: 'input_value', name: 'BODY' },
    { type: 'input_value', name: 'TEST' },
    { type: 'input_value', name: 'ORELSE' },
  ],
  inputsInline: true,
  output: null,
  colour: COLOR.LOGIC,
});

generator.forBlock['ast_IfExp'] = function (block) {
  const test =
    generator.valueToCode(block, 'TEST', generator.ORDER_CONDITIONAL) ||
    generator.blank;
  const body =
    generator.valueToCode(block, 'BODY', generator.ORDER_CONDITIONAL) ||
    generator.blank;
  const orelse =
    generator.valueToCode(block, 'ORELSE', generator.ORDER_CONDITIONAL) ||
    generator.blank;
  // Legacy quirk preserved: trailing newline inside a value expression.
  return [
    body + ' if ' + test + ' else ' + orelse + '\n',
    generator.ORDER_CONDITIONAL,
  ];
};

registerConverter(
  'IfExp',
  function (this: TextToBlocksConverter, node: ir.IfExp, _parent: unknown) {
    const test = node.test;
    const body = node.body;
    const orelse = node.orelse;

    return createBlock('ast_IfExp', node.lineno, {}, {
      TEST: this.convert(test, node) as Element,
      BODY: this.convert(body, node) as Element,
      ORELSE: this.convert(orelse, node) as Element,
    });
  },
);
