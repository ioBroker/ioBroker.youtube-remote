import * as utils from '@iobroker/adapter-core';
import path from 'node:path';
import {
    type DialDevice,
    type NowPlaying,
    YouTubeLounge,
    discoverDialDevices,
    getYouTubeScreenId,
    launchYouTubeOverDial,
    parseYouTubeTarget,
} from '@iobroker/youtube-lounge';
import { YouTubeDeviceManagement, type YouTubeService } from './lib/DeviceManagement';
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

/** How long adding a found device waits for the YouTube app to report its screen, in ms */
const SCREEN_WAIT = 15_000;
/** How long a video waits for the YouTube app to join the lounge, e.g. while the TV starts, in ms */
const APP_WAIT = 30_000;
/** The same for player commands */
const COMMAND_WAIT = 5_000;

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

    /** `help` and `search`: the Device Manager answers its `dm:` commands itself */
    private onMessage(obj: ioBroker.Message): void {
        if (!obj?.callback) {
            return;
        }
        if (obj.command === 'help') {
            // A description of the adapter and its states for AI agents and script authors
            this.sendTo(obj.from, obj.command, { help: HELP, commands: COMMANDS }, obj.callback);
        } else if (obj.command === 'search') {
            // "Sailing Oceanaire" or {query, type, limit}
            const message = (typeof obj.message === 'string' ? { query: obj.message } : (obj.message ?? {})) as {
                query?: string;
                type?: SearchType;
                limit?: number;
            };
            const query = String(message.query ?? '').trim();
            this.search(query, message.type, message.limit).then(
                results => this.sendTo(obj.from, obj.command, { query, results }, obj.callback),
                (e: unknown) =>
                    this.sendTo(
                        obj.from,
                        obj.command,
                        { query, error: e instanceof Error ? e.message : String(e) },
                        obj.callback,
                    ),
            );
        }
    }

    private search(query: string, type?: SearchType, limit?: number): Promise<SearchResult[]> {
        return searchYouTube(query, { type, limit, language: this.language });
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
            pairWithCode: (code, name) => this.pairWithCode(code, name),
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
        let screenId = await getYouTubeScreenId(found.appUrl);
        if (!screenId && (await launchYouTubeOverDial(found.appUrl))) {
            const until = Date.now() + SCREEN_WAIT;
            while (!screenId && Date.now() < until) {
                await new Promise<void>(resolve => this.setTimeout(() => resolve(), 1500));
                screenId = await getYouTubeScreenId(found.appUrl);
            }
        }
        if (!screenId) {
            throw new Error(
                'The YouTube app does not report its screen. Open YouTube on the device or pair with the TV code',
            );
        }
        const lounge = new YouTubeLounge({ name: 'ioBroker', deviceId: this.registry.remoteId });
        const screen = await lounge.pairWithScreenId(screenId);
        return this.addDevice({ ...screen, name: found.name || found.ip, udn: found.udn }, lounge);
    }

    private async pairWithCode(code: string, name: string): Promise<StoredDevice> {
        const lounge = new YouTubeLounge({ name: 'ioBroker', deviceId: this.registry.remoteId });
        const screen = await lounge.pairWithCode(code);
        return this.addDevice({ screenId: screen.screenId, loungeToken: screen.loungeToken, name }, lounge);
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
