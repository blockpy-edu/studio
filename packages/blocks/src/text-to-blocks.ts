/**
 * Text → Blockly-XML orchestrator — port of legacy `text_to_blocks.js`
 * (`BlockMirrorTextToBlocks`), with the Skulpt parser replaced by the Lezer
 * CST → AST-IR pipeline (`cst/to-ast.ts`, maintainer decision, spike S2).
 *
 * The body/comment/peer layout logic is ported statement-for-statement —
 * including its quirks — because the §16.1.2 round-trip corpus asserts the
 * exact block layout it produces (peer grouping on skipped lines, comment
 * level matching by `column / 4`, trailing-comment handling).
 */
import { COLOR } from './colors';
import { getConverter } from './registry';
import { createBlock, rawBlock, xmlToString } from './xml';
import { sourceToAst, AstParseError } from './cst/to-ast';
import type { Module, Stmt } from './ir/types';
import {
  FUNCTION_SIGNATURES,
  METHOD_SIGNATURES,
  MODULE_FUNCTION_IMPORTS,
  MODULE_FUNCTION_SIGNATURES,
} from './ast/signatures';

export interface ConverterConfiguration {
  /** Enables the `Image("...")` constructor block (legacy `imageMode`). */
  imageMode?: boolean;
  /** How string literals are probed for image URLs (legacy default 'string'). */
  imageDetection?: 'constructor' | 'string' | 'none';
}

export interface ConvertSourceResult {
  xml: string;
  error: Error | null;
  rawXml: Element;
  /** line → `${column}|${text-with-#}` (legacy comment map shape). */
  comments?: Record<number, string>;
}

function arrayMax(array: number[]): number {
  return array.reduce((a, b) => Math.max(a, b));
}

function arrayMin(array: number[]): number {
  return array.reduce((a, b) => Math.min(a, b));
}

export class TextToBlocksConverter {
  hiddenImports: string[] = ['plt'];
  strictAnnotations: string[] = ['int', 'float', 'str', 'bool'];
  configuration: ConverterConfiguration;

  // Legacy signature tables, exposed as instance properties because the
  // ported converters reach them through `this`.
  FUNCTION_SIGNATURES = FUNCTION_SIGNATURES;
  METHOD_SIGNATURES = METHOD_SIGNATURES;
  MODULE_FUNCTION_SIGNATURES = MODULE_FUNCTION_SIGNATURES;
  MODULE_FUNCTION_IMPORTS = MODULE_FUNCTION_IMPORTS;

  TOP_LEVEL_NODES = ['Module', 'Expression', 'Interactive', 'Suite'];
  LOCKED_BLOCK = {
    inline: 'true',
    deletable: 'false',
    movable: 'false',
  };
  COLOR = COLOR;

  source: string[] = [];
  comments: Record<number, string> = {};
  heights: number[] = [];
  levelIndex = 0;
  highestLineSeen = 0;

  constructor(configuration: ConverterConfiguration = {}) {
    this.configuration = configuration;
  }

  convertSourceToCodeBlock(pythonSource: string): string {
    const xml = document.createElement('xml');
    xml.appendChild(rawBlock(pythonSource));
    return xmlToString(xml);
  }

  /**
   * Convert Python source to Blockly XML. On a syntax error, legacy chopped
   * lines off from the error line and retried, accumulating the remainder
   * into a raw code block; same loop here, driven by `AstParseError.lineno`.
   */
  convertSource(_filename: string, pythonSource: string): ConvertSourceResult {
    const xml = document.createElement('xml');
    // Attempt parsing - might fail!
    let ast: Module | null = null;
    let comments: { line: number; col: number; text: string }[] = [];
    let error: Error | null = null;
    let badChunks: string[] = [];
    const originalSource = pythonSource;
    this.source = pythonSource.split('\n');
    let previousLine = 1 + this.source.length;
    let startLine = 1;
    while (ast === null) {
      if (pythonSource.trim() === '') {
        if (badChunks.length) {
          xml.appendChild(rawBlock(badChunks.join('\n'), startLine));
        }
        return { xml: xmlToString(xml), error: null, rawXml: xml };
      }
      try {
        const parsed = sourceToAst(pythonSource);
        ast = parsed.ast;
        comments = parsed.comments;
      } catch (e) {
        error = e as Error;
        const lineno = e instanceof AstParseError ? e.lineno : undefined;
        if (lineno && lineno < previousLine) {
          previousLine = lineno - 1;
          badChunks = badChunks.concat(this.source.slice(previousLine));
          startLine += previousLine;
          this.source = this.source.slice(0, previousLine);
          pythonSource = this.source.join('\n');
        } else {
          xml.appendChild(rawBlock(originalSource, startLine));
          return { xml: xmlToString(xml), error, rawXml: xml };
        }
      }
    }
    this.comments = {};
    for (const comment of comments) {
      this.comments[comment.line] = comment.col + '|' + comment.text;
    }
    this.highestLineSeen = 0;
    this.levelIndex = 0;
    this.measureNode(ast);
    const converted = this.convert(ast, undefined);
    if (converted !== null && Array.isArray(converted)) {
      for (let block = 0; block < converted.length; block += 1) {
        xml.appendChild(converted[block]!);
      }
    }
    if (badChunks.length) {
      xml.appendChild(rawBlock(badChunks.join('\n'), startLine));
    }
    return {
      xml: xmlToString(xml),
      error: null,
      comments: this.comments,
      rawXml: xml,
    };
  }

  private recursiveMeasure(node: any, nextBlockLine: number): void {
    if (node === undefined) {
      return;
    }
    let myNext = nextBlockLine;
    if ('orelse' in node && node.orelse.length > 0) {
      if (node.orelse.length === 1 && node.orelse[0]._astname === 'If') {
        myNext = node.orelse[0].lineno - 1;
      } else {
        myNext = node.orelse[0].lineno - 1 - 1;
      }
    }
    this.heights.push(nextBlockLine);
    if ('body' in node) {
      for (let i = 0; i < node.body.length; i++) {
        let next;
        if (i + 1 === node.body.length) {
          next = myNext;
        } else {
          next = node.body[i + 1].lineno - 1;
        }
        this.recursiveMeasure(node.body[i], next);
      }
    }
    if ('orelse' in node) {
      for (let i = 0; i < node.orelse.length; i++) {
        let next;
        if (i === node.orelse.length) {
          next = nextBlockLine;
        } else {
          next = 1 + (node.orelse[i].lineno - 1);
        }
        this.recursiveMeasure(node.orelse[i], next);
      }
    }
  }

  measureNode(node: Module): void {
    this.heights = [];
    this.recursiveMeasure(node, this.source.length - 1);
    this.heights.shift();
  }

  getSourceCode(frm: number, to: number): string {
    const lines = this.source.slice(frm - 1, to);
    // Strip out any starting indentation.
    if (lines.length > 0) {
      const indentation = lines[0]!.search(/\S/);
      for (let i = 0; i < lines.length; i++) {
        lines[i] = lines[i]!.substring(indentation);
      }
    }
    return lines.join('\n');
  }

  isTopLevel(parent: any): boolean {
    return !parent || this.TOP_LEVEL_NODES.indexOf(parent._astname) !== -1;
  }

  convert(node: any, parent: any): Element | Element[] | null {
    const converter = getConverter(node._astname);
    if (converter === undefined) {
      throw new Error('Could not find function: ast_' + node._astname);
    }
    node._parent = parent;
    return converter.call(this, node, parent);
  }

  convertStatement(
    node: Stmt,
    _fullSource: string,
    parent: any,
  ): Element | Element[] | null {
    try {
      return this.convert(node, parent);
    } catch (e) {
      const heights = this.getChunkHeights(node);
      const extractedSource = this.getSourceCode(
        arrayMin(heights),
        arrayMax(heights),
      );
      console.error(e);
      return rawBlock(extractedSource);
    }
  }

  getChunkHeights(node: any): number[] {
    let lineNumbers: number[] = [];
    if (Object.prototype.hasOwnProperty.call(node, 'lineno')) {
      lineNumbers.push(node.lineno);
    }
    if (Object.prototype.hasOwnProperty.call(node, 'body')) {
      for (let i = 0; i < node.body.length; i += 1) {
        lineNumbers = lineNumbers.concat(this.getChunkHeights(node.body[i]));
      }
    }
    if (Object.prototype.hasOwnProperty.call(node, 'orelse')) {
      for (let i = 0; i < node.orelse.length; i += 1) {
        lineNumbers = lineNumbers.concat(this.getChunkHeights(node.orelse[i]));
      }
    }
    return lineNumbers;
  }

  astComment(txt: string, lineno: number): Element {
    const commentText = txt.slice(1);
    return createBlock('ast_Comment', lineno, { BODY: commentText });
  }

  convertElements(
    key: string,
    values: any[],
    parent: any,
  ): Record<string, Element> {
    const output: Record<string, Element> = {};
    for (let i = 0; i < values.length; i++) {
      output[key + i] = this.convert(values[i], parent) as Element;
    }
    return output;
  }

  convertBody(node: Stmt[], parent: any): Element[] {
    this.levelIndex += 1;
    const is_top_level = this.isTopLevel(parent);

    // Final result list
    const children: Element[] = []; // The complete set of peers
    let root: Element | null = null; // The top of the current peer
    let current: Element | null = null; // The bottom of the current peer

    function addPeer(peer: Element): void {
      if (root == null) {
        children.push(peer);
      } else {
        children.push(root);
      }
      root = peer;
      current = peer;
    }

    function finalizePeers(): void {
      if (root != null) {
        children.push(root);
      }
    }

    function nestChild(child: Element): void {
      if (root == null) {
        root = child;
        current = child;
      } else if (current == null) {
        // Legacy quirk preserved: `root = current` (a no-op that leaves the
        // chain untouched when current is null).
        root = current;
      } else {
        const nextElement = document.createElement('next');
        nextElement.appendChild(child);
        current.appendChild(nextElement);
        current = child;
      }
    }

    let lineNumberInBody = 0;
    let lineNumberInProgram: number = 0;
    let previousLineInProgram: number | null = null;
    let distance: number;
    let skipped_line: boolean;
    let previousWasStatement = false;
    let visitedFirstLine = false;

    // Iterate through each node
    for (let i = 0; i < node.length; i++) {
      lineNumberInBody += 1;

      lineNumberInProgram = node[i]!.lineno;
      distance = 0;
      if (previousLineInProgram != null) {
        distance = lineNumberInProgram - previousLineInProgram - 1;
      }
      lineNumberInBody += distance;

      // Handle earlier comments
      for (const commentLineInProgram in this.comments) {
        if (Number(commentLineInProgram) <= lineNumberInProgram) {
          const comment = splitComment(this.comments[commentLineInProgram]!);

          if (parseInt(comment[0], 10) / 4 == this.levelIndex - 1) {
            const commentLine = comment[1];
            const commentChild = this.astComment(
              commentLine,
              Number(commentLineInProgram),
            );
            this.highestLineSeen += 1;

            if (previousLineInProgram == null) {
              nestChild(commentChild);
            } else {
              const skipped_previous_line =
                Math.abs(previousLineInProgram - Number(commentLineInProgram)) >
                1;
              if (is_top_level && skipped_previous_line) {
                addPeer(commentChild);
              } else {
                nestChild(commentChild);
              }
            }
            previousLineInProgram = Number(commentLineInProgram);
            this.highestLineSeen = Math.max(
              this.highestLineSeen,
              parseInt(commentLineInProgram, 10),
            );
            distance = lineNumberInProgram - previousLineInProgram;
            delete this.comments[commentLineInProgram];
          }
          visitedFirstLine = true;
          previousWasStatement = true;
        }
      }

      distance = lineNumberInProgram - this.highestLineSeen;
      this.highestLineSeen = Math.max(lineNumberInProgram, this.highestLineSeen);

      // Now convert the actual node
      const height = this.heights.shift()!;
      const originalSourceCode = this.getSourceCode(lineNumberInProgram, height);
      const newChild = this.convertStatement(node[i]!, originalSourceCode, parent);

      // Skip null blocks (e.g., imports)
      if (newChild == null) {
        continue;
      }

      skipped_line = distance > 1;
      previousLineInProgram = lineNumberInProgram;

      // Handle top-level expression blocks
      if (is_top_level && Array.isArray(newChild)) {
        addPeer(newChild[0]!);
        // Handle skipped line
      } else if (is_top_level && skipped_line && visitedFirstLine) {
        addPeer(newChild as Element);
        // The previous line was not a Peer
      } else if (is_top_level && !previousWasStatement) {
        addPeer(newChild as Element);
        // Otherwise, always embed it in there.
      } else {
        nestChild(newChild as Element);
      }
      previousWasStatement = !Array.isArray(newChild);

      visitedFirstLine = true;
    }

    // Handle comments that are on the very last line
    const lastLineNumber = lineNumberInProgram + 1;
    if (lastLineNumber in this.comments) {
      const comment = splitComment(this.comments[lastLineNumber]!);

      if (parseInt(comment[0], 10) / 4 == this.levelIndex - 1) {
        const lastComment = comment[1];
        const commentChild = this.astComment(lastComment, lastLineNumber);

        if (is_top_level && !previousWasStatement) {
          addPeer(commentChild);
        } else {
          nestChild(commentChild);
        }
        delete this.comments[lastLineNumber];
        this.highestLineSeen += 1;
      }
    }

    // Handle any extra comments that stuck around
    if (is_top_level) {
      for (const commentLineInProgram in this.comments) {
        const comment = splitComment(this.comments[commentLineInProgram]!);

        if (parseInt(comment[0], 10) / 4 == this.levelIndex - 1) {
          const commentInProgram = comment[1];
          const commentChild = this.astComment(
            commentInProgram,
            Number(commentLineInProgram),
          );

          distance = Number(commentLineInProgram) - (previousLineInProgram ?? 0);

          if (previousLineInProgram == null) {
            addPeer(commentChild);
          } else if (distance > 1) {
            addPeer(commentChild);
          } else {
            nestChild(commentChild);
          }

          previousLineInProgram = Number(commentLineInProgram);
          // Legacy quirk preserved: deletes the *last-line* key, not the
          // comment's own key; the for-in snapshot keeps this terminating.
          delete this.comments[lastLineNumber];
        }
      }
    }

    finalizePeers();

    this.levelIndex -= 1;

    return children;
  }
}

/**
 * Split a `${col}|${text}` comment-map entry at the FIRST `|` only. Legacy
 * used `String.split('|', 2)`, which silently truncated comment text
 * containing `|`; splitting on the first separator preserves it (the map
 * shape is internal to this module, so no behavioral surface changes).
 */
function splitComment(entry: string): [string, string] {
  const idx = entry.indexOf('|');
  return [entry.slice(0, idx), entry.slice(idx + 1)];
}
