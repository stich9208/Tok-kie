import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const CONFIG_DIR = path.join(os.homedir(), '.agent-token-tracker');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const ENV_LOCAL_PATH = path.join(process.cwd(), '.env.local');

export const dynamic = 'force-dynamic';

function getStoredConfig() {
  let data: any = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {}
  }
  return data;
}

export async function GET() {
  try {
    const configData = getStoredConfig();
    
    let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || configData.supabase_url || '';
    let hasKey = !!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || configData.supabase_key);
    
    let oauthClientId = (process.env.SUPABASE_OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_SUPABASE_OAUTH_CLIENT_ID || configData.oauth_client_id || '').trim();

    return NextResponse.json({
      configured: !!(supabaseUrl && hasKey),
      supabaseUrl: supabaseUrl ? supabaseUrl.replace(/(https?:\/\/).{4}(.*)(\.supabase\.co)/, '$1****$3') : '',
      oauthConfigured: !!oauthClientId,
      oauthClientId: oauthClientId ? oauthClientId.substring(0, 6) + '...' : '',
    });
  } catch (err: any) {
    return NextResponse.json({ configured: false, oauthConfigured: false, error: err.message });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { supabaseUrl, supabaseKey, oauthClientId, oauthClientSecret } = body;

    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    let configData = getStoredConfig();

    // 1. Save OAuth Client ID (PKCE standard - Secret is optional)
    if (oauthClientId) {
      configData.oauth_client_id = oauthClientId.trim();
      process.env.SUPABASE_OAUTH_CLIENT_ID = oauthClientId.trim();
    }
    if (oauthClientSecret) {
      configData.oauth_client_secret = oauthClientSecret.trim();
      process.env.SUPABASE_OAUTH_CLIENT_SECRET = oauthClientSecret.trim();
    }

    // 2. Save Direct Supabase URL / Key if provided
    if (supabaseUrl) configData.supabase_url = supabaseUrl.trim();
    if (supabaseKey) configData.supabase_key = supabaseKey.trim();

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf-8');

    // 3. Write / Update dashboard/.env.local
    let envLines: string[] = [];
    if (configData.supabase_url) envLines.push(`NEXT_PUBLIC_SUPABASE_URL=${configData.supabase_url}`);
    if (configData.supabase_key) envLines.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${configData.supabase_key}`);
    if (configData.oauth_client_id) envLines.push(`SUPABASE_OAUTH_CLIENT_ID=${configData.oauth_client_id}`);
    if (configData.oauth_client_secret) envLines.push(`SUPABASE_OAUTH_CLIENT_SECRET=${configData.oauth_client_secret}`);

    fs.writeFileSync(ENV_LOCAL_PATH, `# Tok-kie Configuration\n${envLines.join('\n')}\n`, 'utf-8');

    // 4. Trigger scan if supabase URL/key configured
    if (configData.supabase_url && configData.supabase_key) {
      const rootDir = path.resolve(process.cwd(), '..');
      const venvPython = path.join(rootDir, '.venv', 'bin', 'python');
      const mainPy = path.join(rootDir, 'collector', 'main.py');
      if (fs.existsSync(venvPython) && fs.existsSync(mainPy)) {
        execFileAsync(venvPython, [mainPy, 'scan']).catch(e => console.warn('Background scan error:', e));
      }
    }

    return NextResponse.json({ success: true, message: 'Settings saved successfully!' });
  } catch (err: any) {
    console.error('Failed to save config:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
