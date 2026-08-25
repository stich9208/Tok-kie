import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, opendir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import type { AgentType } from '../../shared/domain';
import type { SnapshotReadFailure, SourceDescriptor, SourceKind, SourceSnapshot } from '../../shared/source';
import { describeSource, sha256 } from './util';

export interface DiscoveryRoots {
  readonly claude: string;
  readonly codex: string;
  readonly antigravity: string;
}

export interface SnapshotOptions {
  readonly maxBytes?: number;
  readonly attempts?: number;
}

function failure(source: SourceDescriptor, error: unknown): SnapshotReadFailure {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return { source, code: 'not_found', message: 'Source does not exist.', retryable: true };
  if (code === 'EACCES' || code === 'EPERM') return { source, code: 'permission_denied', message: 'Source is not readable.', retryable: false };
  return { source, code: 'io_error', message: error instanceof Error ? error.message : 'Source read failed.', retryable: true };
}

async function stableFileBytes(
  source: SourceDescriptor,
  maxBytes: number,
  attempts: number,
): Promise<Uint8Array | SnapshotReadFailure> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const before = await stat(source.locator);
      if (before.size > maxBytes) {
        return { source, code: 'too_large', message: `Source exceeds ${maxBytes} bytes.`, retryable: false };
      }
      const bytes = await readFile(source.locator);
      const after = await stat(source.locator);
      if (before.size === after.size && before.mtimeMs === after.mtimeMs && bytes.byteLength === after.size) return bytes;
    } catch (error) {
      if (attempt === attempts - 1) return failure(source, error);
    }
  }
  return { source, code: 'unstable', message: 'Source changed during every stable-read attempt.', retryable: true };
}

async function sqliteBackupBytes(
  source: SourceDescriptor,
  maxBytes: number,
): Promise<Uint8Array | SnapshotReadFailure> {
  const tempDir = path.join(os.tmpdir(), `tokkie-snapshot-${randomUUID()}`);
  const snapshotPath = path.join(tempDir, 'snapshot.sqlite');
  let db: DatabaseSync | undefined;
  try {
    await mkdir(tempDir, { recursive: false, mode: 0o700 });
    // SQLite's online backup API includes committed pages still resident in -wal.
    db = new DatabaseSync(source.locator, { readOnly: true });
    await backup(db, snapshotPath);
    db.close();
    db = undefined;
    const snapshotStat = await stat(snapshotPath);
    if (snapshotStat.size > maxBytes) {
      return { source, code: 'too_large', message: `SQLite snapshot exceeds ${maxBytes} bytes.`, retryable: false };
    }
    return await readFile(snapshotPath);
  } catch (error) {
    return failure(source, error);
  } finally {
    db?.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

export class SnapshotAcquirer {
  constructor(private readonly options: SnapshotOptions = {}) {}

  async read(source: SourceDescriptor): Promise<SourceSnapshot | SnapshotReadFailure> {
    const maxBytes = this.options.maxBytes ?? 512 * 1024 * 1024;
    const attempts = this.options.attempts ?? 3;
    const bytes = source.kind === 'sqlite_database'
      ? await sqliteBackupBytes(source, maxBytes)
      : await stableFileBytes(source, maxBytes, attempts);
    if (!ArrayBuffer.isView(bytes)) return bytes;
    let modifiedAt: string | undefined;
    try {
      modifiedAt = (await stat(source.locator)).mtime.toISOString();
    } catch {
      // Revision hash is authoritative; mtime is optional.
    }
    return {
      contract: 'absolute_snapshot_v1',
      complete: true,
      source,
      observed_at: new Date().toISOString(),
      revision: {
        size_bytes: bytes.byteLength,
        ...(modifiedAt ? { modified_at: modifiedAt } : {}),
        content_sha256: sha256(bytes),
      },
      encoding: source.kind === 'sqlite_database' ? 'binary' : 'utf8',
      bytes,
    };
  }
}

async function walkFiles(root: string, maxDepth = 8): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await opendir(directory);
    } catch {
      return;
    }
    for await (const entry of entries) {
      const locator = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(locator, depth + 1);
      else if (entry.isFile()) files.push(locator);
    }
  }
  await visit(root, 0);
  return files;
}

export async function discoverSources(roots: DiscoveryRoots): Promise<SourceDescriptor[]> {
  const candidates: Array<{ agent: AgentType; kind: SourceKind; locator: string }> = [];
  const [claudeFiles, antigravityFiles] = await Promise.all([
    walkFiles(path.join(roots.claude, 'projects')),
    walkFiles(roots.antigravity),
  ]);
  for (const locator of claudeFiles) {
    if (locator.endsWith('.jsonl') && !locator.includes(`${path.sep}subagents${path.sep}`)) {
      candidates.push({ agent: 'claude_code', kind: 'jsonl_file', locator });
    }
  }
  for (const locator of antigravityFiles) {
    if (path.basename(locator) === 'transcript.jsonl') candidates.push({ agent: 'antigravity', kind: 'jsonl_file', locator });
  }
  const codexState = path.join(roots.codex, 'state_5.sqlite');
  try {
    if ((await stat(codexState)).isFile()) candidates.push({ agent: 'codex', kind: 'sqlite_database', locator: codexState });
  } catch {
    // Optional agent source.
  }
  const descriptors = await Promise.all(candidates.map(({ agent, kind, locator }) => describeSource(agent, kind, locator)));
  return descriptors.sort((left, right) => left.source_id.localeCompare(right.source_id));
}

export function defaultDiscoveryRoots(homeDirectory = os.homedir()): DiscoveryRoots {
  return {
    claude: path.join(homeDirectory, '.claude'),
    codex: path.join(homeDirectory, '.codex'),
    antigravity: path.join(homeDirectory, '.gemini', 'antigravity', 'brain'),
  };
}

/** fs.watch events only schedule a rescan; they never carry parser data or offsets. */
export class SourceWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly onHint: () => void | Promise<void>,
    private readonly debounceMs = 350,
  ) {}

  watchSources(sources: readonly SourceDescriptor[], discoveryRoots: readonly string[] = []): void {
    const targets = new Map<string, boolean>();
    for (const source of sources) targets.set(path.dirname(source.locator), false);
    for (const root of discoveryRoots) targets.set(root, true);
    for (const [key, watcher] of this.watchers) {
      if (!targets.has(key)) {
        watcher.close();
        this.watchers.delete(key);
      }
    }
    for (const [directory, recursive] of targets) {
      const key = directory;
      if (this.watchers.has(key)) continue;
      try {
        const watcher = watch(directory, { persistent: false, recursive }, (_event, filename) => {
          // Directory watching captures state_5.sqlite, -wal and -shm changes.
          if (filename === null || !String(filename).startsWith('.')) this.schedule();
        });
        watcher.on('error', () => this.schedule());
        this.watchers.set(key, watcher);
      } catch {
        // Missing roots are picked up by explicit scans; discovered source parents remain watched.
      }
    }
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.onHint();
    }, this.debounceMs);
    this.timer.unref?.();
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
  }
}
