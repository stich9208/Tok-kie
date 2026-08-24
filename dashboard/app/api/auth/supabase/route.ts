import { NextResponse } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

const CONFIG_DIR = path.join(os.homedir(), '.agent-token-tracker');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const VERIFIER_PATH = path.join(CONFIG_DIR, 'pkce_verifier.txt');

function getClientId(): string {
  let clientId = process.env.SUPABASE_OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_SUPABASE_OAUTH_CLIENT_ID || '';
  if (!clientId && fs.existsSync(CONFIG_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      clientId = data.oauth_client_id || '';
    } catch {}
  }
  return clientId.trim();
}

// Generate PKCE code verifier and challenge (RFC 7636)
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const isJsonMode = searchParams.get('mode') === 'json' || request.headers.get('accept')?.includes('application/json');

  const host = request.headers.get('host') || 'localhost:3030';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const customRedirect = searchParams.get('redirect_uri');
  const redirectUri = customRedirect || 'tokkie://oauth/callback';

  const clientId = getClientId();

  if (!clientId) {
    if (isJsonMode) {
      return NextResponse.json({
        configured: false,
        error: 'SUPABASE_OAUTH_CLIENT_ID가 설정되지 않았습니다.',
        redirectUri,
      });
    }
    return NextResponse.redirect(`${protocol}://${host}/?supabase_error=${encodeURIComponent('OAuth Client ID가 등록되지 않았습니다.')}`);
  }

  // 1. Generate PKCE Verifier & Challenge
  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  // 2. Save verifier to local storage for deep link retrieval
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(VERIFIER_PATH, verifier, 'utf-8');
  } catch (e) {
    console.warn('[OAuth PKCE] Failed to write local verifier:', e);
  }

  // 3. Construct Supabase OAuth URL with PKCE parameters
  const authUrl = new URL('https://api.supabase.com/v1/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  if (isJsonMode) {
    return NextResponse.json({
      configured: true,
      authUrl: authUrl.toString(),
      redirectUri,
    });
  }

  const response = NextResponse.redirect(authUrl.toString());
  response.cookies.set('sb_pkce_verifier', verifier, {
    httpOnly: true,
    secure: protocol === 'https',
    sameSite: 'lax',
    maxAge: 60 * 10,
    path: '/',
  });

  return response;
}
