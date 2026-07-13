/** Port of legacy `ast/ast_For.js`. */
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlocks, registerConverter, type Converter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks(
  {
    type: 'ast_For',
    message0: 'for each item %1 in list %2 : %3 %4',
    args0: [
      { type: 'input_value', name: 'TARGET' },
      { type: 'input_value', name: 'ITER' },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'BODY' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: COLOR.CONTROL,
  },
  {
    type: 'ast_ForElse',
    message0: 'for each item %1 in list %2 : %3 %4 else: %5 %6',
    args0: [
      { type: 'input_value', name: 'TARGET' },
      { type: 'input_value', name: 'ITER' },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'BODY' },
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'ELSE' },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: COLOR.CONTROL,
  },
);

generator.forBlock['ast_For'] = function (block) {
  // For each loop.
  const argument0 =
    generator.valueToCode(block, 'TARGET', generator.ORDER_RELATIONAL) || generator.blank;
  const argument1 =
    generator.valueToCode(block, 'ITER', generator.ORDER_RELATIONAL) || generator.blank;
  const branchBody = generator.statementToCode(block, 'BODY') || generator.PASS;
  let code = 'for ' + argument0 + ' in ' + argument1 + ':\n' + branchBody;

  if (block.getInputTargetBlock('ELSE')) {
    const branchElse = generator.statementToCode(block, 'ELSE');

    if (branchElse) {
      code += 'else:\n' + branchElse;
    }
  }
  return code;
};

const convertFor: Converter<ir.For> = function (
  this: TextToBlocksConverter,
  node: ir.For,
  _parent: unknown,
) {
  if (node.is_async) {
    // M3.6: per-statement ast_Raw fallback (see astFunctionDef).
    throw new Error('async for has no block form (raw fallback)');
  }
  const target = node.target;
  const iter = node.iter;
  const body = node.body;
  const orelse = node.orelse;

  let blockName = 'ast_For';
  const bodies: Record<string, Element[] | null> = {
    BODY: this.convertBody(body, node),
  };

  if (orelse.length > 0) {
    blockName = 'ast_ForElse';
    bodies['ELSE'] = this.convertBody(orelse, node);
  }

  return createBlock(
    blockName,
    node.lineno,
    {},
    {
      ITER: this.convert(iter, node) as Element,
      TARGET: this.convert(target, node) as Element,
    },
    {},
    {},
    bodies,
  );
};

registerConverter('For', convertFor);

generator.forBlock['ast_ForElse'] = generator.forBlock['ast_For']!;
registerConverter('ForElse', convertFor);
