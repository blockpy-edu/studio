/**
 * `match`/`case` blocks (M3.6) - a STUDIO addition with no BlockMirror
 * ancestor (the legacy block set predates Python 3.10). Shape follows the
 * ast_If idiom: a value input for the subject, then per-case a header row
 * and a statement input, with the case count carried in the mutation.
 *
 * v1 design decision (plan M3.6): case patterns are TEXTUAL - an editable
 * text field holding the raw pattern source (guards included). Patterns are
 * not expressions, so no pattern-block algebra; the round-trip suite is the
 * correctness gate.
 */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type MatchBlock = Blockly.Block & {
  cases_: number;
  updateShape_(): void;
};

defineBlock('ast_Match', {
  init: function (this: MatchBlock) {
    this.cases_ = 1;
    this.appendValueInput('SUBJECT').appendField('match');
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.LOGIC);
    this.updateShape_();
  },
  updateShape_: function (this: MatchBlock) {
    let i = 0;
    for (; i < this.cases_; i++) {
      if (!this.getInput('CASEHEADER' + i)) {
        this.appendDummyInput('CASEHEADER' + i)
          .appendField('case')
          .appendField(new Blockly.FieldTextInput('_'), 'CASEPATTERN' + i);
        this.appendStatementInput('CASEBODY' + i).setCheck(null);
      }
    }
    // Remove deleted case inputs.
    while (this.getInput('CASEHEADER' + i)) {
      this.removeInput('CASEHEADER' + i);
      this.removeInput('CASEBODY' + i);
      i++;
    }
  },
  mutationToDom: function (this: MatchBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('cases', String(this.cases_));
    return container;
  },
  domToMutation: function (this: MatchBlock, xmlElement: Element) {
    this.cases_ = parseInt(xmlElement.getAttribute('cases')!, 10) || 1;
    this.updateShape_();
  },
});

generator.forBlock['ast_Match'] = function (block) {
  const typed = block as MatchBlock;
  let code =
    'match ' +
    (generator.valueToCode(block, 'SUBJECT', generator.ORDER_NONE) || generator.blank) +
    ':\n';
  for (let i = 0; i < typed.cases_; i++) {
    const pattern = block.getFieldValue('CASEPATTERN' + i) || '_';
    const body = generator.statementToCode(block, 'CASEBODY' + i) || generator.PASS;
    // statementToCode indents one level; case bodies sit one deeper.
    code +=
      generator.INDENT + 'case ' + pattern + ':\n' + generator.prefixLines(body, generator.INDENT);
  }
  return code;
};

registerConverter(
  'Match',
  function (this: TextToBlocksConverter, node: ir.Match, _parent: unknown) {
    const values: Record<string, Element | null> = {
      SUBJECT: this.convert(node.subject, node) as Element,
    };
    const fields: Record<string, string> = {};
    const statements: Record<string, Element[] | null> = {};
    node.cases.forEach((matchCase, i) => {
      fields['CASEPATTERN' + i] = matchCase.pattern;
      statements['CASEBODY' + i] = this.convertBody(matchCase.body, node);
    });
    return createBlock(
      'ast_Match',
      node.lineno,
      fields,
      values,
      {},
      { '@cases': node.cases.length },
      statements,
    );
  },
);
