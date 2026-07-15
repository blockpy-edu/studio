/**
 * Blockly XML construction helpers - port of the `create_block` /
 * `raw_block` / `xmlToString` statics from legacy `text_to_blocks.js`.
 *
 * Deliberately uses the global HTML `document` (like legacy), NOT Blockly's
 * XML document: HTML `setAttribute`/`createElement` lowercase attribute and
 * tag names, and the ported mutation contracts depend on that (converters
 * emit `@ORELSE`-style keys while `domToMutation` reads `orelse`). Requires
 * a DOM (browser or jsdom) - same constraint legacy had.
 */
export type MutationValue = string | number | boolean | null | Element | (string | number)[];

export interface CreateBlockOptions {
  fields?: Record<string, string | number | boolean>;
  values?: Record<string, Element | null>;
  settings?: Record<string, string | number | boolean>;
  mutations?: Record<string, MutationValue>;
  statements?: Record<string, Element[] | null>;
}

function createElement(tag: string): Element {
  return document.createElement(tag);
}

function createTextNode(text: string): Text {
  return document.createTextNode(text);
}

export function xmlToString(xml: Element): string {
  return new XMLSerializer().serializeToString(xml);
}

/**
 * Build a `<block>` element. Mirrors legacy `create_block` exactly:
 *  - `settings` become block attributes,
 *  - mutation keys starting with `@` become mutation attributes,
 *  - array-valued mutation keys become repeated named child elements,
 *  - other mutation keys become `<arg name=...>` children (a `!` prefix
 *    yields an empty name), with an optional child element payload,
 *  - `fields`, `values`, and `statements` become the usual children.
 */
export function createBlock(
  type: string,
  lineNumber: number | null,
  fields?: CreateBlockOptions['fields'],
  values?: CreateBlockOptions['values'],
  settings?: CreateBlockOptions['settings'],
  mutations?: CreateBlockOptions['mutations'],
  statements?: CreateBlockOptions['statements'],
): Element {
  const newBlock = createElement('block');
  // Settings
  newBlock.setAttribute('type', type);
  newBlock.setAttribute('line_number', String(lineNumber ?? 0));
  for (const setting in settings) {
    newBlock.setAttribute(setting, String(settings[setting]));
  }
  // Mutations
  if (mutations !== undefined && Object.keys(mutations).length > 0) {
    const newMutation = createElement('mutation');
    for (const mutation in mutations) {
      const mutationValue = mutations[mutation]!;
      if (mutation.charAt(0) === '@') {
        newMutation.setAttribute(mutation.substring(1), String(mutationValue));
      } else if (mutationValue != null && Array.isArray(mutationValue)) {
        for (let i = 0; i < mutationValue.length; i++) {
          const mutationNode = createElement(mutation);
          mutationNode.setAttribute('name', String(mutationValue[i]));
          newMutation.appendChild(mutationNode);
        }
      } else {
        const mutationNode = createElement('arg');
        if (mutation.charAt(0) === '!') {
          mutationNode.setAttribute('name', '');
        } else {
          mutationNode.setAttribute('name', mutation);
        }
        if (mutationValue !== null) {
          mutationNode.appendChild(mutationValue as Element);
        }
        newMutation.appendChild(mutationNode);
      }
    }
    newBlock.appendChild(newMutation);
  }
  // Fields
  for (const field in fields) {
    const fieldValue = fields[field]!;
    const newField = createElement('field');
    newField.setAttribute('name', field);
    newField.appendChild(createTextNode(String(fieldValue)));
    newBlock.appendChild(newField);
  }
  // Values
  for (const value in values) {
    const valueValue = values[value];
    const newValue = createElement('value');
    if (valueValue !== null && valueValue !== undefined) {
      newValue.setAttribute('name', value);
      newValue.appendChild(valueValue);
      newBlock.appendChild(newValue);
    }
  }
  // Statements
  if (statements !== undefined && Object.keys(statements).length > 0) {
    for (const statement in statements) {
      const statementValue = statements[statement];
      if (statementValue == null) {
        continue;
      }
      for (let i = 0; i < statementValue.length; i += 1) {
        // In most cases, you really shouldn't ever have more than
        //  one statement in this list. I'm not sure Blockly likes
        //  that.
        const newStatement = createElement('statement');
        newStatement.setAttribute('name', statement);
        newStatement.appendChild(statementValue[i]!);
        newBlock.appendChild(newStatement);
      }
    }
  }
  return newBlock;
}

/** Fallback block holding unparsed source text (legacy `raw_block`). */
export function rawBlock(txt: string, lineno?: number): Element {
  return createBlock('ast_Raw', lineno || 0, { TEXT: txt });
}
