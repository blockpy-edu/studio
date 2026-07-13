/**
 * Minimal RFC-4180-ish CSV parse/serialize for the grid editor (M4.4;
 * STUDIO EXTENSION, LD-26). Deliberately small: quoted fields, doubled
 * quotes, CRLF/LF rows. `parseCsv` returns null on structural failure
 * (unclosed quote) — the CodingEditor then degrades to the text editor.
 */

export function parseCsv(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (ch === ',') {
      pushField();
      i += 1;
    } else if (ch === '\n') {
      pushRow();
      i += 1;
    } else if (ch === '\r') {
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (inQuotes) return null;
  // Trailing newline means the last row was already pushed; otherwise flush.
  if (field !== '' || row.length > 0) pushRow();
  if (rows.length === 0) rows.push(['']);
  // Ragged rows are permitted in the wild — pad to the widest so the grid
  // is rectangular (serialization keeps the padding, a lossy-but-visible
  // normalization the editor surfaces immediately).
  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) {
    while (r.length < width) r.push('');
  }
  return rows;
}

export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','),
    )
    .join('\n');
}
