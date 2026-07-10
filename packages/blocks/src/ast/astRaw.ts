/** Port of legacy `ast/ast_Raw.js` (fallback "Code Block"). */
import * as Blockly from 'blockly/core';
import { registerFieldMultilineInput } from '@blockly/field-multilineinput';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks } from '../registry';

let multilineInputType = 'field_multilinetext';

if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, multilineInputType)) {
  if (typeof registerFieldMultilineInput === 'function') {
    // Register if the field-multilineinput plugin is available
    registerFieldMultilineInput();
  } else {
    // Fallback in case plugin @blockly/field-multilineinput is not available
    multilineInputType = 'field_input';
  }
}

defineBlocks({
  type: 'ast_Raw',
  message0: 'Code Block: %1 %2',
  args0: [
    { type: 'input_dummy' },
    { type: multilineInputType, name: 'TEXT', value: '' },
  ],
  colour: COLOR.PYTHON,
  previousStatement: null,
  nextStatement: null,
});

generator.forBlock['ast_Raw'] = function (block) {
  const code = block.getFieldValue('TEXT') + '\n';
  return code;
};
