import { GatewayError, type PairingEnvelopeV2 } from './types';

const MAX_PAIRING_LIFETIME_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 5_000;
const PAIRING_CLAIM_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{22,128}$/i;

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function isAllowedPublishableKey(key: string): boolean {
  if (key.length < 20 || /service[_-]?role|secret/i.test(key)) return false;
  if (!key.startsWith('eyJ')) return key.startsWith('sb_publishable_');

  try {
    const payload = JSON.parse(decodeBase64Url(key.split('.')[1] || '')) as { role?: unknown };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}

export function validatePairingEnvelope(
  value: unknown,
  now = Date.now(),
): PairingEnvelopeV2 {
  if (!value || typeof value !== 'object') {
    throw new GatewayError('INVALID_PAIRING', '페어링 정보 형식이 올바르지 않습니다.');
  }

  const candidate = value as Partial<PairingEnvelopeV2>;
  const record = value as Record<string, unknown>;
  const expiresAt = typeof candidate.exp === 'number' ? candidate.exp : NaN;
  let projectUrl: URL;
  try {
    projectUrl = new URL(candidate.url || '');
  } catch {
    throw new GatewayError('INVALID_PAIRING', 'Supabase 프로젝트 주소가 올바르지 않습니다.');
  }

  if (
    Object.keys(record).length !== 4 ||
    !['v', 'url', 'token', 'exp'].every((key) => key in record) ||
    candidate.v !== 2 ||
    projectUrl.protocol !== 'https:' ||
    Boolean(projectUrl.username || projectUrl.password || projectUrl.port || projectUrl.search || projectUrl.hash) ||
    (projectUrl.pathname !== '/' && projectUrl.pathname !== '') ||
    !/^[a-z0-9-]+\.supabase\.co$/i.test(projectUrl.hostname) ||
    typeof candidate.token !== 'string' ||
    !PAIRING_CLAIM_TOKEN.test(candidate.token) ||
    !Number.isFinite(expiresAt)
  ) {
    throw new GatewayError('INVALID_PAIRING', '페어링 QR 형식이 올바르지 않거나 허용되지 않은 필드가 포함되어 있습니다.');
  }

  if (expiresAt <= now - CLOCK_SKEW_MS) {
    throw new GatewayError('INVALID_PAIRING', '페어링 QR의 유효 시간이 만료되었습니다.');
  }
  if (expiresAt > now + MAX_PAIRING_LIFETIME_MS + CLOCK_SKEW_MS) {
    throw new GatewayError('INVALID_PAIRING', '페어링 QR의 유효 시간은 5분을 넘을 수 없습니다.');
  }

  return {
    v: 2,
    url: projectUrl.origin,
    token: candidate.token,
    exp: expiresAt,
  };
}

/** Parses only #pair=<base64url-json>. Cleanup happens after a durable claim. */
export function consumePairingHash(location: Location, now = Date.now()): PairingEnvelopeV2 | null {
  const rawHash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(rawHash);
  const encoded = params.get('pair');
  const containsPairingMaterial = encoded !== null || params.has('sync');

  if (!containsPairingMaterial) return null;

  if (!encoded || params.has('sync')) {
    throw new GatewayError('INVALID_PAIRING', '이전 형식의 QR은 지원되지 않습니다. 데스크톱에서 새 QR을 생성해주세요.');
  }

  try {
    return validatePairingEnvelope(JSON.parse(decodeBase64Url(encoded)), now);
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    throw new GatewayError('INVALID_PAIRING', '페어링 QR을 해석할 수 없습니다.');
  }
}

export function clearPairingHash(location: Location): void {
  window.history.replaceState(null, '', `${location.pathname}${location.search}`);
}

export function encodePairingUrl(webUrl: string, envelope: PairingEnvelopeV2): string {
  const target = new URL(webUrl);
  target.hash = `pair=${encodeBase64Url(JSON.stringify(validatePairingEnvelope(envelope)))}`;
  return target.toString();
}
