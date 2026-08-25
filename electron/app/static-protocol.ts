import { protocol } from 'electron';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export const RENDERER_SCHEME = 'app';
export const RENDERER_HOST = 'tokkie';
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://${RENDERER_HOST}`;

export const RENDERER_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The packaged renderer never talks to Supabase directly. All desktop
  // network authority stays in Electron main behind validated IPC.
  "connect-src 'self'",
].join('; ');

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const commonHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export function contentSecurityPolicy(asset: string | undefined, body: Buffer | undefined): string {
  if (!asset || path.extname(asset).toLowerCase() !== '.html' || !body) return RENDERER_CSP;
  const hashes = new Set<string>();
  const html = body.toString('utf8');
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    const attributes = match[1] ?? '';
    const content = match[2] ?? '';
    if (/\bsrc\s*=/i.test(attributes) || !content) continue;
    hashes.add(`'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`);
  }
  if (!hashes.size) return RENDERER_CSP;
  return RENDERER_CSP.replace("script-src 'self'", `script-src 'self' ${[...hashes].join(' ')}`);
}

export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: RENDERER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }]);
}

function insideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function resolveAsset(root: string, pathname: string): Promise<string | undefined> {
  if (/%(?:2f|5c|00)/i.test(pathname)) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return undefined;

  const relative = decoded.replace(/^\/+/, '');
  const requested = path.resolve(root, relative || 'index.html');
  if (!insideRoot(root, requested)) return undefined;

  const candidates = [requested];
  if (decoded.endsWith('/')) candidates.unshift(path.join(requested, 'index.html'));
  else if (!path.extname(requested)) candidates.push(path.join(requested, 'index.html'));

  for (const candidate of candidates) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      const actual = await realpath(candidate);
      if (insideRoot(root, actual)) return actual;
    } catch {
      // Continue through static-export fallbacks.
    }
  }
  return undefined;
}

function errorResponse(status: 400 | 404 | 405): Response {
  const message = status === 404 ? 'Not Found' : status === 405 ? 'Method Not Allowed' : 'Bad Request';
  return new Response(message, {
    status,
    headers: {
      ...commonHeaders,
      'Content-Security-Policy': RENDERER_CSP,
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

export async function installStaticRendererProtocol(exportDirectory: string): Promise<void> {
  const root = await realpath(exportDirectory);
  protocol.handle(RENDERER_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405);
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return errorResponse(400);
    }
    if (url.protocol !== `${RENDERER_SCHEME}:` || url.hostname !== RENDERER_HOST ||
        url.username || url.password || url.port) {
      return errorResponse(400);
    }

    const asset = await resolveAsset(root, url.pathname);
    if (!asset) return errorResponse(404);
    const bytes = await readFile(asset);
    const body = request.method === 'HEAD' ? null : bytes;
    return new Response(body, {
      status: 200,
      headers: {
        ...commonHeaders,
        'Content-Security-Policy': contentSecurityPolicy(asset, bytes),
        'Content-Type': MIME_TYPES[path.extname(asset).toLowerCase()] ?? 'application/octet-stream',
      },
    });
  });
}
