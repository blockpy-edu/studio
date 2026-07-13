/** Port of legacy `ast/ast_Attribute.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks(
  {
    type: 'ast_AttributeFull',
    lastDummyAlign0: 'RIGHT',
    message0: '%1 . %2',
    args0: [
      { type: 'input_value', name: 'VALUE' },
      { type: 'field_input', name: 'ATTR', text: 'default' },
    ],
    inputsInline: true,
    output: null,
    colour: COLOR.OO,
  },
  {
    type: 'ast_Attribute',
    message0: '%1 . %2',
    args0: [
      { type: 'field_variable', name: 'VALUE', variable: 'variable' },
      { type: 'field_input', name: 'ATTR', text: 'attribute' },
    ],
    inputsInline: true,
    output: null,
    colour: COLOR.OO,
  },
);

generator.forBlock['ast_Attribute'] = function (block) {
  // Text value.
  const value = generator.getVariableName(block.getFieldValue('VALUE'));
  const attr = block.getFieldValue('ATTR');
  const code = value + '.' + attr;
  return [code, generator.ORDER_MEMBER];
};

generator.forBlock['ast_AttributeFull'] = function (block) {
  // Text value.
  const value = generator.valueToCode(block, 'VALUE', generator.ORDER_NONE) || generator.blank;
  const attr = block.getFieldValue('ATTR');
  const code = value + '.' + attr;
  return [code, generator.ORDER_MEMBER];
};

registerConverter(
  'Attribute',
  function (this: TextToBlocksConverter, node: ir.Attribute, _parent: unknown) {
    const value = node.value;
    const attr = node.attr;

    //if (value.constructor)
    if (value._astname === 'Name') {
      return createBlock('ast_Attribute', node.lineno, {
        VALUE: value.id,
        ATTR: attr,
      });
    } else {
      return createBlock(
        'ast_AttributeFull',
        node.lineno,
        {
          ATTR: attr,
        },
        {
          VALUE: this.convert(value, node) as Element,
        },
      );
    }
  },
);
