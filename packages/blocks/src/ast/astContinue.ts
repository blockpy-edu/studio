/** Port of legacy `ast/ast_Continue.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Continue',
  message0: 'continue',
  inputsInline: false,
  previousStatement: null,
  nextStatement: null,
  colour: COLOR.CONTROL,
});

generator.forBlock['ast_Continue'] = function () {
  return 'continue\n';
};

registerConverter(
  'Continue',
  function (this: TextToBlocksConverter, node: ir.Continue, _parent: unknown) {
    return createBlock('ast_Continue', node.lineno);
  },
);
