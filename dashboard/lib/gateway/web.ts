import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SessionQuery, StepQuery } from '../../../shared/ipc';
import type { DashboardGateway, OAuthProject, OAuthStart, PairingEnvelopeV2, PairingMember } from './types';
import { GatewayError } from './types';
import { clearPairingHash, consumePairingHash, isAllowedPublishableKey } from './pairing';
import { normalizeSession, normalizeStep } from './normalize';

function unavailable(feature: string): never {
  throw new GatewayError(
    'UNAVAILABLE',
    `${feature}은 데스크톱 앱에서만 설정할 수 있습니다.`,
  );
}

export class WebSupabaseGateway implements DashboardGateway {
  readonly kind = 'web' as const;
  readonly label = 'Web · Authenticated Supabase';
  readonly capabilities = {
    localData: false,
    cloudSettings: false,
    oauth: false,
    oauthProjectSelection: false,
    manualCloudSetup: false,
    pairing: false,
    legacyMapping: false,
  } as const;

  private readonly client: SupabaseClient | null;
  private readonly pairing: PairingEnvelopeV2 | null;
  private readonly initializationError: GatewayError | null;
  private pairingRedemption: Promise<void> | null = null;

  constructor() {
    let pairing: PairingEnvelopeV2 | null = null;
    let initializationError: GatewayError | null = null;
    try {
      pairing = consumePairingHash(window.location);
    } catch (error) {
      initializationError = error instanceof GatewayError
        ? error
        : new GatewayError('INVALID_PAIRING', '페어링 링크를 처리할 수 없습니다.');
    }

    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || '';
    let url = '';

    if (configuredUrl && key) {
      try {
        const parsedUrl = new URL(configuredUrl);
        if (
          parsedUrl.protocol !== 'https:'
          || Boolean(parsedUrl.username || parsedUrl.password || parsedUrl.port || parsedUrl.search || parsedUrl.hash)
          || (parsedUrl.pathname !== '/' && parsedUrl.pathname !== '')
          || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsedUrl.hostname)
          || !isAllowedPublishableKey(key)
        ) {
          throw new Error('unsafe public configuration');
        }
        url = parsedUrl.origin;
        if (pairing && pairing.url !== url) {
          throw new Error('pairing project does not match this deployment');
        }
      } catch {
        initializationError = new GatewayError(
          'NOT_CONFIGURED',
          '이 페어링 QR은 배포된 웹 뷰어의 Supabase 프로젝트와 일치하지 않습니다.',
        );
      }
    } else if (pairing) {
      initializationError = new GatewayError(
        'NOT_CONFIGURED',
        '이 웹 뷰어에 Supabase URL과 publishable/anon key를 먼저 배포 환경변수로 구성해야 합니다.',
      );
    }

    this.pairing = pairing;
    this.initializationError = initializationError;
    this.client = url && key && !initializationError
      ? createClient(url, key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
          },
        })
      : null;
  }

  private async requireAuthenticatedClient(): Promise<SupabaseClient> {
    if (this.initializationError) throw this.initializationError;
    if (!this.client) {
      throw new GatewayError(
        'NOT_CONFIGURED',
        '웹 Supabase publishable URL/key가 구성되지 않았습니다.',
      );
    }

    if (this.pairing && !this.pairingRedemption) {
      this.pairingRedemption = this.redeemPairing(this.client, this.pairing);
    }
    if (this.pairingRedemption) await this.pairingRedemption;

    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) {
      throw new GatewayError(
        'AUTH_REQUIRED',
        '인증된 Supabase 세션이 없습니다. 데스크톱에서 새 모바일 QR을 생성해주세요.',
      );
    }
    await this.requireActiveMembership(this.client, data.user.id);
    return this.client;
  }

  private async requireActiveMembership(client: SupabaseClient, authUserId: string): Promise<void> {
    const { data, error } = await client
      .from('members')
      .select('id,approved_at,revoked_at')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (error) throw new GatewayError('REMOTE_ERROR', error.message, true);
    if (!data || data.revoked_at) {
      await client.auth.signOut({ scope: 'local' });
      throw new GatewayError('AUTH_REQUIRED', '해당 모바일 연결이 해제되었습니다. 새 QR로 다시 연결해주세요.');
    }
    if (!data.approved_at) {
      throw new GatewayError('AUTH_REQUIRED', '데스크톱에서 이 모바일 연결을 승인해주세요.');
    }
  }

  private async redeemPairing(client: SupabaseClient, pairing: PairingEnvelopeV2): Promise<void> {
    if (pairing.exp <= Date.now()) {
      throw new GatewayError('INVALID_PAIRING', '페어링 토큰이 만료되었습니다.');
    }

    const separator = pairing.token.indexOf('.');
    const pairingId = pairing.token.slice(0, separator);
    const oneTimeSecret = pairing.token.slice(separator + 1);

    // The deployment's own public key first creates an anonymous Auth session. The
    // claim RPC atomically consumes the hashed one-time secret and binds that
    // auth user to a separately revocable viewer membership.
    await client.auth.signOut({ scope: 'local' });
    const { error: signInError } = await client.auth.signInAnonymously();
    if (signInError) {
      throw new GatewayError('AUTH_REQUIRED', signInError.message || '익명 뷰어 세션을 만들지 못했습니다.');
    }

    const { data, error } = await client.rpc('claim_pairing_token', {
      p_pairing_id: pairingId,
      p_one_time_secret: oneTimeSecret,
    });
    if (error) {
      throw new GatewayError('REMOTE_ERROR', error.message || '페어링 토큰 교환에 실패했습니다.');
    }

    if (!Array.isArray(data) || data.length !== 1) {
      throw new GatewayError('INVALID_PAIRING', '페어링 토큰이 만료되었거나 이미 사용되었습니다.');
    }

    const { data: persisted, error: sessionError } = await client.auth.getSession();
    if (sessionError || !persisted.session) {
      throw new GatewayError('AUTH_REQUIRED', '페어링 세션을 안전하게 저장하지 못했습니다.');
    }
    clearPairingHash(window.location);
  }

  async querySessions(query: SessionQuery = {}) {
    const client = await this.requireAuthenticatedClient();
    const pageSize = Math.min(query.limit || 1_000, 1_000);
    const sessions = [];
    let offset = 0;

    do {
      let request = client
        .from('sessions')
        .select('*')
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (!query.include_archived) request = request.eq('is_archived', false);
      if (query.agent_types?.length) request = request.in('agent_type', [...query.agent_types]);
      if (query.statuses?.length) request = request.in('status', [...query.statuses]);
      if (query.started_after) request = request.gte('started_at', query.started_after);
      if (query.started_before) request = request.lt('started_at', query.started_before);

      const { data, error } = await request;
      if (error) throw new GatewayError('REMOTE_ERROR', error.message, true);
      const page = data || [];
      sessions.push(...page.map(normalizeSession));
      offset += page.length;
      if (query.limit || page.length < pageSize || offset >= 10_000) break;
    } while (true);

    return sessions;
  }

  async querySteps(query: StepQuery) {
    const client = await this.requireAuthenticatedClient();
    const { data, error } = await client
      .from('steps')
      .select('*')
      .is('deleted_at', null)
      .eq('session_id', query.session_id)
      .order('step_index', { ascending: true })
      .limit(Math.min(query.limit || 1_000, 1_000));

    if (error) throw new GatewayError('REMOTE_ERROR', error.message, true);
    return (data || []).map(normalizeStep);
  }

  async getCloudSettings() {
    return unavailable('클라우드 연결 관리');
  }

  async beginOAuth(): Promise<OAuthStart> {
    return unavailable('Supabase OAuth');
  }

  async listOAuthProjects(): Promise<readonly OAuthProject[]> {
    return unavailable('Supabase 프로젝트 선택');
  }

  async selectOAuthProject(_projectRef: string) {
    return unavailable('Supabase 프로젝트 선택');
  }

  async beginManualCloudSetup(_projectUrl: string, _publishableKey: string) {
    return unavailable('Supabase 수동 설정');
  }

  async confirmManualCloudSetup(_setupId: string, _projectUrl: string) {
    return unavailable('Supabase 수동 설정');
  }

  async createPairing(): Promise<PairingEnvelopeV2> {
    return unavailable('모바일 페어링 생성');
  }

  async listPairingMembers(): Promise<readonly PairingMember[]> {
    return unavailable('페어링 멤버 관리');
  }

  async approvePairingMember(_memberId: string): Promise<void> {
    return unavailable('페어링 승인');
  }

  async revokePairingMember(_memberId: string): Promise<void> {
    return unavailable('페어링 해제');
  }

  async listLegacyMappings() {
    return unavailable('레거시 데이터 매핑');
  }

  async mapLegacyPayload(_payloadHash: string, _verifiedSourceId: string): Promise<void> {
    return unavailable('레거시 데이터 매핑');
  }
}
