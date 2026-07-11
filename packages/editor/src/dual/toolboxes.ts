/**
 * Toolbox presets and assembly for the dual block/text editor.
 *
 * Port of legacy BlockMirror `src/toolbars.js` (`TOOLBOX_CATEGORY`,
 * `BlockMirrorBlockEditor.prototype.TOOLBOXES`,
 * `BlockMirrorBlockEditor.EXTRA_TOOLS`) plus the toolbox assembly logic from
 * legacy `src/block_editor.js` (`toolboxPythonToBlocks`, `makeToolbox`),
 * ported as standalone functions. Snippet strings, category names, colour
 * keys, ordering, and raw-XML entries are verbatim from legacy.
 */
import * as Blockly from 'blockly/core';
import { COLOR, TextToBlocksConverter } from '@blockpy/blocks';

/** A python-snippet-driven toolbox category (legacy category object shape). */
export interface ToolboxCategory {
  name: string;
  /** Key into the legacy `COLOR` hue map (e.g. 'VARIABLES', 'MATH'). */
  colour: string;
  /** Python snippets converted to block XML; absent for `custom` categories. */
  blocks?: string[];
  /** Blockly dynamic-category name (legacy uses 'VARIABLE'). */
  custom?: string;
  /** Legacy flag: toggles `Blockly.Variables._HIDE_GETTERS_SETTERS`. */
  hideGettersSetters?: boolean;
}

/**
 * One entry in a toolbox preset: a category object, or a raw XML string that
 * is passed through verbatim ('<sep></sep>', '<category ...>', '</category>').
 */
export type ToolboxEntry = ToolboxCategory | string;

/**
 * What callers may pass as a toolbox: a preset name from {@link TOOLBOXES},
 * a raw toolbox XML body string, or a custom category array (legacy
 * `configuration.toolbox`, e.g. from `?toolbox.blockpy`).
 */
export type ToolboxSpec = string | ToolboxEntry[];

/**
 * Extra toolbox XML appended to every assembled toolbox, keyed by tool name.
 * Port of legacy `BlockMirrorBlockEditor.EXTRA_TOOLS` (initially empty;
 * legacy populated it externally, e.g. BlockPy's corgis/classics tools).
 */
export const EXTRA_TOOLS: Record<string, string> = {};

/** Shared category constants — port of legacy `TOOLBOX_CATEGORY`. */
export const TOOLBOX_CATEGORY = {
  VARIABLES: { name: 'Variables', colour: 'VARIABLES', custom: 'VARIABLE' },
  DECISIONS: {
    name: 'Decisions',
    colour: 'LOGIC',
    blocks: [
      'if ___: pass',
      'if ___: pass\nelse: pass',
      '___ < ___',
      '___ and ___',
      'not ___',
    ],
  },
  CALCULATIONS: {
    name: 'Calculation',
    colour: 'MATH',
    blocks: ['___ + ___', 'round(___)'],
  },
  OUTPUT_WITH_PLOTTING: {
    name: 'Output',
    colour: 'PLOTTING',
    blocks: [
      'print(___)',
      'plt.plot(___)',
      'plt.scatter(___, ___)',
      'plt.hist(___)',
      'plt.bar(___, ___, tick_label=___)',
      'plt.boxplot(___)',
      'plt.show()',
      'plt.title(___)',
      'plt.xlabel(___)',
      'plt.ylabel(___)',
      'plt.hlines(___, ___, ___)',
      'plt.vlines(___, ___, ___)',
    ],
  },
  TURTLES: {
    name: 'Turtles',
    colour: 'PLOTTING',
    blocks: [
      'turtle.mainloop()',
      'turtle.forward(50)',
      'turtle.backward(50)',
      'turtle.right(90)',
      'turtle.left(90)',
      'turtle.goto(0, 0)',
      'turtle.setx(100)',
      'turtle.sety(100)',
      'turtle.setheading(270)',
      'turtle.pendown()',
      'turtle.penup()',
      "turtle.pencolor('blue')",
    ],
  },
  INPUT: {
    name: 'Input',
    colour: 'TEXT',
    blocks: ["input('')"],
  },
  VALUES: {
    name: 'Values',
    colour: 'TEXT',
    blocks: ['""', '0', 'True'],
  },
  SEP: '<sep></sep>',
  CONVERSIONS: {
    name: 'Conversion',
    colour: 'TEXT',
    blocks: ['int(___)', 'float(___)', 'str(___)', 'bool(___)'],
  },
  DICTIONARIES: {
    name: 'Dictionaries',
    colour: 'DICTIONARY',
    blocks: [
      "{'1st key': ___, '2nd key': ___, '3rd key': ___}",
      '{}',
      "___['key']",
    ],
  },
} satisfies Record<string, ToolboxEntry>;

/**
 * Named toolbox presets — port of legacy
 * `BlockMirrorBlockEditor.prototype.TOOLBOXES`.
 */
export const TOOLBOXES: Record<string, ToolboxEntry[]> = {
  //******************************************************
  empty: [{ name: 'Empty Toolbox', colour: 'PYTHON', blocks: [] }],
  //******************************************************
  minimal: [
    // TODO: What should live in here? (legacy comment)
    TOOLBOX_CATEGORY.VARIABLES,
  ],
  //******************************************************
  normal: [
    TOOLBOX_CATEGORY.VARIABLES,
    TOOLBOX_CATEGORY.DECISIONS,
    {
      name: 'Iteration',
      colour: 'CONTROL',
      blocks: ['for ___ in ___: pass', 'while ___: pass', 'break'],
    },
    {
      name: 'Functions',
      colour: 'FUNCTIONS',
      blocks: [
        'def ___(___): pass',
        'def ___(___: int)->str: pass',
        'return ___',
      ],
    },
    TOOLBOX_CATEGORY.SEP,
    TOOLBOX_CATEGORY.CALCULATIONS,
    TOOLBOX_CATEGORY.OUTPUT_WITH_PLOTTING,
    TOOLBOX_CATEGORY.INPUT,
    TOOLBOX_CATEGORY.TURTLES,
    TOOLBOX_CATEGORY.SEP,
    TOOLBOX_CATEGORY.VALUES,
    TOOLBOX_CATEGORY.CONVERSIONS,
    {
      name: 'Lists',
      colour: 'LIST',
      blocks: [
        '[0, 0, 0]',
        '[___, ___, ___]',
        '[]',
        '___.append(___)',
        'range(0, 10)',
      ],
    },
    TOOLBOX_CATEGORY.DICTIONARIES,
  ],
  //******************************************************
  ct: [
    TOOLBOX_CATEGORY.VARIABLES,
    TOOLBOX_CATEGORY.DECISIONS,
    {
      name: 'Iteration',
      colour: 'CONTROL',
      blocks: ['for ___ in ___: pass'],
    },
    TOOLBOX_CATEGORY.SEP,
    TOOLBOX_CATEGORY.CALCULATIONS,
    TOOLBOX_CATEGORY.OUTPUT_WITH_PLOTTING,
    TOOLBOX_CATEGORY.INPUT,
    TOOLBOX_CATEGORY.SEP,
    TOOLBOX_CATEGORY.VALUES,
    TOOLBOX_CATEGORY.CONVERSIONS,
    {
      name: 'Lists',
      colour: 'LIST',
      blocks: ['[0, 0, 0]', '[___, ___, ___]', '[]', '___.append(___)'],
    },
  ],
  //******************************************************
  full: [
    TOOLBOX_CATEGORY.VARIABLES,
    {
      name: 'Literal Values',
      colour: 'LIST',
      blocks: [
        '0',
        "''",
        'True',
        'None',
        '[___, ___, ___]',
        '(___, ___, ___)',
        '{___, ___, ___}',
        '{___: ___, ___: ___, ___: ___}',
      ],
    },
    {
      name: 'Calculations',
      colour: 'MATH',
      blocks: ['-___', '___ + ___', '___ >> ___', 'abs(___)', 'round(___)'],
    },
    {
      name: 'Logic',
      colour: 'LOGIC',
      blocks: [
        '___ if ___ else ___',
        '___ == ___',
        '___ < ___',
        '___ in ___',
        '___ and ___',
        'not ___',
      ],
    },
    TOOLBOX_CATEGORY.SEP,
    {
      name: 'Classes',
      colour: 'OO',
      blocks: [
        'class ___: pass',
        'class ___(___): pass',
        '___.___',
        '___: ___',
        'super()',
      ],
    },
    {
      name: 'Functions',
      colour: 'FUNCTIONS',
      blocks: [
        'def ___(___): pass',
        'def ___(___: int)->str: pass',
        'return ___',
        'yield ___',
        'lambda ___: ___',
      ],
    },
    {
      name: 'Imports',
      colour: 'PYTHON',
      blocks: [
        'import ___',
        'from ___ import ___',
        'import ___ as ___',
        'from ___ import ___ as ___',
      ],
    },
    TOOLBOX_CATEGORY.SEP,
    {
      name: 'Control Flow',
      colour: 'CONTROL',
      blocks: [
        'if ___: pass',
        'if ___: pass\nelse: pass',
        'for ___ in ___: pass',
        'while ___: pass',
        'break',
        'continue',
        'try: pass\nexcept ___ as ___: pass',
        'raise ___',
        'assert ___',
        'with ___ as ___: pass',
      ],
    },
    TOOLBOX_CATEGORY.SEP,
    TOOLBOX_CATEGORY.OUTPUT_WITH_PLOTTING,
    TOOLBOX_CATEGORY.INPUT,
    {
      name: 'Files',
      colour: 'FILE',
      blocks: [
        "with open('', 'r') as ___: pass",
        '___.read()',
        '___.readlines()',
        '___.write(___)',
        '___.writelines(___)',
      ],
    },
    TOOLBOX_CATEGORY.SEP,
    {
      name: 'Conversion',
      colour: 'TEXT',
      blocks: [
        'int(___)',
        'float(___)',
        'str(___)',
        'chr(___)',
        'bool(___)',
        'list(___)',
        'dict(___)',
        'tuple(___)',
        'set(___)',
        'type(___)',
        'isinstance(___)',
      ],
    },
    {
      name: 'Builtin Functions',
      colour: 'SEQUENCES',
      blocks: [
        'len(___)',
        'sorted(___)',
        'enumerate(___)',
        'reversed(___)',
        'range(0, 10)',
        'min(___, ___)',
        'max(___, ___)',
        'sum(___)',
        'all(___)',
        'any(___)',
        'zip(___, ___)',
        'map(___, ___)',
        'filter(___, ___)',
      ],
    },
    {
      name: 'List Methods',
      colour: 'LIST',
      blocks: ['___.append(___)', '___.pop()', '___.clear()'],
    },
    {
      name: 'String Methods',
      colour: 'TEXT',
      blocks: [
        "___.startswith('')",
        "___.endswith('')",
        "___.replace('', '')",
        "___.lower('')",
        "___.upper('')",
        "___.title('')",
        "___.strip('')",
        "___.split('')",
        "''.join(___)",
        "___.format('')",
        "___.strip('')",
      ],
    },
    {
      name: 'Subscripting',
      colour: 'SEQUENCES',
      blocks: ['___[___]', '___[___:___]', '___[___:___:___]'],
    },
    {
      name: 'Generators',
      colour: 'SEQUENCES',
      blocks: [
        '[___ for ___ in ___]',
        '(___ for ___ in ___)',
        '{___ for ___ in ___}',
        '{___: ___ for ___ in ___ if ___}',
        '[___ for ___ in ___ if ___]',
        '(___ for ___ in ___ if ___)',
        '{___ for ___ in ___ if ___}',
        '{___: ___ for ___ in ___ if ___}',
      ],
    },
    {
      name: 'Comments',
      colour: 'PYTHON',
      blocks: ['# ', '"""\n"""'],
    },
    // Commented out in legacy toolbars.js, preserved for reference:
    // {name: "Weird Stuff", colour: "PYTHON", blocks: [
    //     "delete ___",
    //     "global ___"
    // ]}
  ],
  //******************************************************
  ct2: [
    {
      name: 'Memory',
      colour: 'VARIABLES',
      custom: 'VARIABLE',
      hideGettersSetters: true,
    },
    TOOLBOX_CATEGORY.SEP,

    '<category name="Expressions" expanded="true">',
    {
      name: 'Constants',
      colour: 'TEXT',
      blocks: ['""', '0', 'True', '[0, 0, 0]', '[___, ___, ___]', '[]'],
    },
    {
      name: 'Variables',
      colour: 'VARIABLES',
      blocks: ['VARIABLE'],
    },
    TOOLBOX_CATEGORY.CALCULATIONS,
    TOOLBOX_CATEGORY.CONVERSIONS,
    {
      name: 'Conditions',
      colour: 'LOGIC',
      blocks: ['___ == ___', '___ and ___', 'not ___'],
    },
    TOOLBOX_CATEGORY.INPUT,
    '</category>',
    TOOLBOX_CATEGORY.SEP,

    '<category name="Operations" expanded="true">',
    {
      name: 'Assignment',
      colour: 'VARIABLES',
      blocks: ['VARIABLE = ___', '___.append(___)'],
    },
    TOOLBOX_CATEGORY.OUTPUT_WITH_PLOTTING,
    '</category>',
    TOOLBOX_CATEGORY.SEP,

    '<category name="Control" expanded="true">',
    {
      name: 'Decision',
      colour: 'CONTROL',
      blocks: ['if ___: pass', 'if ___: pass\nelse: pass'],
    },
    {
      name: 'Iteration',
      colour: 'CONTROL',
      blocks: ['for ___ in ___: pass'],
    },
    '</category>',
  ],
};

/**
 * Legacy shim flag on `Blockly.Variables`, read by the ported variables
 * flyout callback (legacy `blockly_shims.js`) to suppress the auto-generated
 * assignment/getter blocks in `custom="VARIABLE"` categories.
 */
function setHideGettersSetters(value: boolean): void {
  (Blockly.Variables as unknown as Record<string, unknown>)[
    '_HIDE_GETTERS_SETTERS'
  ] = value;
}

/**
 * Convert a toolbox definition (array of category objects / raw XML strings)
 * into a toolbox XML body string.
 *
 * Port of legacy `BlockMirrorBlockEditor.prototype.toolboxPythonToBlocks`:
 * - raw string entries pass through verbatim;
 * - each category becomes `<category name=... colour=... [custom=...]>` with
 *   its snippets converted via `converter.convertSource('toolbox.py', code)`
 *   and the resulting `rawXml.innerHTML` joined with '\n';
 * - `hideGettersSetters` toggles `Blockly.Variables._HIDE_GETTERS_SETTERS`
 *   (reset to false at the start of every conversion, exactly as legacy did).
 */
export function toolboxPythonToBlocks(
  toolboxPython: ToolboxEntry[],
  converter: TextToBlocksConverter,
): string {
  setHideGettersSetters(false);
  return toolboxPython
    .map((category) => {
      if (typeof category === 'string') {
        return category;
      }
      const colour = (COLOR as Record<string, number>)[category.colour];
      let header = `<category name="${category.name}" colour="${colour}"`;
      if (category.custom) {
        header += ` custom="${category.custom}">`;
      } else {
        header += '>';
      }
      const body = (category.blocks || [])
        .map((code) => {
          const result = converter.convertSource('toolbox.py', code);
          return result.rawXml.innerHTML.toString();
        })
        .join('\n');
      const footer = '</category>';
      if (category.hideGettersSetters) {
        setHideGettersSetters(true);
      }
      return [header, body, footer].join('\n');
    })
    .join('\n');
}

/**
 * Build the full toolbox XML string for a Blockly workspace.
 *
 * Port of legacy `BlockMirrorBlockEditor.prototype.makeToolbox`:
 * - a preset name found in {@link TOOLBOXES} is resolved to its definition;
 * - a non-string toolbox (a category array, e.g. from `?toolbox.blockpy`) is
 *   converted via {@link toolboxPythonToBlocks}; any other string is used as
 *   the toolbox body verbatim;
 * - every {@link EXTRA_TOOLS} entry is appended;
 * - the result is wrapped in `<xml id="toolbox" style="display:none">`.
 */
export function makeToolboxXml(
  toolbox: ToolboxSpec,
  converter: TextToBlocksConverter,
): string {
  let resolved: ToolboxSpec = toolbox;
  // Use palette if it exists, otherwise assume its a custom one. (legacy)
  if (typeof resolved === 'string' && resolved in TOOLBOXES) {
    resolved = TOOLBOXES[resolved] as ToolboxEntry[];
  }
  // Convert if necessary (legacy)
  if (typeof resolved !== 'string') {
    resolved = toolboxPythonToBlocks(resolved, converter);
  }
  // TODO: Fix Hack, this should be configurable by instance rather than by
  // class (legacy comment; EXTRA_TOOLS is still module-level state here)
  for (const name in EXTRA_TOOLS) {
    resolved += EXTRA_TOOLS[name] as string;
  }
  return '<xml id="toolbox" style="display:none">' + resolved + '</xml>';
}
