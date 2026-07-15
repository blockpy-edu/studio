/**
 * Navigation compatibility globals (spec §15.3) - `URL_MAP`, `INDICES`,
 * `FIRST_ID`, `LAST_ID`, `FULL_SELECTOR_DIV`, `loadNavigation()`, as the
 * assignment_groups.html macro defines them (:27-38, :40, :204). Course-
 * level scripts in the wild poke these; when the app owns the navigation
 * (no template macro on the page) it publishes them so those scripts don't
 * crash. Documented as DEPRECATED - new content should use
 * `altAssignmentChangingFunction`/`markCorrect`.
 *
 * Every global is published only if currently undefined: on unmodified
 * templates the macro's own `var` declarations win, and the disposer
 * removes only what we set.
 */
import type { GroupNavBootData } from './store';

export interface NavigationGlobalsOptions {
  globals?: Record<string, unknown>;
  document?: Document;
  /** loadNavigation() re-bound handlers in legacy; the store-driven header
   *  needs no re-binding, so the compatibility export just re-fires this
   *  (a no-op by default). */
  onLoadNavigation?: () => void;
}

/**
 * Publish the compatibility globals from the boot group data. Returns a
 * disposer removing exactly the keys this call set.
 */
export function publishNavigationGlobals(
  group: GroupNavBootData,
  options: NavigationGlobalsOptions = {},
): () => void {
  const globals = options.globals ?? (globalThis as unknown as Record<string, unknown>);
  const doc = options.document ?? (typeof document === 'undefined' ? null : document);
  // The macro's sorted_group rejects subordinates (:2) before building
  // URL_MAP/INDICES.
  const sorted = group.assignments.filter((assignment) => !assignment.subordinate);
  if (sorted.length === 0) return () => undefined;

  const urlMap: Record<number, string> = {};
  for (const assignment of sorted) urlMap[assignment.id] = assignment.url;

  const values: Record<string, unknown> = {
    URL_MAP: urlMap,
    INDICES: sorted.map((assignment) => assignment.id),
    FIRST_ID: sorted[0]!.id,
    LAST_ID: sorted[sorted.length - 1]!.id,
    // Legacy captures the header's innerHTML after render (:203-205).
    FULL_SELECTOR_DIV: doc?.querySelector('.assignment-selector-div')?.innerHTML ?? '',
    loadNavigation: () => options.onLoadNavigation?.(),
  };

  const published: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (globals[key] !== undefined) continue;
    globals[key] = value;
    published.push(key);
  }
  return () => {
    for (const key of published) delete globals[key];
  };
}
