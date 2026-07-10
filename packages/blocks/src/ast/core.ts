/**
 * Top-level node converters — the handful defined inline in legacy
 * `text_to_blocks.js` rather than in their own `ast_*.js` files.
 */
import { registerConverter } from '../registry';
import type { Module } from '../ir/types';

registerConverter('Module', function (node: Module) {
  return this.convertBody(node.body, node);
});

registerConverter('Interactive', function (node: Module) {
  return this.convertBody(node.body, node);
});

registerConverter('Expression', function (node: Module) {
  return this.convertBody(node.body, node);
});

registerConverter('Suite', function (node: Module) {
  return this.convertBody(node.body, node);
});

registerConverter('Pass', function () {
  return null; //block("controls_pass");
});
