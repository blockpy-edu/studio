/**
 * Known function/method signature tables - port of legacy
 * `ast/ast_functions.js`. Drives ast_Call's "known function" block shapes.
 *
 * Also home to:
 *  - the `ast_Image` CUSTOM call converter (legacy
 *    `BlockMirrorTextToBlocks['ast_Image']`, stored under
 *    `FUNCTION_SIGNATURES['Image'].custom`). NOTE: the `ast_Image` Blockly
 *    block definition and generator live in legacy `ast_Str.js` and are
 *    ported with `astStr.ts`, not here.
 *  - `getFunctionBlock` (legacy `BlockMirrorTextToBlocks.getFunctionBlock`
 *    static), used to build toolbox entries.
 */
import { COLOR } from '../colors';
import { createBlock, xmlToString } from '../xml';
import type { MutationValue } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';

/**
 * Custom call converter contract (legacy `signature.custom`):
 * ast_Call invokes `signature.custom(node, parent, converter)` inside a
 * try/catch and returns its result directly; THROWING falls back to the
 * default ast_Call rendering (legacy behavior - the legacy handler threw
 * plain strings; we throw `Error`s, which the catch treats identically).
 */
export type CustomCallConverter = (
  node: ir.Call,
  parent: unknown,
  converter: TextToBlocksConverter,
) => Element | Element[];

export interface FunctionSignature {
  returns?: boolean;
  simple?: string[];
  full?: string[];
  message?: string;
  premessage?: string;
  colour?: number;
  custom?: CustomCallConverter;
}

/** Legacy `BlockMirrorTextToBlocks['ast_Image']` custom call handler. */
export const astImage: CustomCallConverter = function (node, _parent, bmttb) {
  if (!bmttb.configuration.imageMode) {
    throw new Error('Not using image constructor');
  }
  if (node.args.length !== 1) {
    throw new Error('More than one argument to Image constructor');
  }
  if (node.args[0]!._astname !== 'Str') {
    throw new Error('First argument for Image constructor must be string literal');
  }
  return createBlock(
    'ast_Image',
    node.lineno,
    {},
    {},
    {},
    {
      '@src': (node.args[0] as ir.Str).s,
    },
  );
};

export const FUNCTION_SIGNATURES: Record<string, FunctionSignature> = {
  abs: {
    returns: true,
    full: ['x'],
    colour: COLOR.MATH,
  },
  all: { returns: true, colour: COLOR.LOGIC },
  any: { returns: true, colour: COLOR.LOGIC },
  ascii: { returns: true, colour: COLOR.TEXT },
  bin: { returns: true, colour: COLOR.MATH },
  bool: { returns: true, colour: COLOR.LOGIC, simple: ['x'] },
  breakpoint: { returns: false, colour: COLOR.PYTHON },
  bytearray: { returns: true, colour: COLOR.TEXT },
  bytes: { returns: true, colour: COLOR.TEXT },
  callable: { returns: true, colour: COLOR.LOGIC },
  chr: { returns: true, colour: COLOR.TEXT },
  classmethod: { returns: true, colour: COLOR.OO },
  compile: { returns: false, colour: COLOR.PYTHON },
  complex: { returns: true, colour: COLOR.MATH },
  delattr: { returns: false, colour: COLOR.VARIABLES },
  dict: { returns: true, colour: COLOR.DICTIONARY },
  dir: { returns: true, colour: COLOR.PYTHON },
  divmod: { returns: true, colour: COLOR.MATH },
  enumerate: { returns: true, colour: COLOR.SEQUENCES },
  eval: { returns: true, colour: COLOR.PYTHON },
  exec: { returns: false, colour: COLOR.PYTHON },
  filter: { returns: true, colour: COLOR.SEQUENCES },
  float: { returns: true, colour: COLOR.MATH, simple: ['x'] },
  format: { returns: true, colour: COLOR.TEXT },
  frozenset: { returns: true, colour: COLOR.SEQUENCES },
  getattr: { returns: true, colour: COLOR.OO },
  globals: { returns: true, colour: COLOR.VARIABLES },
  hasattr: { returns: true, colour: COLOR.OO },
  hash: { returns: true, colour: COLOR.MATH },
  help: { returns: true, colour: COLOR.PYTHON },
  hex: { returns: true, colour: COLOR.MATH },
  id: { returns: true, colour: COLOR.PYTHON },
  Image: { custom: astImage },
  input: { returns: true, colour: COLOR.FILE, simple: ['prompt'] },
  int: { returns: true, colour: COLOR.MATH, simple: ['x'] },
  isinstance: { returns: true, colour: COLOR.LOGIC },
  issubclass: { returns: true, colour: COLOR.LOGIC },
  iter: { returns: true, colour: COLOR.SEQUENCES },
  len: { returns: true, colour: COLOR.SEQUENCES },
  list: { returns: true, colour: COLOR.LIST },
  locals: { returns: true, colour: COLOR.VARIABLES },
  map: { returns: true, colour: COLOR.SEQUENCES },
  max: { returns: true, colour: COLOR.MATH },
  memoryview: { returns: true, colour: COLOR.PYTHON },
  min: { returns: true, colour: COLOR.MATH },
  next: { returns: true, colour: COLOR.SEQUENCES },
  object: { returns: true, colour: COLOR.OO },
  oct: { returns: true, colour: COLOR.MATH },
  open: { returns: true, colour: COLOR.FILE },
  ord: { returns: true, colour: COLOR.TEXT },
  pow: { returns: true, colour: COLOR.MATH },
  print: {
    returns: false,
    colour: COLOR.FILE,
    simple: ['message'],
    full: ['*messages', 'sep', 'end', 'file', 'flush'],
  },
  property: { returns: true, colour: COLOR.OO },
  range: {
    returns: true,
    colour: COLOR.SEQUENCES,
    simple: ['stop'],
    full: ['start', 'stop', 'step'],
  },
  repr: { returns: true, colour: COLOR.TEXT },
  reversed: { returns: true, colour: COLOR.SEQUENCES },
  round: {
    returns: true,
    colour: COLOR.MATH,
    full: ['x', 'ndigits'],
    simple: ['x'],
  },
  set: { returns: true, colour: COLOR.SET },
  setattr: {
    returns: false,
    full: ['object', 'name', 'value'],
    colour: COLOR.OO,
  },
  slice: { returns: true, colour: COLOR.SEQUENCES },
  sorted: {
    full: ['iterable', '*', '**key', '**reverse'],
    simple: ['iterable'],
    returns: true,
    colour: COLOR.SEQUENCES,
  },
  staticmethod: { returns: true, colour: COLOR.OO },
  str: { returns: true, colour: COLOR.TEXT, simple: ['x'] },
  sum: { returns: true, colour: COLOR.MATH },
  super: { returns: true, colour: COLOR.OO },
  tuple: { returns: true, colour: COLOR.TUPLE },
  type: { returns: true, colour: COLOR.OO },
  vars: { returns: true, colour: COLOR.VARIABLES },
  zip: { returns: true, colour: COLOR.SEQUENCES },
  __import__: { returns: false, colour: COLOR.PYTHON },
};

export const METHOD_SIGNATURES: Record<string, FunctionSignature> = {
  conjugate: { returns: true, colour: COLOR.MATH },
  trunc: { returns: true, colour: COLOR.MATH },
  floor: { returns: true, colour: COLOR.MATH },
  ceil: { returns: true, colour: COLOR.MATH },
  bit_length: { returns: true, colour: COLOR.MATH },
  to_bytes: { returns: true, colour: COLOR.MATH },
  from_bytes: { returns: true, colour: COLOR.MATH },
  as_integer_ratio: { returns: true, colour: COLOR.MATH },
  is_integer: { returns: true, colour: COLOR.MATH },
  hex: { returns: true, colour: COLOR.MATH },
  fromhex: { returns: true, colour: COLOR.MATH },
  __iter__: { returns: true, colour: COLOR.SEQUENCES },
  __next__: { returns: true, colour: COLOR.SEQUENCES },
  index: { returns: true, colour: COLOR.LIST },
  count: { returns: true, colour: COLOR.LIST },
  append: {
    returns: false,
    full: ['x'],
    message: 'append',
    premessage: 'to list',
    colour: COLOR.LIST,
  },
  clear: { returns: false, colour: COLOR.SEQUENCES },
  copy: { returns: true, colour: COLOR.LIST },
  extend: { returns: false, colour: COLOR.LIST },
  insert: { returns: false, colour: COLOR.LIST },
  pop: { returns: true, colour: COLOR.SEQUENCES },
  remove: { returns: false, colour: COLOR.SEQUENCES },
  reverse: { returns: false, colour: COLOR.LIST },
  sort: { returns: false, colour: COLOR.LIST },
  capitalize: { returns: true, colour: COLOR.TEXT },
  casefold: { returns: true, colour: COLOR.TEXT },
  center: { returns: true, colour: COLOR.TEXT },
  encode: { returns: true, colour: COLOR.TEXT },
  endswith: { returns: true, colour: COLOR.TEXT },
  expandtabs: { returns: true, colour: COLOR.TEXT },
  find: { returns: true, colour: COLOR.TEXT },
  format: { returns: true, colour: COLOR.TEXT },
  format_map: { returns: true, colour: COLOR.TEXT },
  isalnum: { returns: true, colour: COLOR.TEXT },
  isalpha: { returns: true, colour: COLOR.TEXT },
  isascii: { returns: true, colour: COLOR.TEXT },
  isdecimal: { returns: true, colour: COLOR.TEXT },
  isdigit: { returns: true, colour: COLOR.TEXT },
  isidentifier: { returns: true, colour: COLOR.TEXT },
  islower: { returns: true, colour: COLOR.TEXT },
  isnumeric: { returns: true, colour: COLOR.TEXT },
  isprintable: { returns: true, colour: COLOR.TEXT },
  isspace: { returns: true, colour: COLOR.TEXT },
  istitle: { returns: true, colour: COLOR.TEXT },
  isupper: { returns: true, colour: COLOR.TEXT },
  join: { returns: true, colour: COLOR.TEXT },
  ljust: { returns: true, colour: COLOR.TEXT },
  lower: { returns: true, colour: COLOR.TEXT },
  lstrip: { returns: true, colour: COLOR.TEXT },
  maketrans: { returns: true, colour: COLOR.TEXT },
  partition: { returns: true, colour: COLOR.TEXT },
  replace: {
    returns: true,
    full: ['old', 'new', 'count'],
    simple: ['old', 'new'],
    colour: COLOR.TEXT,
  },
  rfind: { returns: true, colour: COLOR.TEXT },
  rindex: { returns: true, colour: COLOR.TEXT },
  rjust: { returns: true, colour: COLOR.TEXT },
  rpartition: { returns: true, colour: COLOR.TEXT },
  rsplit: { returns: true, colour: COLOR.TEXT },
  rstrip: { returns: true, colour: COLOR.TEXT },
  split: { returns: true, colour: COLOR.TEXT },
  splitlines: { returns: true, colour: COLOR.TEXT },
  startswith: { returns: true, colour: COLOR.TEXT },
  strip: { returns: true, colour: COLOR.TEXT },
  swapcase: { returns: true, colour: COLOR.TEXT },
  title: { returns: true, colour: COLOR.TEXT },
  translate: { returns: true, colour: COLOR.TEXT },
  upper: { returns: true, colour: COLOR.TEXT },
  zfill: { returns: true, colour: COLOR.TEXT },
  decode: { returns: true, colour: COLOR.TEXT },
  __eq__: { returns: true, colour: COLOR.LOGIC },
  tobytes: { returns: true, colour: COLOR.PYTHON },
  tolist: { returns: true, colour: COLOR.PYTHON },
  release: { returns: false, colour: COLOR.PYTHON },
  cast: { returns: false, colour: COLOR.PYTHON },
  isdisjoint: { returns: true, colour: COLOR.SET },
  issubset: { returns: true, colour: COLOR.SET },
  issuperset: { returns: true, colour: COLOR.SET },
  union: { returns: true, colour: COLOR.SET },
  intersection: { returns: true, colour: COLOR.SET },
  difference: { returns: true, colour: COLOR.SET },
  symmetric_difference: { returns: true, colour: COLOR.SET },
  update: { returns: false, colour: COLOR.SET },
  intersection_update: { returns: false, colour: COLOR.SET },
  difference_update: { returns: false, colour: COLOR.SET },
  symmetric_difference_update: { returns: false, colour: COLOR.SET },
  add: { returns: false, colour: COLOR.SET },
  discard: { returns: false, colour: COLOR.SET },
  fromkeys: { returns: true, colour: COLOR.DICTIONARY },
  get: { returns: true, colour: COLOR.DICTIONARY },
  items: { returns: true, colour: COLOR.DICTIONARY },
  keys: { returns: true, colour: COLOR.DICTIONARY },
  popitem: { returns: true, colour: COLOR.DICTIONARY },
  setdefault: { returns: false, colour: COLOR.DICTIONARY },
  values: { returns: true, colour: COLOR.DICTIONARY },
  __enter__: { returns: true, colour: COLOR.CONTROL },
  __exit__: { returns: true, colour: COLOR.CONTROL },
  mro: { returns: true, colour: COLOR.OO },
  __subclasses__: { returns: true, colour: COLOR.OO },
};

export const MODULE_FUNCTION_IMPORTS: Record<string, string> = {
  plt: 'import matplotlib.pyplot as plt',
  turtle: 'import turtle',
};

export const MODULE_FUNCTION_SIGNATURES: Record<string, Record<string, FunctionSignature>> = {
  cisc108: {
    assert_equal: {
      returns: false,
      simple: ['left', 'right'],
      message: 'assert_equal',
      colour: COLOR.PYTHON,
    },
  },
  turtle: {},
  plt: {
    show: {
      returns: false,
      simple: [],
      message: 'show plot canvas',
      colour: COLOR.PLOTTING,
    },
    hist: {
      returns: false,
      simple: ['values'],
      message: 'plot histogram',
      colour: COLOR.PLOTTING,
    },
    bar: {
      returns: false,
      simple: ['xs', 'heights', '*tick_label'],
      message: 'plot bar chart',
      colour: COLOR.PLOTTING,
    },
    plot: {
      returns: false,
      simple: ['values'],
      message: 'plot line',
      colour: COLOR.PLOTTING,
    },
    boxplot: {
      returns: false,
      simple: ['values'],
      message: 'plot boxplot',
      colour: COLOR.PLOTTING,
    },
    hlines: {
      returns: false,
      simple: ['y', 'xmin', 'xmax'],
      message: 'plot horizontal line',
      colour: COLOR.PLOTTING,
    },
    vlines: {
      returns: false,
      simple: ['x', 'ymin', 'ymax'],
      message: 'plot vertical line',
      colour: COLOR.PLOTTING,
    },
    scatter: {
      returns: false,
      simple: ['xs', 'ys'],
      message: 'plot scatter',
      colour: COLOR.PLOTTING,
    },
    title: {
      returns: false,
      simple: ['label'],
      message: "make plot's title",
      colour: COLOR.PLOTTING,
    },
    xlabel: {
      returns: false,
      simple: ['label'],
      message: "make plot's x-axis label",
      colour: COLOR.PLOTTING,
    },
    ylabel: {
      returns: false,
      simple: ['label'],
      message: "make plot's y-axis label",
      colour: COLOR.PLOTTING,
    },
    xticks: {
      returns: false,
      simple: ['xs', 'labels', '*rotation'],
      message: 'make x ticks',
      colour: COLOR.PLOTTING,
    },
    yticks: {
      returns: false,
      simple: ['ys', 'labels', '*rotation'],
      message: 'make y ticks',
      colour: COLOR.PLOTTING,
    },
  },
};

// Legacy shared the same signature object between the bare name and the
// cisc108 module entry (reference identity preserved).
FUNCTION_SIGNATURES['assert_equal'] = MODULE_FUNCTION_SIGNATURES['cisc108']!['assert_equal']!;

function makeTurtleBlock(
  name: string,
  returns: boolean,
  values: string[],
  message: string,
  aliases: string[],
): void {
  MODULE_FUNCTION_SIGNATURES['turtle']![name] = {
    returns: returns,
    simple: values,
    message: message,
    colour: COLOR.PLOTTING,
  };
  if (aliases) {
    aliases.forEach(function (alias) {
      MODULE_FUNCTION_SIGNATURES['turtle']![alias] = MODULE_FUNCTION_SIGNATURES['turtle']![name]!;
    });
  }
}

makeTurtleBlock('forward', false, ['amount'], 'move turtle forward by', ['fd']);
makeTurtleBlock('backward', false, ['amount'], 'move turtle backward by', ['bd']);
makeTurtleBlock('right', false, ['angle'], 'turn turtle right by', ['rt']);
makeTurtleBlock('left', false, ['angle'], 'turn turtle left by', ['lt']);
makeTurtleBlock('goto', false, ['x', 'y'], 'move turtle to position', ['setpos', 'setposition']);
makeTurtleBlock('setx', false, ['x'], "set turtle's x position to ", []);
makeTurtleBlock('sety', false, ['y'], "set turtle's y position to ", []);
makeTurtleBlock('setheading', false, ['angle'], "set turtle's heading to ", ['seth']);
makeTurtleBlock('home', false, [], 'move turtle to origin ', []);
makeTurtleBlock('circle', false, ['radius'], 'move the turtle in a circle ', []);
makeTurtleBlock('dot', false, ['size', 'color'], 'turtle draws a dot ', []);
makeTurtleBlock('stamp', true, [], 'stamp a copy of the turtle shape ', []);
makeTurtleBlock('clearstamp', false, ['stampid'], 'delete stamp with id ', []);
makeTurtleBlock('clearstamps', false, [], 'delete all stamps ', []);
makeTurtleBlock('undo', false, [], 'undo last turtle action ', []);
makeTurtleBlock('speed', true, ['x'], 'set or get turtle speed', []);
makeTurtleBlock('position', true, [], "get turtle's position ", ['pos']);
makeTurtleBlock('towards', true, ['x', 'y'], 'get the angle from the turtle to the point ', []);
makeTurtleBlock('xcor', true, [], "get turtle's x position ", []);
makeTurtleBlock('ycor', true, [], "get turtle's y position ", []);
makeTurtleBlock('heading', true, [], "get turtle's heading ", []);
makeTurtleBlock('distance', true, ['x', 'y'], "get the distance from turtle's position to ", []);
makeTurtleBlock('degrees', false, [], 'set turtle mode to degrees', []);
makeTurtleBlock('radians', false, [], 'set turtle mode to radians', []);
makeTurtleBlock('pendown', false, [], 'pull turtle pen down ', ['pd', 'down']);
makeTurtleBlock('penup', false, [], 'pull turtle pen up ', ['pu', 'up']);
// Skipped some
makeTurtleBlock('pensize', false, [], 'set or get the pen size ', ['width']);
// Skipped some
makeTurtleBlock('pencolor', false, [], 'set or get the pen color ', []);
makeTurtleBlock('fillcolor', false, [], 'set or get the fill color ', []);
makeTurtleBlock('reset', false, [], 'reset drawing', []);
makeTurtleBlock('clear', false, [], 'clear drawing', []);
makeTurtleBlock('write', false, ['message'], 'write text ', []);
// Skipped some
makeTurtleBlock('bgpic', false, ['url'], 'set background to ', []);
makeTurtleBlock('done', false, [], 'start the turtle loop ', ['mainloop']);
makeTurtleBlock('setup', false, ['width', 'height'], 'set drawing area size ', []);
makeTurtleBlock('title', false, ['message'], 'set title of drawing area ', []);
makeTurtleBlock('bye', false, [], 'say goodbye to turtles ', []);

// `matplotlib.pyplot.*` shares the `plt` table (reference identity preserved).
MODULE_FUNCTION_SIGNATURES['matplotlib.pyplot'] = MODULE_FUNCTION_SIGNATURES['plt']!;

/**
 * Build the toolbox XML for a known function/method/module-function call -
 * port of the legacy `BlockMirrorTextToBlocks.getFunctionBlock` static.
 * `.name` selects a METHOD_SIGNATURES entry; `module` selects from
 * MODULE_FUNCTION_SIGNATURES.
 */
export function getFunctionBlock(
  name: string,
  values?: Record<string, Element | null>,
  module?: string,
): string {
  if (values === undefined) {
    values = {};
  }
  // TODO: hack, we shouldn't be accessing the prototype like this
  let signature: FunctionSignature;
  let method = false;
  if (module !== undefined) {
    signature = MODULE_FUNCTION_SIGNATURES[module]![name]!;
  } else if (name.startsWith('.')) {
    signature = METHOD_SIGNATURES[name.substr(1)]!;
    method = true;
  } else {
    signature = FUNCTION_SIGNATURES[name]!;
  }
  const args =
    signature.simple !== undefined
      ? signature.simple
      : signature.full !== undefined
        ? signature.full
        : [];
  const argumentsMutation: Record<string, MutationValue> = {
    '@arguments': args.length,
    '@returns': signature.returns || false,
    '@parameters': true,
    '@method': method,
    '@name': module ? module + '.' + name : name,
    '@message': signature.message ? signature.message : name,
    '@premessage': signature.premessage ? signature.premessage : '',
    '@colour': signature.colour ? signature.colour : 0,
    '@module': module || '',
  };
  for (let i = 0; i < args.length; i += 1) {
    argumentsMutation['UNKNOWN_ARG:' + i] = null;
  }
  const newBlock = createBlock('ast_Call', null, {}, values, { inline: true }, argumentsMutation);
  // Return as either statement or expression
  return xmlToString(newBlock);
}
