import { describe, expect, it } from 'vitest';
import { parseCsv, serializeCsv } from './csv';

describe('csv parse/serialize (M4.4, LD-26)', () => {
  it('round-trips simple tables', () => {
    const text = 'name,age\nAda,36\nAlan,41';
    const rows = parseCsv(text)!;
    expect(rows).toEqual([
      ['name', 'age'],
      ['Ada', '36'],
      ['Alan', '41'],
    ]);
    expect(serializeCsv(rows)).toBe(text);
  });

  it('handles quoted fields, embedded commas/newlines, doubled quotes', () => {
    const rows = parseCsv('a,"b,c"\n"say ""hi""","line1\nline2"')!;
    expect(rows).toEqual([
      ['a', 'b,c'],
      ['say "hi"', 'line1\nline2'],
    ]);
    // Serialization re-quotes exactly what needs quoting.
    expect(serializeCsv(rows)).toBe('a,"b,c"\n"say ""hi""","line1\nline2"');
  });

  it('accepts CRLF rows and trailing newlines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('pads ragged rows to a rectangle', () => {
    expect(parseCsv('a,b,c\n1')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', ''],
    ]);
  });

  it('returns null on an unclosed quote (degrade-to-text signal)', () => {
    expect(parseCsv('a,"unclosed\n1,2')).toBeNull();
  });

  it('empty text parses to a single empty cell', () => {
    expect(parseCsv('')).toEqual([['']]);
  });
});
