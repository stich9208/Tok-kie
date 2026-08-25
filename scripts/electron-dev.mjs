import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import process from 'node:process';

const url = process.env.TOKKIE_DEV_URL ?? 'http://127.0.0.1:3030';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electron = process.platform === 'win32' ? 'node_modules/.bin/electron.cmd' : 'node_modules/.bin/electron';

async function waitForRenderer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // The Next process may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for the dashboard at ${url}`);
}

await waitForRenderer();
await new Promise((resolve, reject) => {
  const child = spawn(npm, ['run', 'electron:compile'], { stdio: 'inherit', env: process.env });
  child.on('error', reject);
  child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`TypeScript compilation failed (${code})`))));
});
await access('electron/dist/electron/main.js');

const child = spawn(electron, ['electron/dist/electron/main.js'], {
  stdio: 'inherit',
  env: { ...process.env, TOKKIE_DEV_URL: url },
  windowsHide: false,
});
const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
