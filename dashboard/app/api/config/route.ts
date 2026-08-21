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

export async function GET() {
  try {
    let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    let hasKey = !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl && fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const data = JSON.parse(raw);
      supabaseUrl = data.supabase_url || '';
      hasKey = !!data.supabase_key;
    }

    return NextResponse.json({
      configured: !!(supabaseUrl && hasKey),
      supabaseUrl: supabaseUrl ? supabaseUrl.replace(/(https?:\/\/).{4}(.*)(\.supabase\.co)/, '$1****$3') : '',
    });
  } catch (err: any) {
    return NextResponse.json({ configured: false, error: err.message });
  }
}

export async function POST(request: Request) {
  try {
    const { supabaseUrl, supabaseKey } = await request.json();

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase URL and Key are required' }, { status: 400 });
    }

    // 1. Update config.json
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    let configData: any = {};
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        configData = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      } catch {}
    }

    configData.supabase_url = supabaseUrl.trim();
    configData.supabase_key = supabaseKey.trim();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(configData, null, 2), 'utf-8');

    // 2. Write/Update dashboard/.env.local
    const envContent = `# Tok-kie Supabase Configuration\nNEXT_PUBLIC_SUPABASE_URL=${supabaseUrl.trim()}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${supabaseKey.trim()}\n`;
    fs.writeFileSync(ENV_LOCAL_PATH, envContent, 'utf-8');

    // 3. Trigger immediate scan in background via python daemon if venv exists
    const rootDir = path.resolve(process.cwd(), '..');
    const venvPython = path.join(rootDir, '.venv', 'bin', 'python');
    const mainPy = path.join(rootDir, 'collector', 'main.py');

    if (fs.existsSync(venvPython) && fs.existsSync(mainPy)) {
      execFileAsync(venvPython, [mainPy, 'scan']).catch(e => console.warn('Background scan error:', e));
    }

    return NextResponse.json({ success: true, message: 'Supabase credentials saved and synced!' });
  } catch (err: any) {
    console.error('Failed to save config:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
