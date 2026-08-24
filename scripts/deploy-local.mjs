// Copy the embeddable studio build into the local blockpy-server checkout.
// The server (controllers/assets.py + templates/blockpy/studio.html) needs:
//   studio/blockpy-studio.iife.js   - bundled app (window.BlockPyStudio)
//   studio/app.css                  - bundled styles
//   studio/assets/worker.entry.js   - engine worker; engine-adapter resolves
//                                     this STABLE name from paths.assets, but
//                                     the lib build emits it hashed
//   studio/blockly-media/           - Blockly sprites/sounds
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const src = resolve('packages/app/dist-lib');
const dest = process.env.BLOCKPY_SERVER_STUDIO ?? 'C:/Users/acbar/Projects/blockpy-server/static/studio';

if (!existsSync(src)) {
  console.error(`Missing ${src}; run "pnpm build" first.`);
  process.exit(1);
}
const worker = readdirSync(join(src, 'assets')).find((f) => /^worker\.entry.*\.js$/.test(f));
if (!worker) {
  console.error(`No worker.entry*.js in ${join(src, 'assets')}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, 'assets'), { recursive: true });
cpSync(join(src, 'blockpy-studio.iife.js'), join(dest, 'blockpy-studio.iife.js'));
cpSync(join(src, 'app.css'), join(dest, 'app.css'));
cpSync(join(src, 'assets', worker), join(dest, 'assets', 'worker.entry.js'));
cpSync(join(src, 'blockly-media'), join(dest, 'blockly-media'), { recursive: true });
console.log(`Deployed studio build to ${dest}`);
