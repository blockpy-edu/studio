/**
 * Textbook document format (spec §11.4) - port of blockpy-server
 * models/data_formats/textbook.py (v1 schema):
 *
 *   { version: 1, settings: {}, content: [Item] }
 *   Item: { header?, reading?, group?, content?: [Item] }
 *
 * On the wire (`assignment.instructions`) `reading`/`group` are URL
 * STRINGS; the server's textbook route rehydrates them to
 * `{name, url, id, missing}` (rehydrate_textbook_v1) before rendering.
 * `load_assignment` performs NO rehydration, so a client-side textbook
 * must resolve urls itself (the Textbook component takes a resolver;
 * unresolvable entries render as the legacy MISSING_READING_V1 -
 * ledger LD-16).
 */

export interface TextbookAssignmentRef {
  id: number | null;
  url: string;
  name: string;
  /** rehydrate_textbook_v1: referenced url not found. */
  missing: boolean;
}

export interface TextbookItem {
  header: string | null;
  reading: TextbookAssignmentRef | null;
  /** Groups are grade-mode metadata; the sidebar never renders them
   *  (textbook.html's macro has no group branch). */
  group: TextbookAssignmentRef | null;
  content: TextbookItem[];
}

export interface TextbookDocument {
  version: number;
  settings: Record<string, unknown>;
  content: TextbookItem[];
}

export class InvalidTextbookSchema extends Error {}

/** MISSING_READING_V1 (textbook.py:94-97). */
export const MISSING_READING = { name: 'Missing Reading', missing: true } as const;

const asRef = (value: unknown): TextbookAssignmentRef | null => {
  if (typeof value === 'string') {
    // Unrehydrated wire form: the url slug doubles as the display name
    // until (unless) the resolver rehydrates it.
    return { id: null, url: value, name: value, missing: false };
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      id: typeof record['id'] === 'number' ? record['id'] : null,
      url: String(record['url'] ?? ''),
      name: String(record['name'] ?? ''),
      missing: record['missing'] === true,
    };
  }
  return null;
};

const parseItem = (value: unknown): TextbookItem => {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    header: typeof record['header'] === 'string' ? record['header'] : null,
    reading: 'reading' in record ? asRef(record['reading']) : null,
    group: 'group' in record ? asRef(record['group']) : null,
    content: Array.isArray(record['content']) ? record['content'].map(parseItem) : [],
  };
};

/**
 * Parse `assignment.instructions` into the document. Mirrors
 * load_as_textbook + the version guard (search_textbook_for_key raises
 * InvalidTextbookSchema on unknown versions, textbook.py:68-72).
 */
export function parseTextbookDocument(instructions: string): TextbookDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(instructions || '{}');
  } catch (error) {
    throw new InvalidTextbookSchema(`Invalid textbook JSON: ${String(error)}`);
  }
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const version = typeof record['version'] === 'number' ? record['version'] : 1;
  if (version !== 1) {
    throw new InvalidTextbookSchema('Unknown or missing version');
  }
  return {
    version,
    settings:
      typeof record['settings'] === 'object' && record['settings'] !== null
        ? (record['settings'] as Record<string, unknown>)
        : {},
    content: Array.isArray(record['content']) ? record['content'].map(parseItem) : [],
  };
}

/** Depth-first walk (search_textbook_for_key_v1 order). */
export function* walkItems(items: TextbookItem[]): Generator<TextbookItem> {
  for (const item of items) {
    yield item;
    yield* walkItems(item.content);
  }
}

/** The default first page - the first reading in document order (the
 *  server's default_first_page). */
export function firstReading(doc: TextbookDocument): TextbookAssignmentRef | null {
  for (const item of walkItems(doc.content)) {
    if (item.reading && !item.reading.missing) return item.reading;
  }
  return null;
}

/** `?page=` boot resolution: by url first, then by numeric id
 *  (assignments.py:100-112). */
export function findReadingByPage(
  doc: TextbookDocument,
  page: string,
): TextbookAssignmentRef | null {
  for (const item of walkItems(doc.content)) {
    if (item.reading && !item.reading.missing && item.reading.url === page) {
      return item.reading;
    }
  }
  const numeric = Number.parseInt(page, 10);
  if (!Number.isNaN(numeric)) {
    for (const item of walkItems(doc.content)) {
      if (item.reading && item.reading.id === numeric) return item.reading;
    }
  }
  return null;
}
