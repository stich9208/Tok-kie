import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import os from 'node:os';
import path from 'node:path';
import { CloudController } from './app/cloud-controller';
import {
  RENDERER_ORIGIN,
  installStaticRendererProtocol,
  registerRendererScheme,
} from './app/static-protocol';
import { CollectorWorkerFacade } from './core/facade';
import { defaultDiscoveryRoots } from './core/acquisition';
import { registerIpcHandlers } from './ipc/handlers';
import {
  findTokkieDeepLink,
  parseDevRendererUrl,
  rendererUrlIsTrusted,
  validateExternalUrl,
} from './app/url-policy';

registerRendererScheme();

const DEFAULT_EXTERNAL_ORIGINS = ['https://api.supabase.com', 'https://supabase.com'];
const isDevelopment = !app.isPackaged;
const isSmokeTest = process.argv.includes('--smoke-test');

// Package smoke runs only on an isolated CI/VM runner. Keep that process
// non-activating as an additional guard against windows, Dock icons or focus.
if (isSmokeTest && process.platform === 'darwin') app.setActivationPolicy('accessory');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let collector: CollectorWorkerFacade | undefined;
let cloud: CloudController | undefined;
let isQuitting = false;
let shutdownComplete = false;
let shutdownPromise: Promise<void> | undefined;
const pendingDeepLinks: string[] = [];

function requestedDevUrl(): URL | undefined {
  return isDevelopment ? parseDevRendererUrl(process.env.TOKKIE_DEV_URL) : undefined;
}

const devUrl = requestedDevUrl();
const trustedRendererOrigin = devUrl?.origin ?? RENDERER_ORIGIN;

function externalOrigins(): ReadonlySet<string> {
  const configured = (process.env.TOKKIE_EXTERNAL_HTTPS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_EXTERNAL_ORIGINS, ...configured].map((raw) => {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.origin !== raw) throw new Error('External allowlist entries must be HTTPS origins');
    return url.origin;
  }));
}

const allowedExternalOrigins = externalOrigins();

async function openAllowedExternal(rawUrl: string): Promise<void> {
  await shell.openExternal(validateExternalUrl(rawUrl, allowedExternalOrigins), { activate: true });
}

function rendererIsTrusted(event: IpcMainInvokeEvent): boolean {
  try {
    return Boolean(event.senderFrame && rendererUrlIsTrusted(
      event.senderFrame.url,
      devUrl ? trustedRendererOrigin : undefined,
    ));
  } catch {
    return false;
  }
}

function rendererExportDirectory(): string {
  return path.join(app.getAppPath(), 'dashboard', 'out');
}

function schemaPath(): string {
  return path.join(app.getAppPath(), 'supabase', 'schema.sql');
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('🐰 Tok-kie');
  tray.setToolTip('Tok-kie · AI coding agent token tracker');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Tok-kie 열기', click: () => showMainWindow() },
    {
      label: '에이전트 로그 즉시 스캔',
      click: () => { void collector?.scan(); },
    },
    { type: 'separator' },
    {
      label: 'Tok-kie 종료',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else showMainWindow();
  });
}

function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.on('will-navigate', (event, target) => {
    try {
      if (rendererUrlIsTrusted(target, devUrl ? trustedRendererOrigin : undefined)) return;
    } catch {
      // Invalid navigations are denied below.
    }
    event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openAllowedExternal(url).catch(() => undefined);
    return { action: 'deny' };
  });
}

function createMainWindow(): BrowserWindow {
  if (mainWindow) return mainWindow;
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Tok-kie',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#131313',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDevelopment,
    },
  });
  mainWindow = window;
  configureWindowSecurity(window);
  if (!isSmokeTest) window.once('ready-to-show', () => window.show());
  window.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  void window.loadURL(devUrl?.toString() ?? `${RENDERER_ORIGIN}/`);
  return window;
}

function showMainWindow(): void {
  const window = mainWindow ?? createMainWindow();
  if (isSmokeTest) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function handleDeepLink(rawUrl: string): Promise<void> {
  if (!cloud) {
    pendingDeepLinks.push(rawUrl);
    return;
  }
  showMainWindow();
  try {
    // Validation, PKCE state consumption and code exchange all remain in main.
    await cloud.completeAuthorization(rawUrl);
  } catch {
    // The renderer polls the project-list capability and receives a sanitized
    // IPC failure; never log the callback URL, state or authorization code.
  }
}

function registerDeepLinkClient(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('tokkie', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('tokkie');
  }
}

registerDeepLinkClient();
app.on('open-url', (event, url) => {
  event.preventDefault();
  void handleDeepLink(url);
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, commandLine) => {
    showMainWindow();
    const deepLink = findTokkieDeepLink(commandLine);
    if (deepLink) void handleDeepLink(deepLink);
  });

  app.whenReady().then(async () => {
    if (!devUrl) await installStaticRendererProtocol(rendererExportDirectory());

    const userData = app.getPath('userData');
    collector = new CollectorWorkerFacade({
      databasePath: path.join(userData, 'tokkie-v2.sqlite'),
      roots: defaultDiscoveryRoots(),
      watch: true,
      legacy: {
        databasePath: path.join(os.homedir(), '.agent-token-tracker', 'offline_events.db'),
        backupDirectory: path.join(userData, 'legacy-backups'),
      },
    });
    const oauthClientId = process.env.TOKKIE_SUPABASE_OAUTH_CLIENT_ID;
    cloud = new CloudController({
      configPath: path.join(userData, 'cloud-config.json'),
      credentialPath: path.join(userData, 'cloud-refresh-token.json'),
      schemaPath: schemaPath(),
      safeStorage,
      collector,
      ...(oauthClientId ? {
        management: {
          clientId: oauthClientId,
          authorizationEndpoint: 'https://api.supabase.com/v1/oauth/authorize',
          tokenEndpoint: 'https://api.supabase.com/v1/oauth/token',
          managementApiOrigin: 'https://api.supabase.com',
          allowedOrigins: ['https://api.supabase.com'],
          scopes: ['projects:read', 'database:write', 'secrets:read'],
        },
      } : {}),
    });

    registerIpcHandlers({
      collector,
      cloud,
      getWindow: () => mainWindow,
      isTrustedSender: rendererIsTrusted,
      openExternal: openAllowedExternal,
      updateTrayTitle: (title) => tray?.setTitle(title ? `🐰 ${title}` : '🐰 Tok-kie'),
    });
    if (!isSmokeTest) createTray();
    createMainWindow();
    void collector.start().catch(() => undefined);
    void cloud.start().catch(() => undefined);
    for (const deepLink of pendingDeepLinks.splice(0)) void handleDeepLink(deepLink);

    app.on('activate', () => showMainWindow());
  }).catch(() => {
    isQuitting = true;
    app.quit();
  });
}

app.on('before-quit', (event) => {
  isQuitting = true;
  if (shutdownComplete) return;
  event.preventDefault();
  shutdownPromise ??= (async () => {
    await cloud?.close().catch(() => undefined);
    await collector?.close().catch(() => undefined);
    shutdownComplete = true;
    app.quit();
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
