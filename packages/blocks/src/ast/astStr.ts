/** Port of legacy `ast/ast_Str.js`. */
import * as Blockly from 'blockly/core';
import { registerFieldMultilineInput } from '@blockly/field-multilineinput';
import { COLOR } from '../colors';
import { generator } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import type { ConverterParent } from '../registry';
import { createBlock } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

defineBlocks({
  type: 'ast_Str',
  message0: '%1',
  args0: [{ type: 'field_input', name: 'TEXT', value: '' }],
  output: 'String',
  colour: COLOR.TEXT,
  extensions: ['text_quotes'],
});

defineBlocks({
  type: 'ast_StrChar',
  message0: '%1',
  args0: [
    {
      type: 'field_dropdown',
      name: 'TEXT',
      options: [
        ['\\n', '\n'],
        ['\\t', '\t'],
      ],
    },
  ],
  output: 'String',
  colour: COLOR.TEXT,
  extensions: ['text_quotes'],
});

{
  const multiline_input_type = 'field_multilinetext';

  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, multiline_input_type)) {
    // Register if the field-multilineinput plugin is available.
    // (Legacy probed for a global `registerFieldMultilineInput` and fell back
    // to "field_input" when the plugin was missing; here the plugin is a
    // static dependency, so the fallback branch is unreachable.)
    registerFieldMultilineInput();
  }

  defineBlocks({
    type: 'ast_StrMultiline',
    message0: '%1',
    args0: [{ type: multiline_input_type, name: 'TEXT', value: '' }],
    output: 'String',
    colour: COLOR.TEXT,
    extensions: ['text_quotes'],
  });

  defineBlocks({
    type: 'ast_StrDocstring',
    message0: 'Docstring: %1 %2',
    args0: [{ type: 'input_dummy' }, { type: multiline_input_type, name: 'TEXT', value: '' }],
    previousStatement: null,
    nextStatement: null,
    colour: COLOR.TEXT,
  });
}

type ImageBlock = Blockly.Block & {
  src_: string;
  updateShape_(): void;
};

defineBlock('ast_Image', {
  init: function (this: ImageBlock) {
    this.setColour(COLOR.TEXT);
    this.src_ = 'loading.png';
    this.updateShape_();
    this.setOutput(true);
  },
  mutationToDom: function (this: ImageBlock) {
    const container = Blockly.utils.xml.createElement('mutation');
    container.setAttribute('src', this.src_);
    return container;
  },
  domToMutation: function (this: ImageBlock, xmlElement: Element) {
    this.src_ = xmlElement.getAttribute('src')!;
    this.updateShape_();
  },
  updateShape_: function (this: ImageBlock) {
    let image = this.getInput('IMAGE');
    if (!image) {
      image = this.appendDummyInput('IMAGE');
      image.appendField(
        new Blockly.FieldImage(
          this.src_,
          40,
          40,
          // Legacy passed this options object in the `alt` parameter slot.
          { alt: this.src_, flipRtl: 'FALSE' } as unknown as string,
        ),
      );
    }
    const imageField = image.fieldRow[0]!;
    imageField.setValue(this.src_);
  },
});

/*
"https://game-icons.net/icons/ffffff/000000/1x1/delapouite/labrador-head.png"
BlockMirrorTextToBlocks.BLOCKS.push({
    "type": "ast_StrImage",
    "message0": "%1%2",
    "args0": [
        {"type": "field_image", "src": "https://game-icons.net/icons/ffffff/000000/1x1/delapouite/labrador-head.png", "width": 20, "height": 20, "alt": ""},
        //{"type": "field_label_serializable", "name": "SRC", "value": '', "visible": "false"}
    ],
    "output": "String",
    "colour": BlockMirrorTextToBlocks.COLOR.TEXT,
    //"extensions": ["text_quotes"]
});*/

generator.forBlock['ast_Str'] = function (block) {
  // Text value
  let code = generator.quote_(block.getFieldValue('TEXT'));
  code = code.replace('\n', 'n');
  return [code, generator.ORDER_ATOMIC];
};

generator.forBlock['ast_StrChar'] = function (block) {
  // Text value
  const value = block.getFieldValue('TEXT');
  switch (value) {
    case '\n':
      return ["'\\n'", generator.ORDER_ATOMIC];
    case '\t':
      return ["'\\t'", generator.ORDER_ATOMIC];
  }
  // Legacy fell off the end (returning undefined) for any other value -
  // unreachable through the dropdown.
  return undefined as unknown as null;
};

generator.forBlock['ast_Image'] = function (block) {
  // Text value
  //generator.definitions_["import_image"] = "from image import Image";
  const code = generator.quote_((block as ImageBlock).src_);
  return [code, generator.ORDER_FUNCTION_CALL];
};

const multiline_quote = function (string: string): string {
  // Can't use goog.string.quote since % must also be escaped.
  string = string.replace(/'''/g, "\\'\\'\\'");
  return "'''" + string + "'''";
};

generator.forBlock['ast_StrMultiline'] = function (block) {
  // Text value
  const code = multiline_quote(block.getFieldValue('TEXT'));
  return [code, generator.ORDER_ATOMIC];
};

generator.forBlock['ast_StrDocstring'] = function (block) {
  // Text value.
  let code = block.getFieldValue('TEXT');
  if (code.charAt(0) !== '\n') {
    code = '\n' + code;
  }
  if (code.charAt(code.length - 1) !== '\n') {
    code = code + '\n';
  }
  return multiline_quote(code) + '\n';
};

// The helpers below were `BlockMirrorTextToBlocks.prototype` methods in
// legacy; only the Str converter uses them, so they live here as module
// functions (exported for reuse).

export function isSingleChar(text: string): boolean {
  return text === '\n' || text === '\t';
}

export function isDocString(_node: unknown, parent: ir.AnyNode): boolean {
  return (
    parent._astname === 'Expr' &&
    parent._parent !== undefined &&
    ['FunctionDef', 'ClassDef'].indexOf(parent._parent._astname) !== -1 &&
    // The `indexOf` probe above guarantees a body-carrying definition node.
    (parent._parent as ir.FunctionDef | ir.ClassDef).body[0] === parent
  );
}

export function isSimpleString(text: string): boolean {
  return text.split('\n').length <= 2 && text.length <= 40;
}

export function dedent(text: string, levels: number, isDocString: boolean): string {
  // console.log(text, levels, isDocString);
  if (!isDocString && text.charAt(0) === '\n') {
    return text;
  }
  const split = text.split('\n');
  const indentation = '    '.repeat(levels);
  const recombined: string[] = [];
  // Are all lines indented?
  for (let i = 0; i < split.length; i++) {
    // This was a blank line, add it unchanged unless its the first line
    if (split[i] === '') {
      if (i !== 0) {
        recombined.push('');
      }
      // If it has our ideal indentation, add it without indentation
    } else if (split[i]!.startsWith(indentation)) {
      const unindentedLine = split[i]!.substr(indentation.length);
      if (unindentedLine !== '' || i !== split.length - 1) {
        recombined.push(unindentedLine);
      }
      // If it's the first line, then add it unmodified
    } else if (i === 0) {
      recombined.push(split[i]!);
      // This whole structure cannot be uniformly dedented, better give up.
    } else {
      return text;
    }
  }
  return recombined.join('\n');
}

// Image-URL detection table, verbatim from legacy `text_editor.js`
// (`BlockMirrorTextEditor.REGEX_PATTERNS`) - the converter shared the text
// editor's table. NOTE for the future text editor port: these regexes (and
// the 'constructor'/'string'/'none' keys) belong to it as well.
// The dangling `\2` (its quote group lives in the FIRST alternative only)
// and the redundant escapes are legacy quirks: an unset backreference
// matches empty, which is what lets the blob:/data: alternatives match at
// all. Ported byte-for-byte - do not "fix".
/* eslint-disable no-useless-backreference, no-useless-escape */
const STRING_IMAGE_URL =
  /((["'])(?:https?:\/\/[-a-zA-Z0-9@:%._\/\+~#=]+(?:png|jpg|jpeg|gif|svg)+)|(?:blob:null\/[A-Fa-f0-9-]+)|(?:data:image\/(?:png|jpg|jpeg|gif|svg\+xml|webp|bmp)(?:;charset=utf-8)?;base64,(?:[A-Za-z0-9]|[+/])+={0,2})\2)/g;
/* eslint-enable no-useless-backreference, no-useless-escape */
const CONSTRUCTOR_IMAGE_URL = /(?:^|\W)(Image\((["'])(.+?)\2\))/g;
const REGEX_PATTERNS: Record<string, RegExp | false> = {
  constructor: CONSTRUCTOR_IMAGE_URL,
  string: STRING_IMAGE_URL,
  none: false,
};

// TODO: Handle indentation intelligently
registerConverter(
  'Str',
  function (this: TextToBlocksConverter, node: ir.Str, parent: ConverterParent) {
    const s = node.s;
    const text = s; // legacy: Sk.ffi.remapToJs(s)
    // Legacy read `this.blockMirror.configuration.imageDetection`, which
    // `block_mirror.js` defaulted to 'string'; same default applied here.
    // (With 'none' the table yields `false` and `.test` throws a TypeError,
    // exactly as legacy did - the statement then falls back to a raw block.)
    const imageDetection =
      (this.configuration as { imageDetection?: string }).imageDetection || 'string';
    const regex = REGEX_PATTERNS[imageDetection] as RegExp;
    //console.log(text, regex.test(JSON.stringify(text)));
    if (regex.test(JSON.stringify(text))) {
      //if (text.startsWith("http") && text.endsWith(".png")) {
      return createBlock('ast_Image', node.lineno, {}, {}, {}, { '@src': text });
    } else if (isSingleChar(text)) {
      return createBlock('ast_StrChar', node.lineno, { TEXT: text });
    } else if (isDocString(node, parent!)) {
      const dedented = dedent(text, this.levelIndex - 1, true);
      return [createBlock('ast_StrDocstring', node.lineno, { TEXT: dedented })];
    } else if (text.indexOf('\n') === -1) {
      return createBlock('ast_Str', node.lineno, { TEXT: text });
    } else {
      const dedented = dedent(text, this.levelIndex - 1, false);
      // console.log("DD", dedented);
      return createBlock('ast_StrMultiline', node.lineno, { TEXT: dedented });
    }
  },
);
