import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'mocha';
import { getScreenOfPairingCode, launchYouTubeWithPairingCode, readYouTubeApp } from './dialPairing';

/** A DIAL server: the launch gets `status` after `delay` ms, the description `xml`; it keeps what it got */
async function dialServer(
    status: number,
    xml = '',
    delay = 0,
): Promise<{
    appUrl: string;
    requests: { method?: string; url?: string; type?: string; length?: string; body: string }[];
    close: () => void;
}> {
    const requests: { method?: string; url?: string; type?: string; length?: string; body: string }[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
            requests.push({
                method: req.method,
                url: req.url,
                type: req.headers['content-type'],
                length: req.headers['content-length'],
                body,
            });
            if (req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'text/xml' });
                res.end(xml);
                return;
            }
            setTimeout(() => {
                res.writeHead(status, status === 201 ? { LOCATION: 'http://localhost/apps/YouTube/run' } : {});
                res.end();
            }, delay);
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { appUrl: `http://127.0.0.1:${port}/apps/`, requests, close: () => server.close() };
}

function answer(status: number, body: unknown): typeof fetch {
    return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('pairing over DIAL with a pairing code', () => {
    it('starts YouTube with the pairing code as the phone app does', async () => {
        const server = await dialServer(201);
        try {
            assert.equal(
                await launchYouTubeWithPairingCode(server.appUrl, 'f4c1a2b3-0000-4000-8000-123456789abc'),
                201,
            );
            const request = server.requests[0]!;
            assert.equal(server.requests.length, 1);
            assert.equal(request.method, 'POST');
            assert.equal(request.url, '/apps/YouTube');
            assert.match(request.type ?? '', /^text\/plain/);
            assert.equal(request.body, 'pairingCode=f4c1a2b3-0000-4000-8000-123456789abc&theme=cl&dialLaunch=watch');
            assert.equal(request.length, String(request.body.length));
        } finally {
            server.close();
        }
    });

    it('reports a refused launch with its status, no answer as 0', async () => {
        const refusing = await dialServer(403);
        const slow = await dialServer(201, '', 1000);
        try {
            assert.equal(await launchYouTubeWithPairingCode(refusing.appUrl, 'code'), 403);
            // a TV that answers only once the app runs
            assert.equal(await launchYouTubeWithPairingCode(slow.appUrl, 'code', 200), 0);
        } finally {
            refusing.close();
            slow.close();
        }
        assert.equal(await launchYouTubeWithPairingCode('http://127.0.0.1:1/apps/', 'code', 500), 0);
    });

    it('reads state and screen ID of the YouTube app', async () => {
        const fireTv = await dialServer(
            201,
            '<service xmlns="urn:dial-multiscreen-org:schemas:dial"><name>YouTube</name><state>stopped</state></service>',
        );
        const samsung = await dialServer(
            201,
            '<service><name>YouTube</name><state>running</state><additionalData><screenId>abc123</screenId></additionalData></service>',
        );
        try {
            assert.deepEqual(await readYouTubeApp(fireTv.appUrl), { status: 200, state: 'stopped', screenId: null });
            assert.deepEqual(await readYouTubeApp(samsung.appUrl), {
                status: 200,
                state: 'running',
                screenId: 'abc123',
            });
        } finally {
            fireTv.close();
            samsung.close();
        }
        assert.deepEqual(await readYouTubeApp('http://127.0.0.1:1/apps/', 500), {
            status: 0,
            state: '',
            screenId: null,
        });
    });

    it('gets the screen once the app registered the code', async () => {
        let sent: RequestInit | undefined;
        const fetchFn = ((_url: string, init: RequestInit) => {
            sent = init;
            return Promise.resolve(
                new Response(
                    JSON.stringify({ screen: { screenId: 'screen-1', loungeToken: 'token-1', name: 'Fire TV' } }),
                ),
            );
        }) as unknown as typeof fetch;
        assert.deepEqual(await getScreenOfPairingCode('the-code', fetchFn), {
            screenId: 'screen-1',
            loungeToken: 'token-1',
            name: 'Fire TV',
        });
        // the UUID goes as it is, unlike the digits of a TV code
        assert.equal(sent?.body, 'pairing_code=the-code');
    });

    it('waits while the code is not registered yet', async () => {
        assert.equal(await getScreenOfPairingCode('the-code', answer(404, {})), null);
        assert.equal(await getScreenOfPairingCode('the-code', answer(200, { screen: { screenId: 'x' } })), null);
        const offline: typeof fetch = () => Promise.reject(new Error('ENOTFOUND'));
        assert.equal(await getScreenOfPairingCode('the-code', offline), null);
    });
});
