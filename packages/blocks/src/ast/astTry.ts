/** Port of legacy `ast/ast_Try.js`. */
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

// Legacy statics `BlockMirrorTextToBlocks.HANDLERS_*`.
const HANDLERS_CATCH_ALL = 0;
const HANDLERS_NO_AS = 1;
const HANDLERS_COMPLETE = 3;

type TryBlock = Blockly.Block & {
  handlersCount_: number;
  handlers_: number[];
  hasElse_: boolean;
  hasFinally_: boolean;
  updateShape_(): void;
};

defineBlock('ast_Try', {
  init: function (this: TryBlock) {
    this.handlersCount_ = 0;
    this.handlers_ = [];
    this.hasElse_ = false;
    this.hasFinally_ = false;
    this.appendDummyInput().appendField('try:');
    this.appendStatementInput('BODY')
      .setCheck(null)
      .setAlign(Blockly.inputs.Align.RIGHT);
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.EXCEPTIONS);
    this.updateShape_();
  },
  // TODO: Not mutable currently
  updateShape_: function (this: TryBlock) {
    for (let i = 0; i < this.handlersCount_; i++) {
      if (this.handlers_[i] === HANDLERS_CATCH_ALL) {
        this.appendDummyInput().appendField('except');
      } else {
        this.appendValueInput('TYPE' + i)
          .setCheck(null)
          .appendField('except');
        if (this.handlers_[i] === HANDLERS_COMPLETE) {
          this.appendDummyInput()
            .appendField('as')
            .appendField(new Blockly.FieldVariable('item'), 'NAME' + i);
        }
      }
      this.appendStatementInput('HANDLER' + i).setCheck(null);
    }
    if (this.hasElse_) {
      this.appendDummyInput().appendField('else:');
      this.appendStatementInput('ORELSE').setCheck(null);
    }
    if (this.hasFinally_) {
      this.appendDummyInput().appendField('finally:');
      this.appendStatementInput('FINALBODY').setCheck(null);
    }
  },
  /**
   * Create XML to represent the (non-editable) name and arguments.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: TryBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('orelse', String(this.hasElse_));
    container.setAttribute('finalbody', String(this.hasFinally_));
    container.setAttribute('handlers', String(this.handlersCount_));
    for (let i = 0; i < this.handlersCount_; i++) {
      const parameter = Blockly.utils.xml.createElement('arg');
      parameter.setAttribute('name', String(this.handlers_[i]));
      container.appendChild(parameter);
    }
    return container;
  },
  /**
   * Parse XML to restore the (non-editable) name and parameters.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: TryBlock, xmlElement: Element) {
    this.hasElse_ = 'true' === xmlElement.getAttribute('orelse');
    this.hasFinally_ = 'true' === xmlElement.getAttribute('finalbody');
    this.handlersCount_ = parseInt(xmlElement.getAttribute('handlers')!, 10);
    this.handlers_ = [];
    for (let i = 0, childNode: any; (childNode = xmlElement.childNodes[i]); i++) {
      if (childNode.nodeName.toLowerCase() === 'arg') {
        this.handlers_.push(parseInt(childNode.getAttribute('name'), 10));
      }
    }
    this.updateShape_();
  },
});

generator.forBlock['ast_Try'] = function (block) {
  const typed = block as TryBlock;
  // Try:
  const body = generator.statementToCode(block, 'BODY') || generator.PASS;
  // Except clauses
  const handlers = new Array<string>(typed.handlersCount_);
  for (let i = 0; i < typed.handlersCount_; i++) {
    const level = typed.handlers_[i];
    let clause = 'except';
    if (level !== HANDLERS_CATCH_ALL) {
      // Legacy quirk preserved: `+` binds tighter than `||`, so the blank
      // fallback on the right never fires.
      clause +=
        ' ' + generator.valueToCode(block, 'TYPE' + i, generator.ORDER_NONE) ||
        generator.blank;
      if (level === HANDLERS_COMPLETE) {
        clause +=
          ' as ' + generator.getVariableName(block.getFieldValue('NAME' + i));
      }
    }
    clause +=
      ':\n' + (generator.statementToCode(block, 'HANDLER' + i) || generator.PASS);
    handlers[i] = clause;
  }
  // Orelse:
  let orelse = '';
  // Legacy used `this.hasElse_`; generator functions are invoked with the
  // block as `this`, so this is the same value.
  if (typed.hasElse_) {
    orelse =
      'else:\n' + (generator.statementToCode(block, 'ORELSE') || generator.PASS);
  }
  // Finally:
  let finalbody = '';
  if (typed.hasFinally_) {
    finalbody =
      'finally:\n' +
      (generator.statementToCode(block, 'FINALBODY') || generator.PASS);
  }
  return 'try:\n' + body + handlers.join('') + orelse + finalbody;
};

registerConverter(
  'Try',
  function (this: TextToBlocksConverter, node: ir.Try, _parent: unknown) {
    const body = node.body;
    const handlers = node.handlers;
    const orelse = node.orelse;
    const finalbody = node.finalbody;

    const fields: Record<string, string> = {};
    const values: Record<string, Element | null> = {};
    const mutations: Record<string, any> = {
      '@ORELSE': orelse !== null && orelse.length > 0,
      '@FINALBODY': finalbody !== null && finalbody.length > 0,
      '@HANDLERS': handlers.length,
    };

    const statements: Record<string, Element[] | null> = {
      BODY: this.convertBody(body, node),
    };
    if (orelse !== null) {
      statements['ORELSE'] = this.convertBody(orelse, node);
    }
    if (finalbody !== null && finalbody.length) {
      statements['FINALBODY'] = this.convertBody(finalbody, node);
    }

    const handledLevels: number[] = [];
    for (let i = 0; i < handlers.length; i++) {
      const handler = handlers[i]!;
      statements['HANDLER' + i] = this.convertBody(handler.body, node);
      if (handler.type === null) {
        handledLevels.push(HANDLERS_CATCH_ALL);
      } else {
        values['TYPE' + i] = this.convert(handler.type, node) as Element;
        if (handler.name === null) {
          handledLevels.push(HANDLERS_NO_AS);
        } else {
          handledLevels.push(HANDLERS_COMPLETE);
          // Legacy read `handler.name.id` through Sk.ffi; the IR gives the
          // handler name as a plain string.
          fields['NAME' + i] = handler.name;
        }
      }
    }

    mutations['ARG'] = handledLevels;

    return createBlock(
      'ast_Try',
      node.lineno,
      fields,
      values,
      {},
      mutations,
      statements,
    );
  },
);
