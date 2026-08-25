import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

function start(name, args) {
  const child = spawn(npm, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  children.push(child);
  return child;
}

const next = start('Next', ['run', 'next:dev']);
const electron = start('Electron', ['run', 'electron:dev']);
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), process.platform === 'win32' ? 250 : 500).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
next.on('exit', (code) => stop(code ?? 1));
electron.on('exit', (code) => stop(code ?? 1));
