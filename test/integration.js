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
            });
        });
    },
});
