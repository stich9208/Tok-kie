import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const execFileAsync = promisify(execFile);
const DB_PATH = path.join(os.homedir(), '.agent-token-tracker', 'offline_events.db');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');

  if (!fs.existsSync(DB_PATH)) {
    return NextResponse.json({ sessions: [], steps: [] });
  }

  try {
    if (sessionId) {
      // Validate sessionId strictly (alphanumeric, dash, underscore only)
      if (!/^[a-zA-Z0-9_:-]+$/.test(sessionId)) {
        return NextResponse.json({ error: 'Invalid session ID format' }, { status: 400 });
      }

      // Query steps safely without shell interpolation
      const query = `SELECT payload FROM pending_steps WHERE session_id = '${sessionId.replace(/'/g, "''")}' ORDER BY rowid ASC;`;
      const { stdout } = await execFileAsync('sqlite3', ['-json', DB_PATH, query], { maxBuffer: 15 * 1024 * 1024 });
      
      const rows = JSON.parse(stdout || '[]');
      const steps = rows.map((r: any) => {
        try {
          return JSON.parse(r.payload);
        } catch {
          return null;
        }
      }).filter(Boolean);

      return NextResponse.json({ steps });
    }

    // Query all sessions safely
    const query = `SELECT payload FROM pending_sessions ORDER BY rowid DESC;`;
    const { stdout } = await execFileAsync('sqlite3', ['-json', DB_PATH, query], { maxBuffer: 25 * 1024 * 1024 });

    const rows = JSON.parse(stdout || '[]');
    const sessions = rows.map((r: any) => {
      try {
        return JSON.parse(r.payload);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return NextResponse.json({ sessions });
  } catch (error: any) {
    console.error('Error querying local SQLite:', error);
    return NextResponse.json({ sessions: [], steps: [], error: error.message }, { status: 500 });
  }
}
