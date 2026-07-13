/**
 * @blockpy/textbook — chaptered reading navigation (spec §11.4), a thin
 * composition over `reader` following templates/blockpy/textbook.html
 * (M2.5 decision; the legacy knockout component shipped unfinished —
 * ledger LD-15).
 */
export { Textbook } from './Textbook';
export type { TextbookAssignment, TextbookLoadResult, TextbookProps } from './Textbook';
export {
  InvalidTextbookSchema,
  MISSING_READING,
  findReadingByPage,
  firstReading,
  parseTextbookDocument,
  walkItems,
} from './document';
export type { TextbookAssignmentRef, TextbookDocument, TextbookItem } from './document';

export const PACKAGE_NAME = '@blockpy/textbook';
