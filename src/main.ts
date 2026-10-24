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
import { MEDIA_STATES, PLAYER_STATES, type VideoInfo, lookUpVideo, mediaStateOf } from './lib/playerStates';
import { Registry } from './lib/registry';
import type { StoredDevice } from './types';

/** How long adding a found device waits for the YouTube app to report its screen, in ms */
const SCREEN_WAIT = 15_000;

class YouTubeRemote extends utils.Adapter {
    private registry!: Registry;
    private readonly sessions = new Map<string, YouTubeLounge>();
    private readonly videoInfo = new Map<string, VideoInfo | null>();
    private foundDevices: DialDevice[] = [];
    private deviceManagement?: YouTubeDeviceManagement;

    constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({ ...options, name: 'youtube-remote' });
        this.on('ready', () => this.onReady());
        this.on('stateChange', (id, state) => this.onStateChange(id, state));
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
            play: (id, target) => this.send(id, lounge => lounge.play(parseYouTubeTarget(target))),
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
        session.on('disconnected', () => void this.setStateAsync(`${device.id}.connected`, false, true));
        session.on('error', (e: Error) => {
            this.log.debug(`${device.name}: ${e.message}`);
            void this.setStateAsync(`${device.id}.connected`, false, true);
        });
        this.sessions.set(device.id, session);
        session.subscribe();
    }

    private async onNowPlaying(device: StoredDevice, playing: NowPlaying | null): Promise<void> {
        const base = device.id;
        await this.setStateAsync(`${base}.connected`, true, true);
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

    private async send(id: string, action: (lounge: YouTubeLounge) => Promise<void>): Promise<void> {
        const lounge = this.sessions.get(id);
        const device = this.registry.find(id);
        if (!lounge || !device) {
            throw new Error(`Unknown device ${id}`);
        }
        await action(lounge);
        await this.setStateAsync(`${id}.connected`, true, true);
        await this.syncToken(device);
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
            .then(() => this.acknowledge(id, command, state.val))
            .catch(e => this.log.warn(`${command} on ${this.registry.find(deviceId)?.name}: ${String(e)}`));
    }

    private async execute(id: string, command: string, value: ioBroker.StateValue): Promise<void> {
        switch (command) {
            case 'youtube':
                if (typeof value === 'string' && value.trim()) {
                    await this.send(id, lounge => lounge.play(parseYouTubeTarget(value)));
                }
                return;
            case 'play':
            case 'pause':
            case 'next':
            case 'prev':
                if (value) {
                    await this.send(id, lounge =>
                        lounge.play({ kind: 'command', command: command === 'prev' ? 'previous' : command }),
                    );
                }
                return;
            case 'seek':
                await this.send(id, lounge => lounge.seekTo(Number(value)));
                return;
            case 'volume':
                await this.send(id, lounge => lounge.setVolume(Number(value)));
                return;
            case 'muted':
                await this.send(id, lounge => lounge.setMuted(!!value));
                return;
            default:
                return;
        }
    }

    /** Buttons and the target go back to their rest value, the others keep what was written */
    private async acknowledge(id: string, command: string, value: ioBroker.StateValue): Promise<void> {
        if (command === 'youtube') {
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
