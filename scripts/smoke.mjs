import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.env.TOKKIE_SMOKE_ROOT ?? process.cwd());
const releaseDirectory = path.resolve(
  root,
  process.env.TOKKIE_SMOKE_RELEASE_DIR ?? 'release',
);
const packageLaunchAllowed = process.env.CI === 'true' &&
  process.env.TOKKIE_SMOKE_ALLOW_PACKAGE_LAUNCH === '1';
const requiredBuildArtifacts = [
  'dashboard/out/index.html',
  'electron/dist/electron/main.js',
  'electron/dist/electron/preload.js',
];
const packageDirectoryNames = /(?:\.app|-unpacked)$/i;
const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.map', '.mjs', '.md', '.txt',
]);
const resourceScanLimit = 16 * 1024 * 1024;
const failures = [];
const notes = [];

function displayPath(filePath) {
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function fail(message) {
  failures.push(message);
}

function parseDuration(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= 100 ? Math.min(value, 120_000) : fallback;
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function occupyLegacyPort() {
  const server = createServer((socket) => socket.destroy());
  const result = await new Promise((resolve, reject) => {
    server.once('error', (error) => {
      if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
        resolve('already occupied');
      } else {
        reject(error);
      }
    });
    server.listen(3030, '127.0.0.1', () => resolve('occupied by smoke'));
  });
  if (result === 'already occupied') {
    notes.push('legacy loopback port 3030 was already occupied');
    return undefined;
  }
  server.unref();
  notes.push('legacy loopback port 3030 occupied by smoke');
  return server;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function isDirectory(filePath) {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

async function verifyBuildArtifacts() {
  for (const relativePath of requiredBuildArtifacts) {
    const filePath = path.join(root, relativePath);
    if (!(await isFile(filePath))) {
      fail(`Missing or empty build artifact: ${relativePath}`);
    }
  }
  if (!failures.length) notes.push(`build artifacts: ${requiredBuildArtifacts.length} verified`);
}

async function walkDirectories(directory, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (packageDirectoryNames.test(entry.name)) found.push(entryPath);
    else found.push(...await walkDirectories(entryPath, depth + 1));
  }
  return found;
}

function packageIsCompatible(packagePath) {
  if (process.env.TOKKIE_SMOKE_PACKAGE) return true;
  const name = path.basename(packagePath).toLowerCase();
  if (name.endsWith('.app')) return process.platform === 'darwin';
  if (/(?:^|[-_])(win|windows)(?:[-_]|$)/.test(name)) return process.platform === 'win32';
  if (/(?:^|[-_])(mac|darwin|osx)(?:[-_]|$)/.test(name)) return process.platform === 'darwin';
  if (/(?:^|[-_])linux(?:[-_]|$)/.test(name)) return process.platform === 'linux';
  return true;
}

async function findResources(packagePath) {
  const candidates = [
    path.join(packagePath, 'resources', 'app.asar'),
    path.join(packagePath, 'Resources', 'app.asar'),
    path.join(packagePath, 'Contents', 'Resources', 'app.asar'),
    path.join(packagePath, 'resources', 'app'),
    path.join(packagePath, 'Resources', 'app'),
    path.join(packagePath, 'Contents', 'Resources', 'app'),
  ];
  const resources = [];
  for (const candidate of candidates) {
    if ((candidate.endsWith('.asar') && await isFile(candidate)) ||
      (!candidate.endsWith('.asar') && await isDirectory(candidate))) {
      resources.push(candidate);
    }
  }
  const uniqueResources = new Map();
  for (const resource of resources) {
    // macOS paths are case-insensitive, so resources/ and Resources/ can be
    // the same file even though their spelling differs.
    const key = process.platform === 'win32' || process.platform === 'darwin'
      ? resource.toLowerCase()
      : resource;
    if (!uniqueResources.has(key)) uniqueResources.set(key, resource);
  }
  return [...uniqueResources.values()];
}

async function findExecutable(packagePath) {
  const explicit = process.env.TOKKIE_SMOKE_EXECUTABLE;
  if (explicit) return path.resolve(root, explicit);

  const roots = path.basename(packagePath).toLowerCase().endsWith('.app')
    ? [path.join(packagePath, 'Contents', 'MacOS')]
    : [packagePath];
  const candidates = [];
  for (const directory of roots) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      const lowerName = entry.name.toLowerCase();
      if (lowerName.endsWith('.exe') || (
        !path.extname(entry.name) &&
        !lowerName.includes('helper') &&
        !lowerName.startsWith('chrome') &&
        lowerName !== 'chrome-sandbox'
      )) candidates.push(candidate);
    }
  }
  return candidates.sort((left, right) => {
    const leftName = path.basename(left).toLowerCase();
    const rightName = path.basename(right).toLowerCase();
    const score = (name) => (name.includes('tok-kie') || name.includes('tokkie') ? 2 : 0);
    return score(rightName) - score(leftName);
  })[0];
}

function forbiddenRuntimeMarkers(text) {
  const markers = [];
  // Migration labels can legitimately mention the old Python format. They are
  // removed below before this scan; remaining Python tokens are dependencies.
  const pythonRuntime = [
    /\bpython(?:3(?:\.\d+)*)?(?:\.exe)?\b/i,
    /[\\/]python(?:3(?:\.\d+)*)?(?:\.exe)?(?:[\\/]|$)/i,
    /\bpython(?:3(?:\.\d+)*)?(?:\.exe)?\s+(?:-m\b|-c\b|[^\s"'`]*\.py\b)/i,
  ];
  for (const pattern of pythonRuntime) {
    const match = pattern.exec(text);
    if (match) markers.push(`Python runtime reference (${match[0]})`);
  }

  const nextRuntime = [
    /\bnext\s+(?:start|dev)\b/i,
    /\bnext-server\b/i,
    /next[\\/]dist[\\/]server\b/i,
    /next[\\/]server\b/i,
    /\.next[\\/]server\b/i,
    /\b(?:localhost|127\.0\.0\.1):3030\b/i,
  ];
  for (const pattern of nextRuntime) {
    const match = pattern.exec(text);
    if (match) markers.push(`Next server runtime reference (${match[0]})`);
  }
  return markers;
}

async function scanResourceFile(filePath) {
  let details;
  try {
    details = await stat(filePath);
  } catch {
    return;
  }
  if (!details.isFile() || details.size === 0 || details.size > resourceScanLimit) return;
  if (!filePath.endsWith('.asar') && !textExtensions.has(path.extname(filePath).toLowerCase())) return;

  let text;
  try {
    text = (await readFile(filePath)).toString('utf8');
  } catch {
    return;
  }
  // These are data/provenance labels, not process launch references.
  const sanitized = text
    .replace(/Legacy Python offline queue/gi, '')
    .replace(/Python v1/gi, '')
    .replace(/python[-_]sqlite[-_]v1[-_]importer/gi, '');
  for (const marker of forbiddenRuntimeMarkers(sanitized)) {
    fail(`${marker} in ${displayPath(filePath)}`);
  }
}

async function scanResourceDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await scanResourceDirectory(entryPath);
    else await scanResourceFile(entryPath);
  }
}

async function scanPackageResources(packagePath, resources) {
  for (const resource of resources) {
    if (resource.endsWith('.asar')) await scanResourceFile(resource);
    else await scanResourceDirectory(resource);
    const unpacked = resource.endsWith('.asar')
      ? `${resource}.unpacked`
      : resource;
    if (unpacked !== resource && await isDirectory(unpacked)) await scanResourceDirectory(unpacked);
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', () => finish(true));
    child.once('error', () => finish(true));
  });
}

async function stopOwnedChild(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const stopped = await waitForChildExit(child, 5_000);
  if (!stopped && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await waitForChildExit(child, 2_000);
}

async function waitForStartedChild(child, label) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ started: false, reason: `${label} startup timeout` }),
      parseDuration('TOKKIE_SMOKE_STARTUP_MS', 15_000),
    );
    child.once('spawn', () => finish({ started: true }));
    child.once('error', (error) => finish({ started: false, reason: error.message }));
    child.once('exit', (code, signal) => finish({
      started: false,
      reason: `${label} exited (${code ?? signal ?? 'unknown'})`,
    }));
  });
}

async function launchPackage(packagePath, executable) {
  if (!packageIsCompatible(packagePath)) {
    notes.push(`launch skipped for ${displayPath(packagePath)} (different platform)`);
    return;
  }
  if (!(await isFile(executable))) {
    fail(`Packaged app executable not found: ${displayPath(executable)}`);
    return;
  }
  if (!packageLaunchAllowed) {
    notes.push(`packaged launch skipped outside an opted-in CI/VM runner: ${displayPath(packagePath)}`);
    return;
  }

  const smokeDirectory = await mkdtemp(path.join(os.tmpdir(), 'tokkie-smoke-'));
  const userDataDirectory = path.join(smokeDirectory, 'user-data');
  // Keep the packaged launch independent from user-installed runtimes while
  // retaining the operating-system utilities Electron itself may invoke.
  const restrictedPath = process.platform === 'win32'
    ? [
        path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'),
        process.env.SystemRoot ?? 'C:\\Windows',
      ].join(path.delimiter)
    : '/usr/bin:/bin';
  const launchEnvironment = { ...process.env, PATH: restrictedPath };
  if (process.platform === 'win32') launchEnvironment.Path = restrictedPath;
  delete launchEnvironment.TOKKIE_DEV_URL;
  let legacyPortGuard;
  let child;
  let deepLinkChild;
  let restartChild;
  try {
    legacyPortGuard = await occupyLegacyPort();
    child = spawn(executable, [`--user-data-dir=${userDataDirectory}`, '--smoke-test'], {
      cwd: packagePath,
      env: launchEnvironment,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    const startResult = await waitForStartedChild(child, 'initial launch');
    if (!startResult.started) {
      fail(`Packaged app failed to start (${displayPath(packagePath)}): ${startResult.reason}`);
      return;
    }
    await wait(parseDuration('TOKKIE_SMOKE_ALIVE_MS', 1_500));
    if (child.exitCode !== null || child.signalCode !== null) {
      fail(`Packaged app exited during liveness check (${displayPath(packagePath)})`);
    } else {
      notes.push(`packaged app remained alive: ${displayPath(packagePath)}`);
    }

    if (child.exitCode === null && child.signalCode === null) {
      deepLinkChild = spawn(executable, [
        `--user-data-dir=${userDataDirectory}`,
        '--smoke-test',
        'tokkie://oauth/callback?state=smoke-invalid&error=access_denied',
      ], {
        cwd: packagePath,
        env: launchEnvironment,
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      const deepLinkStart = await waitForStartedChild(deepLinkChild, 'deep-link handoff');
      const forwarded = deepLinkStart.started && await waitForChildExit(deepLinkChild, 8_000);
      if (!deepLinkStart.started) {
        fail(`Packaged deep-link handoff failed to start (${displayPath(packagePath)}): ${deepLinkStart.reason}`);
      } else if (!forwarded) {
        fail(`Packaged deep-link handoff did not return (${displayPath(packagePath)})`);
      } else if (child.exitCode !== null || child.signalCode !== null) {
        fail(`Packaged deep-link handoff terminated the primary app (${displayPath(packagePath)})`);
      } else {
        notes.push('single-instance deep-link handoff verified');
      }
    }

    await stopOwnedChild(deepLinkChild);
    deepLinkChild = undefined;
    await stopOwnedChild(child);
    child = undefined;

    restartChild = spawn(executable, [`--user-data-dir=${userDataDirectory}`, '--smoke-test'], {
      cwd: packagePath,
      env: launchEnvironment,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    const restartResult = await waitForStartedChild(restartChild, 'restart');
    if (!restartResult.started) {
      fail(`Packaged app failed to restart (${displayPath(packagePath)}): ${restartResult.reason}`);
    } else {
      await wait(parseDuration('TOKKIE_SMOKE_RESTART_ALIVE_MS', 750));
      if (restartChild.exitCode !== null || restartChild.signalCode !== null) {
        fail(`Packaged app exited during restart check (${displayPath(packagePath)})`);
      } else {
        notes.push('packaged restart verified');
      }
    }
  } finally {
    await stopOwnedChild(deepLinkChild);
    await stopOwnedChild(child);
    await stopOwnedChild(restartChild);
    await closeServer(legacyPortGuard);
    await rm(smokeDirectory, { recursive: true, force: true });
  }
}

async function inspectPackages() {
  if (process.env.TOKKIE_SMOKE_SKIP_PACKAGE === '1') {
    notes.push('packaged app checks skipped by TOKKIE_SMOKE_SKIP_PACKAGE=1');
    return;
  }

  let packages = [];
  if (process.env.TOKKIE_SMOKE_PACKAGE) {
    packages = [path.resolve(root, process.env.TOKKIE_SMOKE_PACKAGE)];
  } else if (await isDirectory(releaseDirectory)) {
    packages = await walkDirectories(releaseDirectory);
  }
  packages = [...new Set(packages)];
  if (!packages.length) {
    notes.push(`no packaged directory found under ${displayPath(releaseDirectory)}; build-artifact-only smoke`);
    return;
  }

  let launchCandidate;
  for (const packagePath of packages) {
    const resources = await findResources(packagePath);
    if (!resources.length) {
      fail(`Packaged app has no app.asar or unpacked resources: ${displayPath(packagePath)}`);
      continue;
    }
    notes.push(`packaged app discovered: ${displayPath(packagePath)}`);
    await scanPackageResources(packagePath, resources);
    if (!launchCandidate && packageIsCompatible(packagePath)) {
      launchCandidate = { packagePath, executable: await findExecutable(packagePath) };
    }
  }
  if (launchCandidate) await launchPackage(launchCandidate.packagePath, launchCandidate.executable);
  else notes.push('no packaged directory matched the current platform; launch check skipped');
}

try {
  await verifyBuildArtifacts();
  await inspectPackages();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  console.error(`Smoke check failed (${failures.length} issue${failures.length === 1 ? '' : 's'}).`);
  for (const issue of failures) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log(`Smoke check passed. ${notes.join('; ')}.`);
}
