import { contextBridge, ipcRenderer } from 'electron';
import type { IpcReply, TokkieApi } from '../shared/ipc';

// A sandboxed preload may only require Electron's built-in preload modules.
// Keep runtime channel values local; the shared import above is type-only and
// is erased by TypeScript.
const IPC_CHANNELS = Object.freeze({
  querySessions: 'tokkie:data:query-sessions',
  querySteps: 'tokkie:data:query-steps',
  scan: 'tokkie:collector:scan',
  collectorStatus: 'tokkie:collector:status',
  getCloudSettings: 'tokkie:cloud:get-settings',
  beginOAuth: 'tokkie:cloud:begin-oauth',
  listOAuthProjects: 'tokkie:cloud:list-oauth-projects',
  selectOAuthProject: 'tokkie:cloud:select-oauth-project',
  beginManualCloudSetup: 'tokkie:cloud:begin-manual-setup',
  confirmManualCloudSetup: 'tokkie:cloud:confirm-manual-setup',
  createPairing: 'tokkie:cloud:create-pairing',
  listPairingMembers: 'tokkie:cloud:list-pairing-members',
  approvePairingMember: 'tokkie:cloud:approve-pairing-member',
  revokePairingMember: 'tokkie:cloud:revoke-pairing-member',
  listLegacyMappings: 'tokkie:legacy:list-mappings',
  mapLegacyPayload: 'tokkie:legacy:map-payload',
  openExternal: 'tokkie:shell:open-external',
  updateTrayTitle: 'tokkie:window:update-tray-title',
  hideWindow: 'tokkie:window:hide',
});

const ALLOWED_CHANNELS = new Set<string>([
  IPC_CHANNELS.querySessions,
  IPC_CHANNELS.querySteps,
  IPC_CHANNELS.scan,
  IPC_CHANNELS.collectorStatus,
  IPC_CHANNELS.getCloudSettings,
  IPC_CHANNELS.beginOAuth,
  IPC_CHANNELS.listOAuthProjects,
  IPC_CHANNELS.selectOAuthProject,
  IPC_CHANNELS.beginManualCloudSetup,
  IPC_CHANNELS.confirmManualCloudSetup,
  IPC_CHANNELS.createPairing,
  IPC_CHANNELS.listPairingMembers,
  IPC_CHANNELS.approvePairingMember,
  IPC_CHANNELS.revokePairingMember,
  IPC_CHANNELS.listLegacyMappings,
  IPC_CHANNELS.mapLegacyPayload,
  IPC_CHANNELS.openExternal,
  IPC_CHANNELS.updateTrayTitle,
  IPC_CHANNELS.hideWindow,
]);

const invoke = (channel: string, request: unknown): Promise<IpcReply<unknown>> => {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'Unsupported renderer capability',
        retryable: false,
      },
    });
  }
  return ipcRenderer.invoke(channel, request) as Promise<IpcReply<unknown>>;
};

const api = Object.freeze({ invoke }) as unknown as TokkieApi;
contextBridge.exposeInMainWorld('electronAPI', api);
