import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoredDevice } from '../types';

/** What the registry file holds; the lounge tokens are encrypted */
interface RegistryFile {
    version: 1;
    /** ID of this remote control as the TVs know it */
    remoteId: string;
    devices: StoredDevice[];
}

/**
 * The paired YouTube apps, in a file of the instance data directory: the Device Manager changes it at runtime,
 * which `native` could not do without a restart of the instance.
 */
export class Registry {
    devices: StoredDevice[] = [];
    remoteId: string = randomUUID();

    constructor(
        private readonly file: string,
        private readonly encrypt: (text: string) => string,
        private readonly decrypt: (text: string) => string,
    ) {}

    async load(): Promise<void> {
        try {
            const stored = JSON.parse(await fs.readFile(this.file, 'utf8')) as RegistryFile;
            this.remoteId = stored.remoteId || this.remoteId;
            this.devices = (stored.devices || []).map(device => ({
                ...device,
                loungeToken: device.loungeToken ? this.decrypt(device.loungeToken) : '',
            }));
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw e;
            }
        }
    }

    async save(): Promise<void> {
        const content: RegistryFile = {
            version: 1,
            remoteId: this.remoteId,
            devices: this.devices.map(device => ({ ...device, loungeToken: this.encrypt(device.loungeToken) })),
        };
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(`${this.file}.tmp`, JSON.stringify(content, null, 2), { mode: 0o600 });
        await fs.rename(`${this.file}.tmp`, this.file);
    }

    find(id: string): StoredDevice | undefined {
        return this.devices.find(device => device.id === id);
    }

    /** Add a paired app, or update it if its screen is known already */
    async upsert(device: Omit<StoredDevice, 'id'>): Promise<StoredDevice> {
        const id = deviceIdOf(device.screenId);
        const existing = this.find(id);
        if (existing) {
            Object.assign(existing, device);
        } else {
            this.devices.push({ ...device, id });
        }
        await this.save();
        return this.find(id)!;
    }

    async remove(id: string): Promise<void> {
        this.devices = this.devices.filter(device => device.id !== id);
        await this.save();
    }
}

/** A short, stable object ID for a screen; the screen ID itself is a credential and must not show up in IDs */
export function deviceIdOf(screenId: string): string {
    return `tv_${createHash('sha256').update(screenId).digest('hex').slice(0, 8)}`;
}
