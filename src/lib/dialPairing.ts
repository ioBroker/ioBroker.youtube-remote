import http from 'node:http';

const LOUNGE_API = 'https://www.youtube.com/api/lounge';

/** A screen as the lounge reports it for a pairing code */
export interface PairedScreen {
    screenId: string;
    loungeToken: string;
    name?: string;
}

/** The YouTube app as the DIAL description of the TV shows it */
export interface DialYouTubeApp {
    /** HTTP status of the description, 0 without an answer */
    status: number;
    /** `running`, `stopped`, ...; empty if the TV does not say */
    state: string;
    /** Only some TVs report it, mostly only while the app runs; Fire TV never */
    screenId: string | null;
}

/** Launching may take until the app runs: some TVs answer only then */
const LAUNCH_TIMEOUT = 10_000;

function request(
    url: string,
    method: 'GET' | 'POST',
    timeout: number,
    body?: string,
): Promise<{ status: number; body: string }> {
    return new Promise(resolve => {
        const req = http.request(
            url,
            {
                method,
                timeout,
                agent: false,
                // DIAL wants the launch parameters as plain text with a length
                headers:
                    body === undefined
                        ? {}
                        : { 'Content-Type': 'text/plain; charset="utf-8"', 'Content-Length': Buffer.byteLength(body) },
            },
            res => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk: string) => (text += chunk));
                res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
            },
        );
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve({ status: 0, body: '' }));
        req.end(body);
    });
}

function xmlValue(xml: string, tag: string): string {
    return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim() ?? '';
}

/**
 * Read the YouTube app from the DIAL description of the TV.
 *
 * @param appUrl the `appUrl` of the device
 * @param timeout in ms
 */
export async function readYouTubeApp(appUrl: string, timeout = 5000): Promise<DialYouTubeApp> {
    const { status, body } = await request(`${appUrl}YouTube`, 'GET', timeout);
    return {
        status,
        state: status === 200 ? xmlValue(body, 'state') : '',
        screenId: (status === 200 && xmlValue(body, 'screenId')) || null,
    };
}

/**
 * Start the YouTube app over DIAL with a pairing code, as the YouTube phone app does when it casts: the app
 * registers the code for its screen at Google, and `getScreenOfPairingCode` gets the screen with it. This pairs TVs
 * whose DIAL description has no screen ID, e.g. Fire TV.
 *
 * @param appUrl the `appUrl` of the device
 * @param pairingCode a new UUID
 * @param timeout in ms
 * @returns the HTTP status of the TV (201 or 200: started), 0 if it did not answer in time
 */
export async function launchYouTubeWithPairingCode(
    appUrl: string,
    pairingCode: string,
    timeout = LAUNCH_TIMEOUT,
): Promise<number> {
    const body = `pairingCode=${encodeURIComponent(pairingCode)}&theme=cl&dialLaunch=watch`;
    return (await request(`${appUrl}YouTube`, 'POST', timeout, body)).status;
}

/**
 * The screen that registered a pairing code of `launchYouTubeWithPairingCode`.
 *
 * @param pairingCode the code the app was started with
 * @param fetchFn for tests
 * @returns the screen, `null` while the app has not registered the code yet (Google answers 404)
 */
export async function getScreenOfPairingCode(
    pairingCode: string,
    fetchFn: typeof fetch = fetch,
): Promise<PairedScreen | null> {
    try {
        const res = await fetchFn(`${LOUNGE_API}/pairing/get_screen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ pairing_code: pairingCode }).toString(),
            signal: AbortSignal.timeout(10_000),
        });
        if (res.status !== 200) {
            return null;
        }
        const screen = ((await res.json()) as { screen?: Partial<PairedScreen> }).screen;
        return screen?.screenId && screen.loungeToken
            ? { screenId: screen.screenId, loungeToken: screen.loungeToken, name: screen.name }
            : null;
    } catch {
        // offline for a moment: the next try asks again
        return null;
    }
}
