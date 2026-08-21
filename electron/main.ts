import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, shell } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let collectorProcess: ChildProcess | null = null;
let isAppQuitting = false;

const isDev = process.env.NODE_ENV !== 'production' || !app.isPackaged;
const ROOT_DIR = path.resolve(__dirname, '..', '..');

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
  // Create crisp tray icon (fallback to text badge if icon asset not found)
  const iconPath = path.join(ROOT_DIR, 'dashboard', 'public', 'tray_icon.png');
  let trayIcon: any;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
  } else {
    // Generate simple 16x16 transparent image
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
        shell.openExternal('http://localhost:3000');
      },
    },
    { type: 'separator' },
    {
      label: '종료 (Quit)',
      accelerator: 'Cmd+Q',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu);
  });

  tray.on('click', () => {
    toggleMainWindow();
  });
}

// 3. Create Main Dashboard Window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Tok-kie 🐰 | AI Coding Agent Token Tracker',
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#0f1015',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const targetUrl = isDev
    ? 'http://localhost:3000'
    : 'http://localhost:3000'; // Or load local server/file

  mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Minimize to tray instead of quitting when close button is clicked
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

// 4. App Lifecycle
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
  // On macOS, keep tray running even if window is closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 5. IPC Handlers
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
