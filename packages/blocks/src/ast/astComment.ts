/**
 * Port of legacy `ast/ast_Comment.js`. The IR→block conversion lives on
 * `TextToBlocksConverter.astComment` (comments are not AST nodes).
 */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks } from '../registry';

defineBlocks({
  type: 'ast_Comment',
  message0: '# Comment: %1',
  args0: [{ type: 'field_input', name: 'BODY', text: 'will be ignored' }],
  inputsInline: true,
  previousStatement: null,
  nextStatement: null,
  colour: COLOR.PYTHON,
});

generator.forBlock['ast_Comment'] = function (block) {
  const text_body = block.getFieldValue('BODY');
  return '#' + text_body + '\n';
};
