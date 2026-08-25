export const DESKTOP_RENDERER_ORIGIN = 'app://tokkie';

export function parseDevRendererUrl(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.hash) {
    throw new Error('TOKKIE_DEV_URL must be an HTTP loopback URL');
  }
  return url;
}

export function rendererUrlIsTrusted(rawUrl: string, developmentOrigin?: string): boolean {
  const url = new URL(rawUrl);
  if (developmentOrigin) return url.origin === developmentOrigin;
  return url.protocol === 'app:' && url.hostname === 'tokkie' &&
    !url.username && !url.password && !url.port;
}

export function validateExternalUrl(rawUrl: string, allowedOrigins: ReadonlySet<string>): string {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || !allowedOrigins.has(url.origin)) {
    throw new Error('External URL origin is not allowlisted');
  }
  return url.toString();
}

export function findTokkieDeepLink(commandLine: readonly string[]): string | undefined {
  return commandLine.find((argument) => argument.startsWith('tokkie://'));
}
