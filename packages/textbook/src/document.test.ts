/**
 * Textbook document conformance (models/data_formats/textbook.py):
 * v1 parsing, version guard, walk order, first-page and ?page= lookup.
 */
import { describe, expect, it } from 'vitest';
import {
  InvalidTextbookSchema,
  findReadingByPage,
  firstReading,
  parseTextbookDocument,
  walkItems,
} from './document';

const DOC = JSON.stringify({
  version: 1,
  settings: {},
  content: [
    {
      header: 'Chapter 1) Introduction',
      content: [
        { reading: 'intro_primer_read' },
        {
          header: 'Part A',
          group: 'intro_a',
          content: [{ reading: 'intro_basics_read' }, { reading: 'intro_missing_read' }],
        },
      ],
    },
  ],
});

describe('parseTextbookDocument', () => {
  it('parses the v1 shape, normalizing url-string references', () => {
    const doc = parseTextbookDocument(DOC);
    expect(doc.version).toBe(1);
    expect(doc.content).toHaveLength(1);
    const chapter = doc.content[0]!;
    expect(chapter.header).toBe('Chapter 1) Introduction');
    expect(chapter.content[0]!.reading).toEqual({
      id: null,
      url: 'intro_primer_read',
      name: 'intro_primer_read',
      missing: false,
    });
    expect(chapter.content[1]!.group).toMatchObject({ url: 'intro_a' });
  });

  it('accepts rehydrated object references (server-shaped)', () => {
    const doc = parseTextbookDocument(
      JSON.stringify({
        version: 1,
        content: [{ reading: { id: 9, url: 'r', name: 'Reading', missing: false } }],
      }),
    );
    expect(doc.content[0]!.reading).toEqual({ id: 9, url: 'r', name: 'Reading', missing: false });
  });

  it('defaults a missing version to 1 (textbook.py:69 get default)', () => {
    expect(parseTextbookDocument('{"content": []}').version).toBe(1);
  });

  it('raises InvalidTextbookSchema on unknown versions and bad JSON', () => {
    expect(() => parseTextbookDocument('{"version": 2}')).toThrow(InvalidTextbookSchema);
    expect(() => parseTextbookDocument('nope{')).toThrow(InvalidTextbookSchema);
  });
});

describe('lookup helpers', () => {
  const doc = parseTextbookDocument(DOC);
  // Simulate rehydration.
  const items = [...walkItems(doc.content)];
  for (const item of items) {
    if (item.reading?.url === 'intro_primer_read') {
      item.reading = { id: 201, url: 'intro_primer_read', name: 'Primer', missing: false };
    } else if (item.reading?.url === 'intro_basics_read') {
      item.reading = { id: 202, url: 'intro_basics_read', name: 'Basics', missing: false };
    } else if (item.reading) {
      item.reading = { ...item.reading, name: 'Missing Reading', missing: true };
    }
  }

  it('walks depth-first in document order (search_textbook_for_key_v1)', () => {
    const readings = items.filter((item) => item.reading).map((item) => item.reading!.url);
    expect(readings).toEqual(['intro_primer_read', 'intro_basics_read', 'intro_missing_read']);
  });

  it('firstReading skips missing entries', () => {
    expect(firstReading(doc)?.id).toBe(201);
  });

  it('findReadingByPage matches by url, then by numeric id (assignments.py:100-112)', () => {
    expect(findReadingByPage(doc, 'intro_basics_read')?.id).toBe(202);
    expect(findReadingByPage(doc, '201')?.id).toBe(201);
    expect(findReadingByPage(doc, 'unknown')).toBeNull();
  });
});
