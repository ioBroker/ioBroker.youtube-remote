const path = require('path');
const assert = require('node:assert/strict');
const { tests } = require('@iobroker/testing');

/** The answer of a message to the instance */
function send(harness, command, message) {
    return new Promise(resolve => harness.sendTo('youtube-remote.0', command, message, resolve));
}

// Test against a released controller. The testing default uses the development
// branch on newer Node.js versions, which may not initialize iobroker.json.
tests.integration(path.join(__dirname, '..'), {
    controllerVersion: 'latest',
    defineAdditionalTests({ suite }) {
        suite('messages', getHarness => {
            let harness;
            before(async function () {
                this.timeout(60000);
                harness = getHarness();
                await harness.startAdapterAndWait();
            });

            it('answers help', async () => {
                const answer = await send(harness, 'help', {});
                assert.match(answer.help, /search/);
                assert.ok(answer.commands.some(c => c.command === 'search' && !c.write));
            });

            // without words, so the test does not ask YouTube
            it('answers search without words with an error', async () => {
                const answer = await send(harness, 'search', { query: ' ' });
                assert.equal(answer.query, '');
                assert.match(answer.error, /nothing to search/);
                assert.equal(answer.reason, 'BAD_REQUEST');
            });

            // the commands of the shared catalog, without a paired device
            it('answers getPlayers and play', async () => {
                assert.deepEqual(await send(harness, 'getPlayers', {}), { players: [] });
                const answer = await send(harness, 'play', { uri: 'dQw4w9WgXcQ', device: 'TV' });
                assert.equal(answer.reason, 'DEVICE_NOT_FOUND');
                assert.deepEqual(answer.devices, []);
                const help = await send(harness, 'help', {});
                assert.ok(help.commands.some(c => c.command === 'play' && c.write && c.standard === 'media.play'));
            });

            it('answers an unknown command with an error', async () => {
                const answer = await send(harness, 'unknownCommand', {});
                assert.equal(answer.reason, 'NOT_SUPPORTED');
            });
        });
    },
});
