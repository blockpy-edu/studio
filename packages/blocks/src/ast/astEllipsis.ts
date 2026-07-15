/**
 * Ellipsis literal (`...`) block (M3.6) - Studio addition, no BlockMirror
 * ancestor.
 */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Ellipsis',
  message0: '…',
  inputsInline: false,
  output: null,
  colour: COLOR.PYTHON,
});

generator.forBlock['ast_Ellipsis'] = function () {
  return ['...', generator.ORDER_ATOMIC];
};

registerConverter(
  'Ellipsis',
  function (this: TextToBlocksConverter, node: ir.EllipsisNode, _parent: unknown) {
    return createBlock('ast_Ellipsis', node.lineno);
  },
);
