import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'mocha';
import { Registry, deviceIdOf } from './registry';

describe('registry', () => {
    it('stores the lounge token encrypted and reads it back', async () => {
        const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'ytr-')), 'devices.json');
        const encrypt = (text: string): string => Buffer.from(text).toString('base64');
        const decrypt = (text: string): string => Buffer.from(text, 'base64').toString();
        const registry = new Registry(file, encrypt, decrypt);
        await registry.load();
        const device = await registry.upsert({ name: 'Frame', screenId: 'screen-1', loungeToken: 'secret' });
        assert.equal(device.id, deviceIdOf('screen-1'));
        assert.equal((await fs.readFile(file, 'utf8')).includes('secret'), false);

        const again = new Registry(file, encrypt, decrypt);
        await again.load();
        assert.equal(again.find(device.id)?.loungeToken, 'secret');
        assert.equal(again.remoteId, registry.remoteId);

        // pairing the same screen again updates it instead of adding a second one
        await again.upsert({ name: 'Frame', screenId: 'screen-1', loungeToken: 'new' });
        assert.equal(again.devices.length, 1);
        await again.remove(device.id);
        assert.equal(again.devices.length, 0);
    });

    it('does not show the screen ID in the object ID', () => {
        assert.match(deviceIdOf('a-secret-screen-id'), /^tv_[0-9a-f]{8}$/);
    });
});
