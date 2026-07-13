/**
 * Dev-harness entry — mirrors what a server bootstrap page does, PLUS the
 * harness-only chrome: an assignment-group dropdown at the top that swaps
 * between the showcase fixtures and REAL bakery-curriculum groups
 * (1A/6B, demo/bakery-groups.json), remounting the app exactly like a
 * fresh server page for the chosen group.
 *
 * The same entry serves two hosts:
 *  - `pnpm dev` / e2e: the vite middleware answers /api/* over real HTTP;
 *  - the static GitHub Pages build (no server): an in-browser fetch stub
 *    answers the same routes from the shared dev-stub module.
 */
import { mountConfig } from './index';
import type { BootConfig } from './boot-config';
import type { StudioHandle } from './studio-handle';
import { DEMO_GROUPS, routeDevRequest, type DemoGroup } from './dev-stub';
import { gradeQuizWire } from './demo-quiz-grader';

const SHOWCASE_KEY = 'showcase';

function readBaseConfig(): BootConfig {
  const configElement = document.querySelector('#blockpy-config');
  if (!configElement?.textContent) {
    throw new Error('Dev harness: no #blockpy-config JSON block');
  }
  return JSON.parse(configElement.textContent) as BootConfig;
}

/** BootConfig for one demo group — what the server page would emit. */
function configForGroup(base: BootConfig, group: DemoGroup | null): BootConfig {
  const config: BootConfig = {
    ...base,
    paths: {
      ...base.paths,
      // Base-aware asset paths: the Pages demo serves under /<repo>/.
      blocklyMedia: `${import.meta.env.BASE_URL}blockly-media/`,
    },
  };
  if (!group) return config; // showcase = the hand-written config as-is
  const first = group.nav.find((entry) => !entry.subordinate) ?? group.nav[0];
  return {
    ...config,
    assignment: {
      currentAssignmentId: first?.id ?? null,
      assignmentGroupId: group.id,
      typeIndex: group.typeIndex,
    },
    group: {
      assignments: group.nav,
      anySecretive: group.nav.some((entry) => entry.hidden),
      currentAssignmentId: first?.id ?? 0,
    },
  };
}

/**
 * In-browser /api/* stub for static builds. Dev keeps the vite middleware
 * (e2e watches real network traffic), so this only installs in PROD.
 */
function stubbedFetch(): typeof fetch {
  const realFetch = window.fetch.bind(window);
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return realFetch(input, init);
    const body = typeof init?.body === 'string' ? init.body : '';
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(body);
    } catch {
      params = new URLSearchParams();
    }
    // GET-style routes (download_file links) carry params in the URL.
    for (const [key, value] of new URLSearchParams(url.split('?')[1] ?? '')) {
      if (!params.has(key)) params.set(key, value);
    }
    const routed = routeDevRequest(path, params, gradeQuizWire);
    if (!routed) return new Response('Not found', { status: 404 });
    if (routed.text !== undefined) {
      return new Response(routed.text, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return new Response(JSON.stringify(routed.json), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function currentGroupKey(): string {
  return new URLSearchParams(location.search).get('group') ?? SHOWCASE_KEY;
}

function renderGroupPicker(onChange: (key: string) => void): void {
  const bar = document.createElement('div');
  bar.className = 'blockpy-dev-grouppicker';
  bar.style.cssText =
    'padding: 6px 10px; border-bottom: 1px solid #ddd; background: #f7f7f7; ' +
    'font: 14px system-ui, sans-serif; display: flex; gap: 8px; align-items: center;';
  const label = document.createElement('label');
  label.textContent = 'Assignment group: ';
  label.htmlFor = 'blockpy-dev-group';
  const select = document.createElement('select');
  select.id = 'blockpy-dev-group';
  const options: Array<[string, string]> = [
    [SHOWCASE_KEY, 'Showcase (every surface)'],
    ...DEMO_GROUPS.map((group): [string, string] => [group.key, `Bakery ${group.name}`]),
  ];
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }
  select.value = options.some(([value]) => value === currentGroupKey())
    ? currentGroupKey()
    : SHOWCASE_KEY;
  select.addEventListener('change', () => onChange(select.value));
  const note = document.createElement('span');
  note.style.cssText = 'color: #666;';
  note.textContent =
    'BlockPy Studio demo — bakery groups are real curriculum (grading runs in your browser).';
  bar.append(label, select, note);
  document.body.insertBefore(bar, document.body.firstChild);
}

const baseConfig = readBaseConfig();
const extras = import.meta.env.PROD ? { fetch: stubbedFetch() } : {};
const rootQuery = document.querySelector('#blockpy-root');
if (!(rootQuery instanceof HTMLElement)) {
  throw new Error('Dev harness: no #blockpy-root element');
}
// Post-guard alias: narrowing doesn't survive into the closures below.
const root: HTMLElement = rootQuery;

let handle: StudioHandle | null = null;

function mountGroup(key: string): void {
  handle?.unmount();
  // A fresh mount node per group — exactly a new server page (no id: the
  // outer #blockpy-root keeps that contract).
  const freshRoot = document.createElement('div');
  root.replaceChildren(freshRoot);
  const group = DEMO_GROUPS.find((candidate) => candidate.key === key) ?? null;
  handle = mountConfig(freshRoot, configForGroup(baseConfig, group), extras);
}

renderGroupPicker((key) => {
  const url = new URL(location.href);
  if (key === SHOWCASE_KEY) url.searchParams.delete('group');
  else url.searchParams.set('group', key);
  // The nav writes assignment_id on dispatch; a group swap starts fresh.
  url.searchParams.delete('assignment_id');
  history.replaceState(null, '', url);
  mountGroup(key);
});

mountGroup(currentGroupKey());
