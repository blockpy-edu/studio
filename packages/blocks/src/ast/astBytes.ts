/**
 * Bytes literal block (M3.6) - Studio addition, no BlockMirror ancestor.
 * Carries the ORIGINAL literal text (prefix + quotes) in an editable field,
 * so `b'\x00'` round-trips byte-exactly like Num keeps `0x10`.
 */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Bytes',
  message0: '%1',
  args0: [{ type: 'field_input', name: 'BYTES', text: "b''" }],
  inputsInline: false,
  output: null,
  colour: COLOR.TEXT,
});

generator.forBlock['ast_Bytes'] = function (block) {
  return [block.getFieldValue('BYTES') || "b''", generator.ORDER_ATOMIC];
};

registerConverter(
  'Bytes',
  function (this: TextToBlocksConverter, node: ir.Bytes, _parent: unknown) {
    return createBlock('ast_Bytes', node.lineno, {
      BYTES: node.source,
    });
  },
);
