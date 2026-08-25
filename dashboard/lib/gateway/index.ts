import type { SessionQuery, StepQuery } from '../../../shared/ipc';
import { ElectronGateway, hasElectronGateway } from './electron';
import { WebSupabaseGateway } from './web';
import type { DashboardGateway, OAuthProject, OAuthStart, PairingEnvelopeV2, PairingMember } from './types';
import { GatewayError, unavailableCapabilities } from './types';

export * from './types';
export { encodePairingUrl, validatePairingEnvelope } from './pairing';

class UnavailableGateway implements DashboardGateway {
  readonly kind = 'unavailable' as const;
  readonly label = 'Initializing data source';
  readonly capabilities = unavailableCapabilities;

  private fail(): never {
    throw new GatewayError('UNAVAILABLE', '브라우저 데이터 환경을 초기화할 수 없습니다.');
  }

  async querySessions(_query?: SessionQuery) { return this.fail(); }
  async querySteps(_query: StepQuery) { return this.fail(); }
  async getCloudSettings() { return this.fail(); }
  async beginOAuth(): Promise<OAuthStart> { return this.fail(); }
  async listOAuthProjects(): Promise<readonly OAuthProject[]> { return this.fail(); }
  async selectOAuthProject(_projectRef: string) { return this.fail(); }
  async beginManualCloudSetup(_projectUrl: string, _publishableKey: string) { return this.fail(); }
  async confirmManualCloudSetup(_setupId: string, _projectUrl: string) { return this.fail(); }
  async createPairing(): Promise<PairingEnvelopeV2> { return this.fail(); }
  async listPairingMembers(): Promise<readonly PairingMember[]> { return this.fail(); }
  async approvePairingMember(_memberId: string): Promise<void> { return this.fail(); }
  async revokePairingMember(_memberId: string): Promise<void> { return this.fail(); }
  async listLegacyMappings() { return this.fail(); }
  async mapLegacyPayload(_payloadHash: string, _verifiedSourceId: string): Promise<void> { return this.fail(); }
}

export function createDashboardGateway(): DashboardGateway {
  if (typeof window === 'undefined') return new UnavailableGateway();
  if (hasElectronGateway() && window.electronAPI) {
    return new ElectronGateway(window.electronAPI);
  }
  return new WebSupabaseGateway();
}
