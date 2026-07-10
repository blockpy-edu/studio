import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { BootConfig } from './boot-config';

/**
 * Bootstrapping contract (spec §5.2): the server page provides a root
 * element and a JSON config block, then calls
 * BlockPyStudio.mount('#blockpy-root', '#blockpy-config').
 */
export function mount(rootSelector: string, configSelector: string): void {
  const rootElement = document.querySelector(rootSelector);
  if (!rootElement) {
    throw new Error(`BlockPy Studio: no element matches root selector "${rootSelector}"`);
  }
  const configElement = document.querySelector(configSelector);
  if (!configElement?.textContent) {
    throw new Error(`BlockPy Studio: no JSON config found at selector "${configSelector}"`);
  }
  const config = JSON.parse(configElement.textContent) as BootConfig;
  createRoot(rootElement).render(<App config={config} />);
}

/**
 * Compatibility mount (spec §5.2): assembles a BootConfig purely from the
 * legacy globals (window.$blockPyUrls, window.$blockPyUserData, QUIZZES,
 * READINGS, …) so the rewrite can ship without a synchronized server
 * release. Implementation: Milestone 1.6.
 */
export function mountLegacy(rootSelector: string): void {
  void rootSelector;
  throw new Error('BlockPy Studio: mountLegacy is not implemented yet (Milestone 1.6).');
}
