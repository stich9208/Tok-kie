import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
export const dynamic = 'force-dynamic';

const CONFIG_DIR = path.join(os.homedir(), '.agent-token-tracker');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const VERIFIER_PATH = path.join(CONFIG_DIR, 'pkce_verifier.txt');
const ENV_LOCAL_PATH = path.join(process.cwd(), '.env.local');

function getStoredConfig() {
  let data: any = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }
  return data;
}

function getStoredVerifier(): string {
  if (fs.existsSync(VERIFIER_PATH)) {
    try {
      const v = fs.readFileSync(VERIFIER_PATH, 'utf-8').trim();
      return v;
    } catch {}
  }
  return '';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const host = request.headers.get('host') || 'localhost:3030';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const customRedirect = searchParams.get('redirect_uri');
  const redirectUri = customRedirect || 'tokkie://oauth/callback';

  if (error) {
    return NextResponse.redirect(`${protocol}://${host}/?supabase_error=${encodeURIComponent(errorDescription || error)}`);
  }

  if (!code) {
    return NextResponse.redirect(`${protocol}://${host}/?supabase_error=${encodeURIComponent('No authorization code provided')}`);
  }

  const storedConfig = getStoredConfig();
  const clientId = (process.env.SUPABASE_OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_SUPABASE_OAUTH_CLIENT_ID || storedConfig.oauth_client_id || '').trim();
  const clientSecret = (process.env.SUPABASE_OAUTH_CLIENT_SECRET || storedConfig.oauth_client_secret || '').trim();
  const codeVerifier = getStoredVerifier();

  if (!clientId) {
    return NextResponse.redirect(`${protocol}://${host}/?supabase_error=${encodeURIComponent('OAuth Client ID is missing')}`);
  }

  try {
    // 1. Exchange Code for Access Token via PKCE (or Secret fallback)
    const tokenRequestBody: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
    };

    if (codeVerifier) {
      tokenRequestBody.code_verifier = codeVerifier;
    }
    if (clientSecret) {
      tokenRequestBody.client_secret = clientSecret;
    }

    const tokenResponse = await fetch('https://api.supabase.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams(tokenRequestBody),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.message || tokenData.error || 'Failed to exchange authorization token');
    }

    const accessToken = tokenData.access_token;

    // Clean up temporary verifier
    try {
      if (fs.existsSync(VERIFIER_PATH)) fs.unlinkSync(VERIFIER_PATH);
    } catch {}

    // 2. Fetch User Projects
    const projectsResponse = await fetch('https://api.supabase.com/v1/projects', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    const projects = await projectsResponse.json();
    if (!projectsResponse.ok || !Array.isArray(projects) || projects.length === 0) {
      throw new Error('No Supabase projects found in your account. Please create a project first.');
    }

    // Select the first / most active project
    const project = projects[0];
    const projectRef = project.id;
    const supabaseUrl = `https://${projectRef}.supabase.co`;

    // 3. Fetch Project API Keys (anon key)
    const apiKeysResponse = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    const apiKeys = await apiKeysResponse.json();
    let anonKey = '';

    if (apiKeysResponse.ok && Array.isArray(apiKeys)) {
      const foundAnon = apiKeys.find((k: any) => k.name === 'anon' || k.name === 'publishable' || k.tags === 'anon');
      if (foundAnon && (foundAnon.api_key || foundAnon.key)) {
        anonKey = foundAnon.api_key || foundAnon.key;
      } else if (apiKeys.length > 0) {
        anonKey = apiKeys[0].api_key || apiKeys[0].key || '';
      }
    }

    // 4. Auto-Provision Schema (Execute schema.sql via Management API)
    try {
      const rootDir = path.resolve(process.cwd(), '..');
      const schemaPath = path.join(rootDir, 'supabase', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf-8');
        
        await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: schemaSql }),
        });
        console.log(`[Supabase OAuth] Schema successfully executed on project: ${projectRef}`);
      }
    } catch (schemaErr) {
      console.warn('[Supabase OAuth] Schema execution warning:', schemaErr);
    }

    // 5. Save Configuration to config.json
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    let configData = getStoredConfig();
    configData.supabase_url = supabaseUrl;
    if (anonKey) configData.supabase_key = anonKey;
    configData.oauth_client_id = clientId;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf-8');

    // 6. Update dashboard/.env.local
    let envLines: string[] = [];
    envLines.push(`NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`);
    if (anonKey) envLines.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`);
    if (clientId) envLines.push(`SUPABASE_OAUTH_CLIENT_ID=${clientId}`);
    fs.writeFileSync(ENV_LOCAL_PATH, `# Tok-kie Configuration\n${envLines.join('\n')}\n`, 'utf-8');

    // 7. Trigger Local Scan in Background
    const rootDir = path.resolve(process.cwd(), '..');
    const venvPython = path.join(rootDir, '.venv', 'bin', 'python');
    const mainPy = path.join(rootDir, 'collector', 'main.py');
    if (fs.existsSync(venvPython) && fs.existsSync(mainPy)) {
      execFileAsync(venvPython, [mainPy, 'scan']).catch(e => console.warn('Background scan error:', e));
    }

    return NextResponse.redirect(`${protocol}://${host}/?supabase_connected=true&project_name=${encodeURIComponent(project.name || projectRef)}`);
  } catch (err: any) {
    console.error('Supabase OAuth Callback Error:', err);
    return NextResponse.redirect(`${protocol}://${host}/?supabase_error=${encodeURIComponent(err.message || 'OAuth authorization failed')}`);
  }
}
