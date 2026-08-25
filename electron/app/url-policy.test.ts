import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findTokkieDeepLink,
  parseDevRendererUrl,
  rendererUrlIsTrusted,
  validateExternalUrl,
} from './url-policy';

test('renderer navigation trusts only the packaged app origin or exact configured development origin', () => {
  assert.equal(rendererUrlIsTrusted('app://tokkie/'), true);
  assert.equal(rendererUrlIsTrusted('app://tokkie/_next/app.js'), true);
  assert.equal(rendererUrlIsTrusted('app://other/'), false);
  assert.equal(rendererUrlIsTrusted('https://tokkie/'), false);
  assert.equal(rendererUrlIsTrusted('app://user@tokkie/'), false);
  assert.equal(rendererUrlIsTrusted('http://127.0.0.1:3030/page', 'http://127.0.0.1:3030'), true);
  assert.equal(rendererUrlIsTrusted('http://localhost:3030/page', 'http://127.0.0.1:3030'), false);
});

test('development and external URL policies reject non-loopback and origin confusion', () => {
  assert.equal(parseDevRendererUrl('http://127.0.0.1:3030')?.origin, 'http://127.0.0.1:3030');
  assert.throws(() => parseDevRendererUrl('https://example.com'), /loopback/);
  assert.throws(() => parseDevRendererUrl('http://127.0.0.1:3030/#secret'), /loopback/);

  const allowed = new Set(['https://api.supabase.com']);
  assert.equal(validateExternalUrl('https://api.supabase.com/v1/oauth/authorize', allowed), 'https://api.supabase.com/v1/oauth/authorize');
  assert.throws(() => validateExternalUrl('http://api.supabase.com/', allowed), /allowlisted/);
  assert.throws(() => validateExternalUrl('https://evil.api.supabase.com/', allowed), /allowlisted/);
  assert.throws(() => validateExternalUrl('https://user@api.supabase.com/', allowed), /allowlisted/);
});

test('single-instance routing selects only the Tok-kie deep-link argument', () => {
  assert.equal(findTokkieDeepLink(['Tok-kie', '--flag', 'tokkie://oauth/callback?code=x&state=y']), 'tokkie://oauth/callback?code=x&state=y');
  assert.equal(findTokkieDeepLink(['Tok-kie', 'https://example.com']), undefined);
});
