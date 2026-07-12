/**
 * Pedal feedback category → badge class / display text mapping — port of
 * legacy `blockpy.js:724-783` (A8 §4.5). Class names are legacy CSS hooks
 * (spec §9.6); colors live in styles/blockpy.css.
 */
export interface CategoryPresentation {
  badgeClass: string;
  displayText: string;
}

const MAPPING: Record<string, CategoryPresentation> = {
  none: { badgeClass: 'label-none', displayText: '' },
  runtime: { badgeClass: 'label-runtime-error', displayText: 'Runtime Error' },
  syntax: { badgeClass: 'label-syntax-error', displayText: 'Syntax Error' },
  editor: { badgeClass: 'label-syntax-error', displayText: 'Editor Error' },
  internal: {
    badgeClass: 'label-internal-error',
    displayText: 'Internal Error',
  },
  semantic: {
    badgeClass: 'label-semantic-error',
    displayText: 'Algorithm Error',
  },
  analyzer: {
    badgeClass: 'label-semantic-error',
    displayText: 'Algorithm Error',
  },
  // Pedal 3's ACTUAL literal for TIFA/analyzer feedback is `algorithmic`
  // (pedal/core/feedback_category.py) — the missing-badge bug (M3.2).
  algorithmic: {
    badgeClass: 'label-semantic-error',
    displayText: 'Algorithm Error',
  },
  feedback: { badgeClass: 'label-feedback-error', displayText: 'Instructions' },
  instructor: {
    badgeClass: 'label-feedback-error',
    displayText: 'Incorrect Answer',
  },
  complete: { badgeClass: 'label-problem-complete', displayText: 'Complete' },
  instructions: { badgeClass: 'label-instructions', displayText: 'Instructions' },
  'no errors': { badgeClass: 'label-no-errors', displayText: 'No errors' },
  // Categories legacy left badge-less (fell to label-none) — ledger LD-19.
  // Names are the Pedal 3 literals (pedal/core/feedback_category.py);
  // badge classes reuse the existing legacy color hooks.
  mistakes: { badgeClass: 'label-semantic-error', displayText: 'Mistake' },
  specification: {
    badgeClass: 'label-feedback-error',
    displayText: 'Incorrect Answer',
  },
  style: { badgeClass: 'label-instructions', displayText: 'Style' },
  system: { badgeClass: 'label-internal-error', displayText: 'System Error' },
  positive: { badgeClass: 'label-no-errors', displayText: 'Positive' },
  student: { badgeClass: 'label-instructions', displayText: 'Feedback' },
  uncategorized: { badgeClass: 'label-instructions', displayText: 'Feedback' },
};

export function categoryPresentation(
  category: string | null | undefined,
): CategoryPresentation {
  if (!category) return MAPPING['none']!;
  return MAPPING[category.toLowerCase()] ?? MAPPING['none']!;
}
