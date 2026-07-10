// @vitest-environment jsdom
/**
 * Pipeline smoke test: text → IR → Blockly XML → headless workspace →
 * generated Python. The full corpus round-trip suite (§16.1.2) supersedes
 * this once all block modules are ported; this pins the core plumbing.
 */
import { describe, expect, it } from 'vitest';
import './ast/core';
import './ast/astAssign';
import './ast/astNum';
import './ast/astRaw';
import './ast/astComment';
import { TextToBlocksConverter } from './text-to-blocks';
import { xmlToPython } from './blocks-to-text';

function roundTrip(source: string): string {
  const converter = new TextToBlocksConverter();
  const result = converter.convertSource('__main__.py', source);
  expect(result.error).toBeNull();
  return xmlToPython(result.xml).trim();
}

describe('pipeline smoke', () => {
  it('round-trips a simple assignment', () => {
    expect(roundTrip('a = 0')).toBe('a = 0');
  });

  it('round-trips consecutive assignments as one stack', () => {
    expect(roundTrip('a = 0\nb = 1')).toBe('a = 0\nb = 1');
  });

  it('round-trips chained assignment via mutation', () => {
    expect(roundTrip('a = b = 4')).toBe('a = b = 4');
  });

  it('round-trips comments', () => {
    expect(roundTrip('# hello\na = 0')).toBe('# hello\na = 0');
  });

  it('case-sensitive variables stay distinct', () => {
    expect(roundTrip('dog = 1\nDog = 2')).toBe('dog = 1\nDog = 2');
  });

  it('chops unparseable tail into a raw block (legacy retry loop)', () => {
    const converter = new TextToBlocksConverter();
    const result = converter.convertSource('__main__.py', 'a = 0\nb = ');
    // Legacy semantics: the retry loop succeeded on the head, so no error is
    // reported; the bad tail lands in an ast_Raw block.
    expect(result.error).toBeNull();
    expect(result.xml).toContain('ast_Assign');
    expect(result.xml).toContain('ast_Raw');
  });

  it('turns fully-unparseable source into a raw block (no error, legacy)', () => {
    const converter = new TextToBlocksConverter();
    const result = converter.convertSource('__main__.py', 'b = ');
    // Legacy chops the bad line, reaches empty source, and returns without
    // an error — the whole input lands in the ast_Raw block.
    expect(result.error).toBeNull();
    expect(result.xml).toContain('ast_Raw');
    expect(result.xml).not.toContain('ast_Assign');
  });
});
