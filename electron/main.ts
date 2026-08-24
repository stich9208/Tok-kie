import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let collectorProcess: ChildProcess | null = null;
let isAppQuitting = false;
let pendingDeepLinkUrl: string | null = null;

const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Register tokkie:// deep link custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('tokkie', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('tokkie');
}

// 1. Manage Python Collector Daemon Lifecycle
function startCollectorDaemon() {
  const venvPython = path.join(ROOT_DIR, '.venv', 'bin', 'python');
  const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
  const mainPy = path.join(ROOT_DIR, 'collector', 'main.py');

  if (!fs.existsSync(mainPy)) {
    console.warn('[Electron] collector/main.py not found at:', mainPy);
    return;
  }

  try {
    console.log('[Electron] Starting background collector daemon with:', pythonBin);
    collectorProcess = spawn(pythonBin, [mainPy, 'start'], {
      cwd: ROOT_DIR,
      detached: false,
      stdio: 'ignore'
    });

    collectorProcess.on('error', (err) => {
      console.warn('[Electron] Failed to start collector daemon:', err);
    });

    collectorProcess.on('exit', (code) => {
      console.log('[Electron] Collector daemon exited with code:', code);
    });
  } catch (e) {
    console.warn('[Electron] Collector spawn exception:', e);
  }
}

function stopCollectorDaemon() {
  if (collectorProcess && !collectorProcess.killed) {
    console.log('[Electron] Stopping collector daemon...');
    try {
      collectorProcess.kill('SIGTERM');
    } catch (e) {
      console.warn('[Electron] Error killing collector daemon:', e);
    }
    collectorProcess = null;
  }
}

// 2. Create Native macOS Menu Bar Tray
function createTray() {
  const iconPath = path.join(ROOT_DIR, 'dashboard', 'public', 'tray_icon.png');
  let trayIcon: any;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setTitle('🐰 Tok-kie');
  tray.setToolTip('Tok-kie: AI Coding Agent Token Tracker');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🐰 Tok-kie 대시보드 열기',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: '🔍 에이전트 로그 즉시 스캔',
      click: () => {
        const venvPython = path.join(ROOT_DIR, '.venv', 'bin', 'python');
        const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
        const mainPy = path.join(ROOT_DIR, 'collector', 'main.py');
        if (fs.existsSync(mainPy)) {
          spawn(pythonBin, [mainPy, 'scan'], { cwd: ROOT_DIR });
        }
      },
    },
    { type: 'separator' },
    {
      label: '🌐 브라우저에서 열기 (Localhost)',
      click: () => {
        shell.openExternal('http://localhost:3030');
      },
    },
    { type: 'separator' },
    {
      label: '⚙️ 설정 초기화 / 재연결',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: '🚪 Tok-kie 완전 종료',
      click: () => {
        isAppQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    toggleMainWindow();
  });
}

// 3. Create Main Dashboard Window
function createMainWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: 'Tok-kie 🐰',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#131313',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const targetUrl = 'http://localhost:3030';
  mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    if (pendingDeepLinkUrl) {
      handleDeepLink(pendingDeepLinkUrl);
      pendingDeepLinkUrl = null;
    }
  });

  mainWindow.on('close', (event) => {
    if (!isAppQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function toggleMainWindow() {
  if (!mainWindow) {
    createMainWindow();
  } else if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// 4. Handle Deep Links (tokkie://oauth/callback?code=...)
function handleDeepLink(url: string) {
  console.log('[Electron] Handling deep link:', url);
  if (!url || !url.startsWith('tokkie://')) return;

  showMainWindow();

  if (mainWindow && mainWindow.webContents) {
    try {
      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      const error = parsed.searchParams.get('error');
      const errorDescription = parsed.searchParams.get('error_description');

      if (code) {
        // Forward code to Next.js callback route
        const callbackUrl = `http://localhost:3030/api/auth/supabase/callback?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent('tokkie://oauth/callback')}`;
        mainWindow.loadURL(callbackUrl);
      } else if (error) {
        mainWindow.loadURL(`http://localhost:3030/?supabase_error=${encodeURIComponent(errorDescription || error)}`);
      }
    } catch (e) {
      console.warn('[Electron] Deep link parsing exception:', e);
    }
  } else {
    pendingDeepLinkUrl = url;
  }
}

// macOS open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows/Linux single instance lock & deep link handling
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const deepLinkUrl = commandLine.find((arg) => arg.startsWith('tokkie://'));
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });
}

// 5. App Lifecycle
app.whenReady().then(() => {
  createTray();
  createMainWindow();
  startCollectorDaemon();

  // Global hotkey: Cmd + Shift + T
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    toggleMainWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', () => {
  isAppQuitting = true;
  globalShortcut.unregisterAll();
  stopCollectorDaemon();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 6. IPC Handlers
ipcMain.on('update-tray-title', (_, title: string) => {
  if (tray) {
    tray.setTitle(title ? `🐰 ${title}` : '🐰 Tok-kie');
  }
});

ipcMain.on('open-external', (_, url: string) => {
  if (url) shell.openExternal(url);
});

ipcMain.on('minimize-window', () => {
  mainWindow?.hide();
});

ipcMain.on('close-window', () => {
  mainWindow?.hide();
});
