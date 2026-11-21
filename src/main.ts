import * as utils from '@iobroker/adapter-core';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
    type DialDevice,
    type LoungeScreen,
    type NowPlaying,
    YouTubeLounge,
    discoverDialDevices,
    parseYouTubeTarget,
} from '@iobroker/youtube-lounge';
import { catalogError, catalogItems, findPlayer, searchRequestOf } from './lib/catalog';
import { YouTubeDeviceManagement, type YouTubeService } from './lib/DeviceManagement';
import { getScreenOfPairingCode, launchYouTubeWithPairingCode, readYouTubeApp } from './lib/dialPairing';
import { COMMANDS, HELP } from './lib/help';
import { MEDIA_STATES, PLAYER_STATES, type VideoInfo, lookUpVideo, mediaStateOf } from './lib/playerStates';
import { Registry } from './lib/registry';
import {
    MAX_RESULTS,
    type SearchResult,
    type SearchType,
    firstHit,
    resolveTarget,
    searchYouTube,
    withFirstVideo,
} from './lib/search';
import type { StoredDevice } from './types';

/** How long adding a found device waits for the YouTube app to start and report its screen, in ms */
const SCREEN_WAIT = 30_000;
/** How long a video waits for the YouTube app to join the lounge, e.g. while the TV starts, in ms */
const APP_WAIT = 30_000;
/** The same for player commands */
const COMMAND_WAIT = 5_000;
/** The message play answers {ok, pending} if the app takes longer (rule 9 of the shared catalog), in ms */
const PLAY_ANSWER_WAIT = 15_000;

class YouTubeRemote extends utils.Adapter {
    private registry!: Registry;
    private readonly sessions = new Map<string, YouTubeLounge>();
    private readonly videoInfo = new Map<string, VideoInfo | null>();
    /** Per device the last video asked for, so an older one still waiting for the app is dropped */
    private readonly lastTarget = new Map<string, number>();
    private foundDevices: DialDevice[] = [];
    private deviceManagement?: YouTubeDeviceManagement;

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        // useFormatDate: js-controller reads system.config and sets this.language (for the texts of search results)
        super({ ...options, name: 'youtube-remote', useFormatDate: true });
        this.on('ready', () => this.onReady());
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
        this.on('message', obj => this.onMessage(obj));
        this.on('unload', callback => this.onUnload(callback));
    }

    private async onReady(): Promise<void> {
        this.registry = new Registry(
            path.join(utils.getAbsoluteInstanceDataDir(this), 'devices.json'),
            text => this.encrypt(text),
            text => this.decrypt(text),
        );
        await this.registry.load();
        this.deviceManagement = new YouTubeDeviceManagement(this, this.service());
        for (const device of this.registry.devices) {
            await this.createObjects(device);
            this.startSession(device);
        }
        await this.subscribeStatesAsync('*');
    }

    /**
     * `help`, `search`, `getPlayers` and `play`: the Device Manager answers its `dm:` commands itself. search, play
     * and getPlayers follow the shared catalog of ioBroker.assistant (media.search, media.play, media.getPlayers).
     */
    private onMessage(obj: ioBroker.Message): void {
        if (!obj?.command || obj.command.startsWith('dm:')) {
            return;
        }
        const reply = (answer: Record<string, unknown>): void => {
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, answer, obj.callback);
            }
        };
        if (obj.command === 'play') {
            // has an effect: also without a callback
            this.playMessage(obj.message).then(reply, (e: unknown) => {
                const answer = catalogError(e);
                this.log.warn(`play from ${obj.from}: ${answer.error}`);
                reply(answer);
            });
        } else if (!obj.callback) {
            // the others only answer
        } else if (obj.command === 'help') {
            // A description of the adapter and its states for AI agents and script authors
            reply({ help: HELP, commands: COMMANDS });
        } else if (obj.command === 'search') {
            // "Sailing Oceanaire" or {query, type, limit}, also {title, artist, album, offset} of the catalog
            const { query, type, limit, offset } = searchRequestOf(obj.message);
            this.search(query, type, Math.min(MAX_RESULTS, offset + limit)).then(
                found => {
                    const results = found.slice(offset);
                    reply({ query, results, items: catalogItems(results) });
                },
                (e: unknown) => reply({ query, ...catalogError(e) }),
            );
        } else if (obj.command === 'getPlayers') {
            this.players().then(
                players => reply({ players }),
                (e: unknown) => reply(catalogError(e)),
            );
        } else {
            reply({ error: `Unknown command ${obj.command}`, reason: 'NOT_SUPPORTED' });
        }
    }

    private search(query: string, type?: SearchType, limit?: number): Promise<SearchResult[]> {
        return searchYouTube(query, { type, limit, language: this.language });
    }

    /** media.getPlayers: the paired devices, with the room they are in; active = the YouTube app is open */
    private async players(): Promise<{ id: string; name: string; room?: string; active: boolean; kinds: string[] }[]> {
        const rooms = await this.getForeignObjectsAsync('enum.rooms.*', 'enum');
        const roomOf = (id: string): string | undefined => {
            const full = `${this.namespace}.${id}`;
            const room = Object.values(rooms).find(r =>
                r?.common?.members?.some(m => m === full || m.startsWith(`${full}.`)),
            );
            const name = room?.common?.name;
            return typeof name === 'object' && name ? (name[this.language ?? 'en'] ?? name.en) : name;
        };
        return this.registry.devices.map(d => {
            const room = roomOf(d.id);
            return {
                id: d.id,
                name: d.name,
                ...(room ? { room } : {}),
                active: !!this.sessions.get(d.id)?.screenOnline,
                kinds: ['video'],
            };
        });
    }

    /**
     * media.play {uri?, device?}: plays like the state youtube (an ID, URL, handle or words) on the device, without
     * uri it resumes. Answers when the TV took it; if the YouTube app takes longer, {ok, pending} and it goes on.
     */
    private async playMessage(message: unknown): Promise<Record<string, unknown>> {
        const req = (typeof message === 'string' ? { uri: message } : (message ?? {})) as Record<string, unknown>;
        const device = findPlayer(
            this.registry.devices,
            req.device ?? req.deviceId ?? req.deviceName,
            id => !!this.sessions.get(id)?.screenOnline,
        );
        if ('error' in device) {
            return device;
        }
        const uri = typeof req.uri === 'string' ? req.uri.trim() : '';
        const job = uri
            ? this.playText(device.id, uri)
            : this.send(device.id, lounge => lounge.play({ kind: 'command', command: 'play' }), COMMAND_WAIT);
        let timer: ioBroker.Timeout | undefined;
        const pending = new Promise<'pending'>(resolve => {
            timer = this.setTimeout(() => resolve('pending'), PLAY_ANSWER_WAIT);
        });
        const outcome = await Promise.race([job, pending]).finally(() => this.clearTimeout(timer));
        const answer = { device: { id: device.id, name: device.name } };
        if (outcome === 'pending') {
            void job.then(
                done => done || this.log.info(`play on ${device.name}: replaced by a newer command`),
                (e: unknown) => this.log.warn(`play on ${device.name}: ${catalogError(e).error}`),
            );
            return { ok: true, pending: true, ...answer };
        }
        if (!outcome) {
            return { error: 'A newer command for the device replaced it', reason: 'REPLACED', ...answer };
        }
        return { ok: true, ...answer };
    }

    private onUnload(callback: () => void): void {
        for (const lounge of this.sessions.values()) {
            lounge.close();
        }
        callback();
    }

    private service(): YouTubeService {
        return {
            devices: () => this.registry.devices,
            found: () => this.foundDevices.filter(found => !this.registry.devices.some(d => d.udn === found.udn)),
            discover: async () => {
                this.foundDevices = await discoverDialDevices((this.config.discoveryTimeout || 4) * 1000);
                return this.foundDevices;
            },
            addFound: found => this.addFound(found),
            pairWithCode: (code, name, udn) => this.pairWithCode(code, name, udn),
            rename: async (id, name) => {
                const device = this.registry.find(id);
                if (device) {
                    device.name = name;
                    await this.registry.save();
                    await this.extendObjectAsync(id, { common: { name } });
                }
            },
            remove: async id => {
                this.sessions.get(id)?.close();
                this.sessions.delete(id);
                await this.registry.remove(id);
                await this.delObjectAsync(id, { recursive: true });
            },
            play: async (id, target) => {
                await this.playText(id, target);
            },
            search: query => this.search(query, 'all', MAX_RESULTS),
        };
    }

    /** Pair with the screen ID the found device reports; the YouTube app is started over DIAL if it has to */
    private async addFound(found: DialDevice): Promise<StoredDevice> {
        const label = `${found.name || found.ip} (${found.ip})`;
        const lounge = new YouTubeLounge({ name: 'ioBroker', deviceId: this.registry.remoteId });
        const app = await readYouTubeApp(found.appUrl);
        this.log.info(
            `${label}: YouTube over DIAL: HTTP ${app.status || 'no answer'}, state "${app.state}", ${app.screenId ? 'with' : 'without'} screen ID`,
        );
        const screen = app.screenId
            ? await lounge.pairWithScreenId(app.screenId)
            : await this.pairOverDial(found, label, lounge);
        return this.addDevice({ ...screen, name: found.name || found.ip, udn: found.udn }, lounge);
    }

    /**
     * Start the YouTube app with a pairing code, as the YouTube phone app does: the app registers the code at Google
     * (Fire TV reports no screen ID over DIAL), or it reports its screen ID once it runs.
     */
    private async pairOverDial(found: DialDevice, label: string, lounge: YouTubeLounge): Promise<LoungeScreen> {
        const pairingCode = randomUUID();
        const status = await launchYouTubeWithPairingCode(found.appUrl, pairingCode);
        this.log.info(`${label}: start of YouTube with a pairing code: HTTP ${status || 'no answer'}`);
        if (status >= 300) {
            throw new Error(
                `The TV refused to start YouTube over the network (HTTP ${status}). Open YouTube on the TV and add it again, or pair with the TV code`,
            );
        }
        // no answer in time: TVs that answer only once the app runs, the app may come all the same
        const until = Date.now() + SCREEN_WAIT;
        while (Date.now() < until) {
            await new Promise<void>(resolve => this.setTimeout(() => resolve(), 1500));
            const screen = await getScreenOfPairingCode(pairingCode);
            if (screen) {
                this.log.info(`${label}: the YouTube app registered the pairing code`);
                lounge.useScreen({ screenId: screen.screenId, loungeToken: screen.loungeToken });
                return lounge.screen!;
            }
            const app = await readYouTubeApp(found.appUrl);
            if (app.screenId) {
                this.log.info(`${label}: the YouTube app reports its screen ID`);
                return lounge.pairWithScreenId(app.screenId);
            }
        }
        this.log.warn(
            `${label}: the YouTube app neither registered the pairing code nor reported its screen in ${SCREEN_WAIT / 1000} s`,
        );
        throw new Error('The YouTube app of the TV did not report its screen. Pair with the TV code');
    }

    /** Pair with the code the YouTube app shows; `udn` hides the found device it belongs to */
    private async pairWithCode(code: string, name: string, udn?: string): Promise<StoredDevice> {
        const lounge = new YouTubeLounge({ name: 'ioBroker', deviceId: this.registry.remoteId });
        const screen = await lounge.pairWithCode(code);
        return this.addDevice(
            { screenId: screen.screenId, loungeToken: screen.loungeToken, name, ...(udn ? { udn } : {}) },
            lounge,
        );
    }

    private async addDevice(device: Omit<StoredDevice, 'id'>, lounge: YouTubeLounge): Promise<StoredDevice> {
        const stored = await this.registry.upsert(device);
        this.sessions.get(stored.id)?.close();
        await this.createObjects(stored);
        this.startSession(stored, lounge);
        this.log.info(`${stored.name} paired`);
        return stored;
    }

    private startSession(device: StoredDevice, lounge?: YouTubeLounge): void {
        const session = lounge ?? new YouTubeLounge({ name: 'ioBroker', deviceId: this.registry.remoteId });
        session.useScreen({ screenId: device.screenId, loungeToken: device.loungeToken });
        session.on('nowPlaying', (playing: NowPlaying | null) => {
            this.onNowPlaying(device, playing).catch(e => this.log.debug(`${device.name}: ${String(e)}`));
        });
        session.on('volume', ({ volume, muted }: { volume: number; muted: boolean }) => {
            void this.setStateAsync(`${device.id}.volume`, volume, true);
            void this.setStateAsync(`${device.id}.muted`, muted, true);
        });
        session.on('screen', (online: boolean) => void this.setStateAsync(`${device.id}.connected`, online, true));
        session.on('error', (e: Error) => this.log.debug(`${device.name}: ${e.message}`));
        this.sessions.set(device.id, session);
        session.subscribe();
    }

    private async onNowPlaying(device: StoredDevice, playing: NowPlaying | null): Promise<void> {
        const base = device.id;
        await this.syncToken(device);
        await this.setStateAsync(`${base}.state`, mediaStateOf(playing), true);
        await this.setStateAsync(`${base}.playerState`, playing?.state ?? -1, true);
        await this.setStateAsync(`${base}.elapsed`, playing ? Math.round(playing.currentTime) : 0, true);
        await this.setStateAsync(`${base}.duration`, playing ? Math.round(playing.duration) : 0, true);
        const videoId = playing?.videoId ?? '';
        const previous = (await this.getStateAsync(`${base}.videoId`))?.val;
        if (previous === videoId) {
            return;
        }
        await this.setStateAsync(`${base}.videoId`, videoId, true);
        await this.setStateAsync(`${base}.url`, videoId ? `https://youtu.be/${videoId}` : '', true);
        const info = videoId && this.config.lookUpTitles !== false ? await this.lookUp(videoId) : null;
        await this.setStateAsync(`${base}.title`, info?.title ?? '', true);
        await this.setStateAsync(`${base}.artist`, info?.artist ?? '', true);
        await this.setStateAsync(
            `${base}.cover`,
            videoId ? (info?.cover ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`) : '',
            true,
        );
    }

    private async lookUp(videoId: string): Promise<VideoInfo | null> {
        if (!this.videoInfo.has(videoId)) {
            if (this.videoInfo.size > 200) {
                this.videoInfo.clear();
            }
            this.videoInfo.set(videoId, await lookUpVideo(videoId));
        }
        return this.videoInfo.get(videoId) ?? null;
    }

    /** The lounge renews an expired token on its own; store the new one */
    private async syncToken(device: StoredDevice): Promise<void> {
        const token = this.sessions.get(device.id)?.screen?.loungeToken;
        if (token && token !== device.loungeToken) {
            device.loungeToken = token;
            await this.registry.save();
        }
    }

    /**
     * Send when the YouTube app is in the lounge: Google takes commands without it too, and they get lost.
     *
     * @returns false if `stillWanted` says the command is out of date after waiting
     */
    private async send(
        id: string,
        action: (lounge: YouTubeLounge) => Promise<void>,
        wait: number,
        stillWanted: () => boolean = () => true,
    ): Promise<boolean> {
        const lounge = this.sessions.get(id);
        const device = this.registry.find(id);
        if (!lounge || !device) {
            throw new Error(`Unknown device ${id}`);
        }
        if (!(await lounge.waitForScreen(wait))) {
            throw new Error('the YouTube app is not open');
        }
        if (!stillWanted()) {
            return false;
        }
        await action(lounge);
        await this.syncToken(device);
        return true;
    }

    /** Count a new video for the device: it replaces the ones still waiting */
    private nextTarget(id: string): number {
        const call = (this.lastTarget.get(id) ?? 0) + 1;
        this.lastTarget.set(id, call);
        return call;
    }

    /** A video waits for the app as long as the TV may take to start; a newer one replaces it meanwhile */
    private playTarget(id: string, target: string, call?: number): Promise<boolean> {
        const parsed = parseYouTubeTarget(target);
        const current = call ?? this.nextTarget(id);
        return this.send(
            id,
            lounge => lounge.play(parsed),
            APP_WAIT,
            () => this.lastTarget.get(id) === current,
        );
    }

    /**
     * Play what a text means: an ID, URL or command as it is, a handle (`@name`, youtube.com/@name) as the uploads of
     * its channel, other words as the first hit YouTube finds (a channel if they name one, else mostly a video); with
     * `alwaysSearch` (state `search`) always the first hit. A video asked for while it is looked up replaces it.
     */
    private async playText(id: string, text: string, alwaysSearch = false): Promise<boolean> {
        const call = this.nextTarget(id);
        const found = await (alwaysSearch ? firstHit : resolveTarget)(text, { language: this.language });
        // a channel or playlist starts at its first video: the TV ignores it without one
        const target = await withFirstVideo(found.target);
        if (this.lastTarget.get(id) !== call) {
            return false;
        }
        if (found.how !== 'target' || target !== found.target) {
            const what = [found.title, found.channel].filter(Boolean).join(', ');
            this.log.info(`${this.registry.find(id)?.name}: "${text.trim()}" -> ${found.how} ${target} (${what})`);
        }
        return this.playTarget(id, target, call);
    }

    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state || state.ack || !id.startsWith(`${this.namespace}.`)) {
            return;
        }
        const [deviceId, command] = id.slice(this.namespace.length + 1).split('.');
        if (!deviceId || !command || !this.registry.find(deviceId)) {
            return;
        }
        this.execute(deviceId, command, state.val)
            .then(done => (done ? this.acknowledge(id, command, state.val) : undefined))
            .catch(e => this.log.warn(`${command} on ${this.registry.find(deviceId)?.name}: ${String(e)}`));
    }

    /** @returns false if a newer command took its place, then the newer one is acknowledged */
    private async execute(id: string, command: string, value: ioBroker.StateValue): Promise<boolean> {
        switch (command) {
            case 'youtube':
            case 'search':
                return typeof value === 'string' && value.trim()
                    ? this.playText(id, value, command === 'search')
                    : true;
            case 'play':
            case 'pause':
            case 'next':
            case 'prev':
                if (value) {
                    await this.send(
                        id,
                        lounge => lounge.play({ kind: 'command', command: command === 'prev' ? 'previous' : command }),
                        COMMAND_WAIT,
                    );
                }
                return true;
            case 'seek':
                await this.send(id, lounge => lounge.seekTo(Number(value)), COMMAND_WAIT);
                return true;
            case 'volume':
                await this.send(id, lounge => lounge.setVolume(Number(value)), COMMAND_WAIT);
                return true;
            case 'muted':
                await this.send(id, lounge => lounge.setMuted(!!value), COMMAND_WAIT);
                return true;
            default:
                return true;
        }
    }

    /** Buttons and the target go back to their rest value, the others keep what was written */
    private async acknowledge(id: string, command: string, value: ioBroker.StateValue): Promise<void> {
        if (command === 'youtube' || command === 'search') {
            await this.setStateAsync(id, '', true);
        } else if (['play', 'pause', 'next', 'prev'].includes(command)) {
            await this.setStateAsync(id, false, true);
        } else if (['seek', 'volume', 'muted'].includes(command)) {
            await this.setStateAsync(id, value, true);
        }
    }

    /** One device with the states of the type-detector type `mediaPlayer` */
    private async createObjects(device: StoredDevice): Promise<void> {
        const base = device.id;
        await this.extendObjectAsync(base, { type: 'device', common: { name: device.name }, native: {} });
        const state = async (
            id: string,
            name: string,
            type: ioBroker.CommonType,
            role: string,
            write: boolean,
            extra: Partial<ioBroker.StateCommon> = {},
        ): Promise<void> => {
            await this.extendObjectAsync(`${base}.${id}`, {
                type: 'state',
                common: { name, type, role, read: !role.startsWith('button'), write, ...extra },
                native: {},
            });
        };
        await state('youtube', 'Play video, playlist, channel or URL', 'string', 'text', true);
        await state('search', 'Search and play the first hit', 'string', 'text', true);
        await state('play', 'Play', 'boolean', 'button.play', true);
        await state('pause', 'Pause', 'boolean', 'button.pause', true);
        await state('next', 'Next', 'boolean', 'button.next', true);
        await state('prev', 'Previous', 'boolean', 'button.prev', true);
        await state('state', 'State', 'number', 'media.state', false, { states: MEDIA_STATES });
        await state('playerState', 'Player state', 'number', 'value', false, { states: PLAYER_STATES });
        await state('title', 'Title', 'string', 'media.title', false);
        await state('artist', 'Channel', 'string', 'media.artist', false);
        await state('cover', 'Picture', 'string', 'media.cover', false);
        await state('videoId', 'Video ID', 'string', 'text', false);
        await state('url', 'Video URL', 'string', 'text.url', false);
        await state('duration', 'Length', 'number', 'media.duration', false, { unit: 's' });
        await state('elapsed', 'Position', 'number', 'media.elapsed', false, { unit: 's' });
        await state('seek', 'Jump to', 'number', 'media.seek', true, { unit: 's', min: 0 });
        await state('volume', 'Volume', 'number', 'level.volume', true, { min: 0, max: 100, unit: '%' });
        await state('muted', 'Muted', 'boolean', 'media.mute', true);
        await state('connected', 'Connected', 'boolean', 'indicator.reachable', false);
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new YouTubeRemote(options);
} else {
    (() => new YouTubeRemote())();
}
