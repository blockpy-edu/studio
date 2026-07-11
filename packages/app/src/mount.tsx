import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { BootConfig } from './boot-config';
import { bootConfigFromLegacyGlobals, settingsFromSearch } from './legacy-globals';
import { StudioHandle, type MountExtras } from './studio-handle';

export type { MountExtras } from './studio-handle';

/**
 * Core mount: a resolved BootConfig straight onto an element. Returns the
 * imperative handle the legacy shim's BlockPy facade drives (§15.1).
 * The `settings-*` query params are merged LAST over config.settings —
 * spec §15.2 — so a pasted debug URL overrides any server-emitted value.
 */
export function mountConfig(
  rootElement: HTMLElement,
  config: BootConfig,
  extras: MountExtras = {},
  search: string = typeof location === 'undefined' ? '' : location.search,
): StudioHandle {
  const resolved: BootConfig = {
    ...config,
    settings: { ...config.settings, ...settingsFromSearch(search) },
  };
  const root = createRoot(rootElement);
  const handle = new StudioHandle(rootElement, () => root.unmount());
  root.render(
    <App
      config={resolved}
      extras={extras}
      registerActions={(actions) => handle._registerActions(actions)}
    />,
  );
  return handle;
}

function requireElement(selector: string): HTMLElement {
  const element = document.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`BlockPy Studio: no element matches root selector "${selector}"`);
  }
  return element;
}

/**
 * Bootstrapping contract (spec §5.2): the server page provides a root
 * element and a JSON config block, then calls
 * BlockPyStudio.mount('#blockpy-root', '#blockpy-config').
 */
export function mount(rootSelector: string, configSelector: string): StudioHandle {
  const rootElement = requireElement(rootSelector);
  const configElement = document.querySelector(configSelector);
  if (!configElement?.textContent) {
    throw new Error(`BlockPy Studio: no JSON config found at selector "${configSelector}"`);
  }
  const config = JSON.parse(configElement.textContent) as BootConfig;
  return mountConfig(rootElement, config);
}

/**
 * Compatibility mount (spec §5.2): assembles a BootConfig purely from the
 * legacy globals (window.$blockPyUrls, window.$blockPyUserData, QUIZZES,
 * READINGS, …, window.$blocklyMediaPath, window.accessToken) plus the page
 * URL, so the rewrite can ship against unmodified server templates.
 */
export function mountLegacy(rootSelector: string): StudioHandle {
  const config = bootConfigFromLegacyGlobals({
    globals: window as unknown as Record<string, unknown>,
    search: location.search,
  });
  return mountConfig(requireElement(rootSelector), config);
}
