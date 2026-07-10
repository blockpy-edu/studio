/**
 * Block palette hues — verbatim from legacy `text_to_blocks.js`
 * (`BlockMirrorTextToBlocks.COLOR`). These are Blockly HSV hue numbers and a
 * B6 visual-parity conformance target (docs/appendices/A8-ui-parity.md).
 */
export const COLOR = {
  VARIABLES: 225,
  FUNCTIONS: 210,
  OO: 240,
  CONTROL: 270,
  MATH: 190,
  TEXT: 120,
  FILE: 170,
  PLOTTING: 140,
  LOGIC: 345,
  PYTHON: 60,
  EXCEPTIONS: 300,
  SEQUENCES: 15,
  LIST: 30,
  DICTIONARY: 0,
  SET: 10,
  TUPLE: 20,
} as const;
