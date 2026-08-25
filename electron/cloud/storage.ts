import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class AtomicConfigStore<T extends object> {
  readonly #path: string;
  constructor(path: string) { this.#path = path; }

  async read(): Promise<T | undefined> {
    try {
      const raw = await readFile(this.#path, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Config must be an object');
      return parsed as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${randomBytes(12).toString('hex')}.tmp`);
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(temporary, 0o600);
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.#path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

interface VaultEnvelope { readonly version: 1; readonly ciphertext: string }

/** Main-process credential vault backed by Electron safeStorage-compatible crypto. */
export class CredentialVault {
  readonly #safeStorage: SafeStorageLike;
  readonly #store: AtomicConfigStore<VaultEnvelope>;
  constructor(safeStorage: SafeStorageLike, path: string) {
    this.#safeStorage = safeStorage;
    this.#store = new AtomicConfigStore(path);
  }

  async save(secret: string): Promise<void> {
    if (!this.#safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
    if (!secret) throw new Error('Credential must not be empty');
    const ciphertext = this.#safeStorage.encryptString(secret).toString('base64');
    await this.#store.write({ version: 1, ciphertext });
  }

  async load(): Promise<string | undefined> {
    const envelope = await this.#store.read();
    if (!envelope) return undefined;
    if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string') throw new Error('Credential vault is malformed');
    if (!this.#safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable');
    return this.#safeStorage.decryptString(Buffer.from(envelope.ciphertext, 'base64'));
  }

  clear(): Promise<void> { return this.#store.clear(); }
}
