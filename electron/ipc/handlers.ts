import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcFailure,
  type IpcReply,
  type IpcRequestMap,
} from '../../shared/ipc';
import { validateIpcRequest } from '../../shared/validation';
import type { CollectorCoreFacade } from '../core/facade';
import type { CloudController } from '../app/cloud-controller';

interface RegisterIpcOptions {
  readonly collector: CollectorCoreFacade;
  readonly cloud: CloudController;
  readonly getWindow: () => BrowserWindow | null;
  readonly isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  readonly openExternal: (rawUrl: string) => Promise<void>;
  readonly updateTrayTitle: (title: string) => void;
}

function failure(
  code: IpcFailure['error']['code'],
  message: string,
  retryable = false,
): IpcFailure {
  return { ok: false, error: { code, message, retryable } };
}

function sanitizedError(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Operation failed';
  return raw
    .replace(/(?:eyJ|sb_(?:publishable|secret)_)[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/(?:access|refresh|management)[_-]?token\s*[:=]\s*\S+/gi, 'credential=[redacted]')
    .slice(0, 500);
}

function trusted<T>(
  options: RegisterIpcOptions,
  operation: (event: IpcMainInvokeEvent, input: unknown) => Promise<T> | T,
): (event: IpcMainInvokeEvent, input: unknown) => Promise<IpcReply<T>> {
  return async (event, input) => {
    if (!options.isTrustedSender(event)) return failure('UNAVAILABLE', 'Untrusted renderer origin');
    try {
      return { ok: true, value: await operation(event, input) };
    } catch (error) {
      const unavailable = Boolean(error && typeof error === 'object' &&
        'code' in error && (error as { code?: unknown }).code === 'UNAVAILABLE');
      return failure(
        unavailable ? 'UNAVAILABLE' : error instanceof TypeError ? 'INVALID_REQUEST' : 'INTERNAL',
        sanitizedError(error),
      );
    }
  };
}

function validated<C extends IpcChannel>(channel: C, input: unknown): IpcRequestMap[C] {
  const result = validateIpcRequest(channel, input);
  if (!result.ok) {
    throw new TypeError(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
  }
  return result.value;
}

function replaceHandler(channel: string, listener: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

export function registerIpcHandlers(options: RegisterIpcOptions): void {
  replaceHandler(IPC_CHANNELS.querySessions, trusted(options, (_event, input) =>
    options.collector.querySessions(validated(IPC_CHANNELS.querySessions, input))));
  replaceHandler(IPC_CHANNELS.querySteps, trusted(options, (_event, input) =>
    options.collector.querySteps(validated(IPC_CHANNELS.querySteps, input))));
  replaceHandler(IPC_CHANNELS.scan, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.scan, input);
    return options.collector.scan();
  }));
  replaceHandler(IPC_CHANNELS.collectorStatus, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.collectorStatus, input);
    return options.collector.status();
  }));
  replaceHandler(IPC_CHANNELS.getCloudSettings, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.getCloudSettings, input);
    return options.cloud.settings();
  }));
  replaceHandler(IPC_CHANNELS.beginOAuth, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.beginOAuth, input);
    return options.cloud.beginOAuth();
  }));
  replaceHandler(IPC_CHANNELS.listOAuthProjects, trusted(options, async (_event, input) => {
    validated(IPC_CHANNELS.listOAuthProjects, input);
    const projects = await options.cloud.listProjects();
    return projects.map((project) => ({ id: project.id, ref: project.ref, name: project.name }));
  }));
  replaceHandler(IPC_CHANNELS.selectOAuthProject, trusted(options, async (_event, input) => {
    const request = validated(IPC_CHANNELS.selectOAuthProject, input);
    const projects = await options.cloud.listProjects();
    const selected = projects.find((project) => project.ref === request.project_ref);
    if (!selected) throw new TypeError('Selected project is not authorized');
    return options.cloud.selectProject(selected.id);
  }));
  replaceHandler(IPC_CHANNELS.beginManualCloudSetup, trusted(options, (_event, input) => {
    const request = validated(IPC_CHANNELS.beginManualCloudSetup, input);
    return options.cloud.beginManualSetup(request.project_url, request.publishable_key);
  }));
  replaceHandler(IPC_CHANNELS.confirmManualCloudSetup, trusted(options, (_event, input) => {
    const request = validated(IPC_CHANNELS.confirmManualCloudSetup, input);
    return options.cloud.confirmManualSetup(request.setup_id, request.project_url);
  }));
  replaceHandler(IPC_CHANNELS.createPairing, trusted(options, (_event, input) => {
    const request = validated(IPC_CHANNELS.createPairing, input);
    return options.cloud.createPairing(request.device_label);
  }));
  replaceHandler(IPC_CHANNELS.listPairingMembers, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.listPairingMembers, input);
    return options.cloud.listMembers();
  }));
  replaceHandler(IPC_CHANNELS.approvePairingMember, trusted(options, async (_event, input) => {
    const request = validated(IPC_CHANNELS.approvePairingMember, input);
    await options.cloud.approveMember(request.member_id);
    return { approved: true as const };
  }));
  replaceHandler(IPC_CHANNELS.revokePairingMember, trusted(options, async (_event, input) => {
    const request = validated(IPC_CHANNELS.revokePairingMember, input);
    await options.cloud.revokeMember(request.member_id);
    return { revoked: true as const };
  }));
  replaceHandler(IPC_CHANNELS.listLegacyMappings, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.listLegacyMappings, input);
    return options.collector.listLegacyMappingOptions();
  }));
  replaceHandler(IPC_CHANNELS.mapLegacyPayload, trusted(options, async (_event, input) => {
    const request = validated(IPC_CHANNELS.mapLegacyPayload, input);
    const mapped = await options.collector.mapLegacyPayload(request.payload_hash, request.verified_source_id);
    if (!mapped) throw new TypeError('Legacy payload was not found');
    // Mapping is explicit authorization to reconcile. An unchanged verified
    // snapshot still performs cleanup in CollectorRuntime.scan().
    await options.collector.scan();
    return { mapped: true as const };
  }));
  replaceHandler(IPC_CHANNELS.openExternal, trusted(options, async (_event, input) => {
    const request = validated(IPC_CHANNELS.openExternal, input);
    await options.openExternal(request.url);
    return { opened: true as const };
  }));
  replaceHandler(IPC_CHANNELS.updateTrayTitle, trusted(options, (_event, input) => {
    const request = validated(IPC_CHANNELS.updateTrayTitle, input);
    options.updateTrayTitle(request.title);
    return { updated: true as const };
  }));
  replaceHandler(IPC_CHANNELS.hideWindow, trusted(options, (_event, input) => {
    validated(IPC_CHANNELS.hideWindow, input);
    options.getWindow()?.hide();
    return { hidden: true as const };
  }));

}
