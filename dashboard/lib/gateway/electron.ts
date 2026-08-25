import {
  IPC_CHANNELS,
  type IpcReply,
  type SessionQuery,
  type TokkieApi,
} from '../../../shared/ipc';
import type { DashboardGateway, OAuthStart, PairingEnvelopeV2 } from './types';
import { GatewayError } from './types';
import { normalizeSession, normalizeStep } from './normalize';
import { validatePairingEnvelope } from './pairing';

export interface DashboardElectronApi {
  readonly invoke: TokkieApi['invoke'];
}

declare global {
  interface Window {
    electronAPI?: DashboardElectronApi;
  }
}

function unwrap<T>(reply: IpcReply<T>, operation: string): T {
  if (reply.ok) return reply.value;
  throw new GatewayError(
    reply.error.code === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'REMOTE_ERROR',
    reply.error.message || `${operation} 요청에 실패했습니다.`,
    reply.error.retryable,
  );
}

export function hasElectronGateway(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.invoke === 'function';
}

export class ElectronGateway implements DashboardGateway {
  readonly kind = 'electron' as const;
  readonly label = 'Desktop · Local database';
  readonly capabilities = {
    localData: true,
    cloudSettings: true,
    oauth: true,
    oauthProjectSelection: true,
    manualCloudSetup: true,
    pairing: true,
    legacyMapping: true,
  } as const;

  constructor(private readonly api: DashboardElectronApi) {}

  async querySessions(query: SessionQuery = {}) {
    const sessions = [];
    let cursor = query.cursor;

    do {
      const reply = await this.api.invoke(IPC_CHANNELS.querySessions, {
        ...query,
        limit: Math.min(query.limit || 500, 500),
        ...(cursor ? { cursor } : {}),
      });
      const page = unwrap(reply, '세션 조회');
      sessions.push(...page.items.map(normalizeSession));
      cursor = page.next_cursor;
    } while (cursor && !query.limit);

    return sessions;
  }

  async querySteps(query: { readonly session_id: string; readonly limit?: number; readonly cursor?: string }) {
    const reply = await this.api.invoke(IPC_CHANNELS.querySteps, query);
    return unwrap(reply, '작업 조회').items.map(normalizeStep);
  }

  async getCloudSettings() {
    return unwrap(await this.api.invoke(IPC_CHANNELS.getCloudSettings, {}), '클라우드 설정 조회');
  }

  async beginOAuth(): Promise<OAuthStart> {
    const result = unwrap(await this.api.invoke(IPC_CHANNELS.beginOAuth, {}), 'OAuth 시작');
    unwrap(
      await this.api.invoke(IPC_CHANNELS.openExternal, { url: result.authorization_url }),
      '인증 브라우저 열기',
    );
    return { authorizationUrl: result.authorization_url, state: result.state };
  }

  async listOAuthProjects() {
    return unwrap(
      await this.api.invoke(IPC_CHANNELS.listOAuthProjects, {}),
      'Supabase 프로젝트 조회',
    );
  }

  async selectOAuthProject(projectRef: string) {
    return unwrap(
      await this.api.invoke(IPC_CHANNELS.selectOAuthProject, { project_ref: projectRef }),
      'Supabase 프로젝트 선택',
    );
  }

  async beginManualCloudSetup(projectUrl: string, publishableKey: string) {
    return unwrap(
      await this.api.invoke(IPC_CHANNELS.beginManualCloudSetup, {
        project_url: projectUrl,
        publishable_key: publishableKey,
      }),
      'Supabase 수동 설정 시작',
    );
  }

  async confirmManualCloudSetup(setupId: string, projectUrl: string) {
    return unwrap(
      await this.api.invoke(IPC_CHANNELS.confirmManualCloudSetup, {
        setup_id: setupId,
        project_url: projectUrl,
      }),
      'Supabase owner 연결 확인',
    );
  }

  async createPairing(): Promise<PairingEnvelopeV2> {
    const legacyOrV2: unknown = unwrap(
      await this.api.invoke(IPC_CHANNELS.createPairing, {}),
      '모바일 페어링 생성',
    );

    try {
      return validatePairingEnvelope(legacyOrV2);
    } catch {
      throw new GatewayError(
        'INVALID_PAIRING',
        '데스크톱에서 안전하지 않은 페어링 응답을 거부했습니다.',
      );
    }
  }

  async listPairingMembers() {
    return unwrap(
      await this.api.invoke(IPC_CHANNELS.listPairingMembers, {}),
      '페어링 멤버 조회',
    );
  }

  async approvePairingMember(memberId: string): Promise<void> {
    unwrap(
      await this.api.invoke(IPC_CHANNELS.approvePairingMember, { member_id: memberId }),
      '페어링 승인',
    );
  }

  async revokePairingMember(memberId: string): Promise<void> {
    unwrap(
      await this.api.invoke(IPC_CHANNELS.revokePairingMember, { member_id: memberId }),
      '페어링 해제',
    );
  }

  async listLegacyMappings() {
    return unwrap(
      await this.api.invoke(IPC_CHANNELS.listLegacyMappings, {}),
      '레거시 매핑 조회',
    );
  }

  async mapLegacyPayload(payloadHash: string, verifiedSourceId: string): Promise<void> {
    unwrap(
      await this.api.invoke(IPC_CHANNELS.mapLegacyPayload, {
        payload_hash: payloadHash,
        verified_source_id: verifiedSourceId,
      }),
      '레거시 데이터 매핑',
    );
  }
}
