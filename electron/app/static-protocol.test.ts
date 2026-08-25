import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { RENDERER_CSP, contentSecurityPolicy, resolveAsset } from './static-protocol';

test('packaged renderer CSP hashes inline bootstrap scripts and denies direct cloud connections', () => {
  const html = Buffer.from('<script>globalThis.__boot = true;</script><script src="/_next/app.js"></script>');
  const policy = contentSecurityPolicy('/tmp/index.html', html);
  assert.match(policy, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-inline'/);
  assert.match(policy, /connect-src 'self'/);
  assert.doesNotMatch(policy, /supabase\.co/);
  assert.match(RENDERER_CSP, /object-src 'none'/);
});

test('static asset resolution supports export fallbacks but contains traversal and symlinks', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'tokkie-protocol-'));
  const root = path.join(parent, 'out');
  const outside = path.join(parent, 'outside.txt');
  try {
    await mkdir(path.join(root, 'nested'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), 'home');
    await writeFile(path.join(root, 'nested', 'index.html'), 'nested');
    await writeFile(outside, 'private');
    await symlink(outside, path.join(root, 'escape.txt'));
    const canonicalRoot = await realpath(root);

    assert.equal(await resolveAsset(canonicalRoot, '/'), path.join(canonicalRoot, 'index.html'));
    assert.equal(await resolveAsset(canonicalRoot, '/nested'), path.join(canonicalRoot, 'nested', 'index.html'));
    assert.equal(await resolveAsset(canonicalRoot, '/../outside.txt'), undefined);
    assert.equal(await resolveAsset(canonicalRoot, '/%2f..%2foutside.txt'), undefined);
    assert.equal(await resolveAsset(canonicalRoot, '/escape.txt'), undefined);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
