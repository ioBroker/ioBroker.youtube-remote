import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'mocha';
import { COMMANDS, HELP } from './help';

/** The commands `onMessage` of src/main.ts answers */
function commandsOfMain(): string[] {
    const source = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf8');
    const start = source.indexOf('private onMessage(');
    const end = source.indexOf('private onUnload(');
    assert.ok(start > 0 && end > start, 'onMessage found');
    return [...source.slice(start, end).matchAll(/command === '([^']+)'/g)].map(m => m[1]!);
}

/** The commands the Device Manager of dm-utils answers */
function commandsOfDeviceManager(): string[] {
    const file = path.join(path.dirname(require.resolve('@iobroker/dm-utils')), 'DeviceManagement.js');
    return [...fs.readFileSync(file, 'utf8').matchAll(/case '(dm:[^']+)':/g)].map(m => m[1]!);
}

describe('help', () => {
    it('lists exactly the commands the instance answers', () => {
        const names = COMMANDS.map(c => c.command);
        assert.equal(new Set(names).size, names.length, 'each command once');
        assert.deepEqual([...names].sort(), [...commandsOfMain(), ...commandsOfDeviceManager()].sort());
    });

    it('marks the commands with an effect as write', () => {
        const write = Object.fromEntries(COMMANDS.map(c => [c.command, c.write]));
        assert.equal(write.help, false);
        for (const command of ['dm:instanceAction', 'dm:deviceAction', 'dm:deviceControl', 'dm:actionProgress']) {
            assert.equal(write[command], true, command);
        }
    });

    it('names every command and the states an agent writes and reads', () => {
        for (const word of [
            ...COMMANDS.map(c => c.command),
            'sendTo youtube-remote.0',
            'youtube-remote.0.<device>',
            'youtube (string)',
            'play, pause, next, prev',
            'seek',
            'volume',
            'muted',
            'state:',
            'playerState',
            'title',
            'artist',
            'elapsed',
            'connected',
            'ask which one',
        ]) {
            assert.ok(HELP.includes(word), word);
        }
    });

    it('describes every state of a device', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../src/main.ts'), 'utf8');
        const states = [...source.matchAll(/await state\('([^']+)'/g)].map(m => m[1]!);
        assert.ok(states.length > 10, 'states found');
        for (const state of states) {
            assert.match(HELP, new RegExp(`\\b${state}\\b`), state);
        }
    });

    it('keeps the lines short', () => {
        for (const line of HELP.split('\n')) {
            assert.ok(line.length <= 120, line);
        }
    });
});
