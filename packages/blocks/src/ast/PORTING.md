# Porting BlockMirror `ast_*.js` modules to `@blockpy/blocks`

Legacy source: `c:/Users/acbar/Projects/blockpy-edu/BlockMirror/src/ast/ast_<Name>.js`
Target: `packages/blocks/src/ast/ast<Name>.ts` (one module per legacy file).

**Fidelity is the requirement.** Message strings, field names, colors, mutation
attribute names, ordering, and generator output must match the legacy code
exactly - the §16.1.2 round-trip suite asserts `text → blocks → text` is an
exact-text fixed point over the BlockMirror corpus. Port comments too. Do NOT
"improve" behavior; quirks are load-bearing.

## Each legacy file has up to three parts

1. **Block definition(s)**
   - `BlockMirrorTextToBlocks.BLOCKS.push({...json})` →
     `defineBlocks({...json})` (import from `../registry`). Multiple pushes →
     one `defineBlocks(a, b, ...)` call or several calls.
   - `Blockly.Blocks['ast_X'] = {...}` → `defineBlock('ast_X', {...})`.
   - Inside imperative definitions, type the block instance loosely:
     `const block = this as AnyDuringMigration` or define a local
     `type XBlock = Blockly.Block & { targetCount_: number; ... }` and use
     `function (this: XBlock) {...}` on each method. `any` is acceptable -
     runtime fidelity beats type elegance.
2. **Generator**: `python.pythonGenerator.forBlock['ast_X'] = function (block, generator) {...}` →
   `generator.forBlock['ast_X'] = function (block) {...}` with
   `import { generator } from '../generator'`.
   - `python.pythonGenerator.ORDER_FOO` → `generator.ORDER_FOO` (they exist
     at runtime; cast `(generator as any).ORDER_FOO` if TS complains - or use
     `Order.FOO` from `../generator` ONLY if the numeric value is identical).
   - `python.pythonGenerator.blank` → `generator.blank`.
   - `python.pythonGenerator.valueToCode/statementToCode/quote_/getVariableName`
     → same methods on `generator`.
3. **Converter**: `BlockMirrorTextToBlocks.prototype['ast_X'] = function (node, parent) {...}` →

   ```ts
   registerConverter('X', function (this: TextToBlocksConverter, node: any, parent: any) {
     ...
   });
   ```

   NOTE the key: the registry dispatches on `node._astname` WITHOUT the
   `ast_` prefix (`'Assign'`, not `'ast_Assign'`). The Blockly block TYPE
   string keeps the `ast_` prefix. Use a plain `function`, never an arrow -
   `this` is the converter instance.

## Imports available

```ts
import * as Blockly from 'blockly/core';
import { COLOR } from '../colors';
import { generator, Order } from '../generator';
import { defineBlock, defineBlocks, registerConverter } from '../registry';
import { createBlock, rawBlock, xmlToString } from '../xml';
import type { TextToBlocksConverter } from '../text-to-blocks';
import type * as ir from '../ir/types';
```

## Mechanical translations

| Legacy                                                                                                                                                                                                                                  | Port                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `Sk.ffi.remapToJs(x)`                                                                                                                                                                                                                   | `x` (IR values are plain JS)            |
| `value === Sk.builtin.none.none$`                                                                                                                                                                                                       | `value === null`                        |
| `value === Sk.builtin.bool.true$` / `false$`                                                                                                                                                                                            | `value === true` / `value === false`    |
| `BlockMirrorTextToBlocks.create_block(...)`                                                                                                                                                                                             | `createBlock(...)` (same arg order)     |
| `BlockMirrorTextToBlocks.raw_block(...)`                                                                                                                                                                                                | `rawBlock(...)`                         |
| `BlockMirrorTextToBlocks.COLOR.X`                                                                                                                                                                                                       | `COLOR.X`                               |
| `BlockMirrorTextToBlocks.xmlToString`                                                                                                                                                                                                   | `xmlToString`                           |
| `this.ast_Comment(txt, lineno)`                                                                                                                                                                                                         | `this.astComment(txt, lineno)`          |
| `this.convert / convertElements / convertBody / isTopLevel / getSourceCode / LOCKED_BLOCK / FUNCTION_SIGNATURES / METHOD_SIGNATURES / MODULE_FUNCTION_SIGNATURES / MODULE_FUNCTION_IMPORTS / hiddenImports / strictAnnotations / COLOR` | same members on `this`                  |
| `document.createElement(...)` (in mutationToDom etc.)                                                                                                                                                                                   | `Blockly.utils.xml.createElement(...)`  |
| `document.createTextNode(...)`                                                                                                                                                                                                          | `Blockly.utils.xml.createTextNode(...)` |
| `Blockly.inputs.Align.RIGHT`                                                                                                                                                                                                            | unchanged (exists in Blockly 11)        |
| `new Blockly.FieldVariable/FieldDropdown/FieldTextInput/FieldNumber/...`                                                                                                                                                                | unchanged                               |
| `Blockly.Extensions.apply(...)`                                                                                                                                                                                                         | unchanged                               |
| `Blockly.Variables.NAME_TYPE`                                                                                                                                                                                                           | `Blockly.Names.NameType.VARIABLE`       |

## IR node shapes (what converters receive)

See `../ir/types.ts`. Skulpt-era names: `Num{n, source}`, `Str{s, source}`,
`Bytes{s}`, `NameConstant{value: null|boolean}`, `Ellipsis`, and pre-3.9
subscripts `Index{value}` / `Slice{lower,upper,step}` / `ExtSlice{dims}`.
Identifiers are plain strings (`node.id`, `node.attr`, `alias.name`,
`arg.arg`, `keyword.arg`). `node.lineno` is 1-based. Empty optional slots are
`null` (not `undefined`): e.g. `Return.value`, `Raise.exc/cause`,
`ExceptHandler.type/name`, `Slice.lower/upper/step`, `arguments.vararg/kwarg`.

## Gotchas

- Field values in `createBlock` are stringified; legacy passed raw JS values -
  behavior matches.
- Mutation keys: `'@name'` → attribute, array value → repeated child elements,
  other keys → `<arg name=...>` children (see `../xml.ts`).
- `updateShape_`/`mutationToDom`/`domToMutation` must be ported exactly -
  workspace deserialization calls them.
- If the legacy file references helpers from other legacy files (e.g.
  `ast_Call` uses `this.FUNCTION_SIGNATURES`), those tables live in
  `./signatures.ts`.
- Do NOT edit `src/ast/index.ts` (the barrel is assembled separately) and do
  NOT edit shared files (`registry.ts`, `xml.ts`, `generator.ts`,
  `text-to-blocks.ts`) - report a blocker instead of changing them.
- Verify with `pnpm --filter @blockpy/blocks typecheck` before finishing.
  `pnpm vitest run` from the repo root must not regress `src/cst` tests.
