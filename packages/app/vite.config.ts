import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { routeDevRequest, type DemoQuizGrader } from './src/dev-stub';

/**
 * Stub blockpy-server endpoints for the dev harness + smoke tests. The
 * fixtures and routing live in src/dev-stub.ts (shared with the static
 * GitHub Pages demo's in-browser fetch stub); this middleware only adapts
 * them to real HTTP so e2e tests can observe network requests.
 */
function devApi(): Plugin {
  return {
    name: 'blockpy-dev-api',
    configureServer(server) {
      // The quiz grader imports quizzer TS — node can't execute that from
      // the config bundle, so vite's own transform pipeline loads it.
      let graderPromise: Promise<DemoQuizGrader> | null = null;
      const loadGrader = () =>
        (graderPromise ??= server
          .ssrLoadModule('/src/demo-quiz-grader.ts')
          .then((mod) => (mod as { gradeQuizWire: DemoQuizGrader }).gradeQuizWire));
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        // Prefix-gate BEFORE consuming the body — a drained stream would
        // starve any later middleware that wanted the request.
        if (req.method !== 'POST' || !path.startsWith('/api/')) return next();
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          void (async () => {
            const body = Buffer.concat(chunks).toString('utf8');
            let params: URLSearchParams;
            try {
              params = new URLSearchParams(body);
            } catch {
              params = new URLSearchParams();
            }
            const grader = await loadGrader().catch(() => undefined);
            const routed = routeDevRequest(path, params, grader);
            if (!routed) return next();
            if (routed.text !== undefined) {
              res.setHeader('Content-Type', 'text/plain');
              res.end(routed.text);
              return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(routed.json));
          })();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  // The engine worker is a module worker created via `new Worker(new URL)`;
  // rollup code-splitting only supports ES-format worker output.
  worker: { format: 'es' },
});
