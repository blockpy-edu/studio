/** Port of legacy `ast/ast_Import.js` - handles Import AND ImportFrom. */
// TODO: direct imports are not variables, because you can do stuff like:
//         import os.path
//       What should the variable be? Blockly will mangle it, but we should really be
//       doing something more complicated here with namespaces (probably make `os` the
//       variable and have some kind of list of attributes. But that's in the fading zone.
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, registerConverter } from '../registry';
import { createBlock } from '../xml';
import type { MutationValue } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

type ImportBlock = Blockly.Block & {
  nameCount_: number;
  from_: boolean;
  regulars_: boolean[];
  updateShape_(): void;
};

defineBlock('ast_Import', {
  init: function (this: ImportBlock) {
    this.nameCount_ = 1;
    this.from_ = false;
    this.regulars_ = [true];
    this.setInputsInline(false);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(COLOR.PYTHON);
    this.updateShape_();
  },
  // TODO: Not mutable currently
  updateShape_: function (this: ImportBlock) {
    // Possible FROM part
    if (this.from_ && !this.getInput('FROM')) {
      this.appendDummyInput('FROM')
        .setAlign(Blockly.inputs.Align.RIGHT)
        .appendField('from')
        .appendField(new Blockly.FieldTextInput('module'), 'MODULE');
    } else if (!this.from_ && this.getInput('FROM')) {
      this.removeInput('FROM');
    }
    // Import clauses
    let i;
    for (i = 0; i < this.nameCount_; i++) {
      let input = this.getInput('CLAUSE' + i);
      if (!input) {
        input = this.appendDummyInput('CLAUSE' + i).setAlign(Blockly.inputs.Align.RIGHT);
        if (i === 0) {
          input.appendField('import');
        }
        input.appendField(new Blockly.FieldTextInput('default'), 'NAME' + i);
      }
      if (this.regulars_[i] && this.getField('AS' + i)) {
        input.removeField('AS' + i);
        input.removeField('ASNAME' + i);
      } else if (!this.regulars_[i] && !this.getField('AS' + i)) {
        input
          .appendField('as', 'AS' + i)
          .appendField(new Blockly.FieldVariable('alias'), 'ASNAME' + i);
      }
    }
    // Remove deleted inputs.
    while (this.getInput('CLAUSE' + i)) {
      this.removeInput('CLAUSE' + i);
      i++;
    }
    // Reposition everything
    if (this.from_ && this.nameCount_ > 0) {
      this.moveInputBefore('FROM', 'CLAUSE0');
    }
    for (i = 0; i + 1 < this.nameCount_; i++) {
      this.moveInputBefore('CLAUSE' + i, 'CLAUSE' + (i + 1));
    }
  },
  /**
   * Create XML to represent the (non-editable) name and arguments.
   * @return {!Element} XML storage element.
   * @this Blockly.Block
   */
  mutationToDom: function (this: ImportBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('names', String(this.nameCount_));
    container.setAttribute('from', String(this.from_));
    for (let i = 0; i < this.nameCount_; i++) {
      const parameter = Blockly.utils.xml.createElement('regular');
      parameter.setAttribute('name', String(this.regulars_[i]));
      container.appendChild(parameter);
    }
    return container;
  },
  /**
   * Parse XML to restore the (non-editable) name and parameters.
   * @param {!Element} xmlElement XML storage element.
   * @this Blockly.Block
   */
  domToMutation: function (this: ImportBlock, xmlElement: Element) {
    this.nameCount_ = parseInt(xmlElement.getAttribute('names')!, 10);
    this.from_ = 'true' === xmlElement.getAttribute('from');
    this.regulars_ = [];
    for (let i = 0, childNode; (childNode = xmlElement.childNodes[i] as Element | undefined); i++) {
      if (childNode.nodeName.toLowerCase() === 'regular') {
        this.regulars_.push('true' === childNode.getAttribute('name'));
      }
    }
    this.updateShape_();
  },
});

generator.forBlock['ast_Import'] = function (block) {
  const typed = block as ImportBlock;
  // Optional from part
  // (Legacy read `this.from_`/`this.regulars_` - Blockly invokes forBlock
  // with the block as `this`, so they are the same object as `block`.)
  let from = '';
  if (typed.from_) {
    const moduleName = block.getFieldValue('MODULE');
    from = 'from ' + moduleName + ' ';
    generator.imported_['import_' + moduleName] = moduleName;
  }
  // Create a list with any number of elements of any type.
  const elements = new Array<string>(typed.nameCount_);
  for (let i = 0; i < typed.nameCount_; i++) {
    let name = block.getFieldValue('NAME' + i);
    elements[i] = name;
    if (!typed.regulars_[i]) {
      name = generator.getVariableName(block.getFieldValue('ASNAME' + i));
      elements[i] += ' as ' + name;
    }
    if (!from) {
      generator.imported_['import_' + name] = name;
    }
  }
  return from + 'import ' + elements.join(', ') + '\n';
};

const convertImport = function (
  this: TextToBlocksConverter,
  node: ir.Import | ir.ImportFrom,
  _parent: unknown,
): Element | null {
  const names = node.names;

  const fields: Record<string, string> = {};
  const mutations: Record<string, MutationValue> = { '@names': names.length };

  const regulars: boolean[] = [];
  let simpleName = '';
  for (let i = 0; i < names.length; i++) {
    fields['NAME' + i] = names[i]!.name;
    const isRegular = names[i]!.asname === null;
    if (!isRegular) {
      fields['ASNAME' + i] = names[i]!.asname!;
      simpleName = fields['ASNAME' + i]!;
    } else {
      simpleName = fields['NAME' + i]!;
    }
    regulars.push(isRegular);
  }
  mutations['regular'] = regulars as unknown as (string | number)[];

  if (this.hiddenImports.indexOf(simpleName) !== -1) {
    return null;
  }

  if (node._astname === 'ImportFrom') {
    // acbart: GTS suggests module can be None for '.' but it's an empty string in Skulpt
    mutations['@from'] = true;
    fields['MODULE'] = '.'.repeat(node.level) + (node.module ?? '');
  } else {
    mutations['@from'] = false;
  }

  return createBlock('ast_Import', node.lineno, fields, {}, { inline: true }, mutations);
};

registerConverter('Import', convertImport);
// Alias ImportFrom because of big overlap
registerConverter('ImportFrom', convertImport);
