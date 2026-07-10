/** Port of legacy `ast/ast_Break.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Break',
  message0: 'break',
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: COLOR.CONTROL,
});

generator.forBlock['ast_Break'] = function () {
  return 'break\n';
};

registerConverter(
  'Break',
  function (this: TextToBlocksConverter, node: ir.Break, _parent: unknown) {
    return createBlock('ast_Break', node.lineno);
  },
);
