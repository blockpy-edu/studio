/** Port of legacy `ast/ast_Assert.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks(
  {
    type: 'ast_AssertFull',
    message0: 'assert %1 %2',
    args0: [
      { type: 'input_value', name: 'TEST' },
      { type: 'input_value', name: 'MSG' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: COLOR.LOGIC,
  },
  {
    type: 'ast_Assert',
    message0: 'assert %1',
    args0: [{ type: 'input_value', name: 'TEST' }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: COLOR.LOGIC,
  },
);

generator.forBlock['ast_Assert'] = function (block) {
  const test = generator.valueToCode(block, 'TEST', generator.ORDER_ATOMIC) || generator.blank;
  return 'assert ' + test + '\n';
};

generator.forBlock['ast_AssertFull'] = function (block) {
  const test = generator.valueToCode(block, 'TEST', generator.ORDER_ATOMIC) || generator.blank;
  const msg = generator.valueToCode(block, 'MSG', generator.ORDER_ATOMIC) || generator.blank;
  return 'assert ' + test + ', ' + msg + '\n';
};

registerConverter(
  'Assert',
  function (this: TextToBlocksConverter, node: ir.Assert, _parent: unknown) {
    const test = node.test;
    const msg = node.msg;
    if (msg == null) {
      return createBlock(
        'ast_Assert',
        node.lineno,
        {},
        {
          TEST: this.convert(test, node) as Element,
        },
      );
    } else {
      return createBlock(
        'ast_AssertFull',
        node.lineno,
        {},
        {
          TEST: this.convert(test, node) as Element,
          MSG: this.convert(msg, node) as Element,
        },
      );
    }
  },
);
