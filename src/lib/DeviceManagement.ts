import type { AdapterInstance } from '@iobroker/adapter-core';
import {
    DeviceManagement,
    type ActionContext,
    type ControlState,
    type DeviceControl,
    type DeviceDetails,
    type DeviceInfo,
    type DeviceLoadContext,
    type DeviceRefreshResponse,
    type InstanceDetails,
    type InstanceRefreshResponse,
} from '@iobroker/dm-utils';
import type { DialDevice } from '@iobroker/youtube-lounge';
import type { StoredDevice } from '../types';
import type { SearchResult } from './search';

/** What the Device Manager needs from the adapter */
export interface YouTubeService {
    devices(): StoredDevice[];
    /** Devices of the last search that are not added yet */
    found(): DialDevice[];
    discover(): Promise<DialDevice[]>;
    addFound(device: DialDevice, name: string): Promise<StoredDevice>;
    /** `udn`: the found device the code belongs to, to hide it from the found devices */
    pairWithCode(code: string, name: string, udn?: string): Promise<StoredDevice>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    play(id: string, target: string): Promise<void>;
    /** Videos, channels and playlists for the words, best first */
    search(query: string): Promise<SearchResult[]>;
}

type Text = ioBroker.StringOrTranslated;

const T = {
    search: { en: 'Search', de: 'Suchen' },
    searchDescription: {
        en: 'Search the network for TVs and devices with the YouTube app',
        de: 'Fernseher und Geräte mit der YouTube-App im Netzwerk suchen',
    },
    found: { en: '%s device(s) found', de: '%s Gerät(e) gefunden' },
    pairCode: { en: 'Pair with TV code', de: 'Mit TV-Code koppeln' },
    pairCodeDescription: {
        en: 'For every device: the YouTube app shows the code under Settings > Link with TV code',
        de: 'Für jedes Gerät: Die YouTube-App zeigt den Code unter Einstellungen > Mit TV-Code verknüpfen',
    },
    code: { en: 'TV code', de: 'TV-Code' },
    name: { en: 'Name', de: 'Name' },
    add: { en: 'Add', de: 'Hinzufügen' },
    addFailedCode: {
        en: 'Pair it with the TV code instead: the YouTube app on the device shows it under Settings > Link with TV code.',
        de: 'Kopple es stattdessen mit dem TV-Code: Die YouTube-App auf dem Gerät zeigt ihn unter Einstellungen > Mit TV-Code verknüpfen.',
    },
    addHint: {
        en: 'Switch the device on. If it cannot be added, open YouTube on it once or pair with the TV code.',
        de: 'Schalte das Gerät ein. Klappt das Hinzufügen nicht, öffne YouTube einmal darauf oder kopple mit dem TV-Code.',
    },
    added: { en: 'Paired', de: 'Gekoppelt' },
    failed: { en: 'Failed', de: 'Fehlgeschlagen' },
    rename: { en: 'Rename', de: 'Umbenennen' },
    remove: { en: 'Remove', de: 'Entfernen' },
    removeConfirm: { en: 'Remove this device?', de: 'Dieses Gerät entfernen?' },
    play: { en: 'Play', de: 'Abspielen' },
    playTarget: {
        en: 'Video, playlist, channel (UC… or @handle), YouTube URL or search words',
        de: 'Video, Playlist, Kanal (UC… oder @Handle), YouTube-URL oder Suchbegriffe',
    },
    searchPlay: { en: 'Search and play', de: 'Suchen und abspielen' },
    searchWords: { en: 'Search words, e.g. Sailing Oceanaire', de: 'Suchbegriffe, z. B. Sailing Oceanaire' },
    result: { en: 'What to play', de: 'Was abspielen' },
    nothingFound: { en: 'YouTube found nothing', de: 'YouTube hat nichts gefunden' },
    live: { en: 'live', de: 'live' },
    paired: { en: 'Paired devices', de: 'Gekoppelte Geräte' },
    discovered: { en: 'Found devices', de: 'Gefundene Geräte' },
    title: { en: 'Title', de: 'Titel' },
    channel: { en: 'Channel', de: 'Kanal' },
    previous: { en: 'Previous', de: 'Zurück' },
    pause: { en: 'Pause', de: 'Pause' },
    next: { en: 'Next', de: 'Weiter' },
    volume: { en: 'Volume', de: 'Lautstärke' },
    muted: { en: 'Muted', de: 'Stumm' },
    playing: { en: 'Playing', de: 'Spielt' },
    paused: { en: 'Paused', de: 'Pausiert' },
    stopped: { en: 'Stopped', de: 'Gestoppt' },
    position: { en: 'Position', de: 'Position' },
};

type StateResult = ioBroker.State | { error: { code: number; message: string } };

/** `m:ss` or `h:mm:ss` */
function duration(seconds: unknown): string {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const [h, m, sec] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
    const two = (n: number): string => String(n).padStart(2, '0');
    return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}

/** A line of the result list: "Title · Channel · 17:14", "Channel: Name (@handle)", "Playlist: Title · Channel" */
function labelOf(result: SearchResult): ioBroker.Translated {
    const join = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(' · ');
    const both = (en: string, de: string): ioBroker.Translated => ({ en, de });
    if (result.type === 'channel') {
        const name = result.handle ? `${result.title} (${result.handle})` : result.title;
        return both(`Channel: ${name}`, `Kanal: ${name}`);
    }
    if (result.type === 'playlist') {
        return both(
            `Playlist: ${join(result.title, result.channel)}`,
            `Playlist: ${join(result.title, result.channel)}`,
        );
    }
    return both(
        join(result.title, result.channel, result.live ? T.live.en : result.duration ? duration(result.duration) : ''),
        join(result.title, result.channel, result.live ? T.live.de : result.duration ? duration(result.duration) : ''),
    );
}

function withError(text: Text, error: unknown): Text {
    const message = error instanceof Error ? error.message : String(error);
    return typeof text === 'string'
        ? `${text}: ${message}`
        : (Object.fromEntries(
              Object.entries(text).map(([lang, value]) => [lang, `${value}: ${message}`]),
          ) as ioBroker.Translated);
}

export class YouTubeDeviceManagement extends DeviceManagement {
    constructor(
        adapter: AdapterInstance,
        private readonly service: YouTubeService,
    ) {
        super(adapter, true);
    }

    override getInstanceInfo(): InstanceDetails {
        return {
            apiVersion: 'v3',
            communicationStateId: 'info.deviceManager',
            actions: [
                {
                    id: 'discover',
                    icon: 'search',
                    title: T.search,
                    description: T.searchDescription,
                    handler: context => this.discover(context),
                },
                {
                    id: 'pair-code',
                    icon: 'add',
                    title: T.pairCode,
                    description: T.pairCodeDescription,
                    handler: context => this.pairCode(context),
                },
            ],
        };
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- dm-utils awaits it
    override async loadDevices(context: DeviceLoadContext<string>): Promise<void> {
        const namespace = this.adapter.namespace;
        const devices: DeviceInfo<string>[] = this.service.devices().map(device => ({
            id: device.id,
            identifier: device.id,
            name: device.name,
            icon: 'tv',
            manufacturer: 'YouTube',
            status: {
                connection: {
                    stateId: `${namespace}.${device.id}.connected`,
                    mapping: { true: 'connected', false: 'disconnected' },
                },
            },
            indicators: [
                {
                    id: 'state',
                    value: { stateId: `${namespace}.${device.id}.state` },
                    levels: [
                        { value: 1, icon: 'play', color: 'ok', text: T.playing },
                        { value: 0, icon: 'pause', color: 'warning', text: T.paused },
                        { icon: 'stop', color: 'inactive', text: T.stopped },
                    ],
                    hideIfEmpty: false,
                    order: 1,
                },
            ],
            controls: this.controlsOf(device.id),
            hasDetails: true,
            actions: [
                { id: 'play', icon: 'play', description: T.play, handler: (id, ctx) => this.play(id, ctx) },
                {
                    id: 'search',
                    icon: 'search',
                    description: T.searchPlay,
                    handler: (id, ctx) => this.searchAndPlay(id, ctx),
                },
                { id: 'rename', icon: 'rename', description: T.rename, handler: (id, ctx) => this.rename(id, ctx) },
                {
                    id: 'delete',
                    icon: 'delete',
                    description: T.remove,
                    confirmation: T.removeConfirm,
                    handler: id => this.remove(id),
                },
            ],
            group: { key: 'paired', name: T.paired, icon: 'tv' },
        }));
        for (const found of this.service.found()) {
            devices.push({
                id: `found:${found.udn || found.ip}`,
                identifier: found.ip,
                name: found.name || found.ip,
                icon: 'search',
                manufacturer: found.manufacturer,
                model: found.model,
                status: 'connected',
                actions: [
                    {
                        id: 'add',
                        icon: 'add',
                        title: T.add,
                        variant: 'contained',
                        description: T.addHint,
                        timeout: 90000,
                        handler: (id, ctx) => this.addFound(id, ctx),
                    },
                ],
                group: { key: 'found', name: T.discovered, icon: 'search' },
            });
        }
        context.setTotalDevices(devices.length);
        devices.forEach(device => context.addDevice(device));
    }

    /**
     * Title and channel live on the card, the player buttons, volume and mute. They write the states of the device,
     * so they work like a script writing them.
     */
    private controlsOf(id: string): DeviceControl<string>[] {
        const base = `${this.adapter.namespace}.${id}`;
        const handler = async (_deviceId: string, control: string, value: ControlState): Promise<StateResult> => {
            try {
                await this.adapter.setForeignStateAsync(`${base}.${control}`, value, false);
            } catch (error) {
                return { error: { code: 500, message: error instanceof Error ? error.message : String(error) } };
            }
            return { val: value, ack: true, ts: Date.now(), lc: Date.now(), from: this.adapter.namespace };
        };
        const getStateHandler = async (_deviceId: string, control: string): Promise<StateResult> =>
            (await this.adapter.getForeignStateAsync(`${base}.${control}`)) ?? {
                val: null,
                ack: true,
                ts: Date.now(),
                lc: Date.now(),
                from: this.adapter.namespace,
            };
        const button = (control: string, icon: string, label: Text): DeviceControl<string> => ({
            id: control,
            type: 'button',
            icon,
            label,
            handler: (deviceId: string, controlId: string) => handler(deviceId, controlId, true),
        });
        const controls: DeviceControl<string>[] = [
            { id: 'title', type: 'info', label: T.title, stateId: `${base}.title`, noTranslation: true },
            { id: 'artist', type: 'info', label: T.channel, stateId: `${base}.artist`, noTranslation: true },
            button('prev', 'previous', T.previous),
            button('play', 'play', T.play),
            button('pause', 'pause', T.pause),
            button('next', 'next', T.next),
            {
                id: 'volume',
                type: 'slider',
                label: T.volume,
                stateId: `${base}.volume`,
                min: 0,
                max: 100,
                step: 1,
                unit: '%',
                controlDelay: 500,
                handler,
            },
            { id: 'muted', type: 'switch', label: T.muted, stateId: `${base}.muted`, handler },
        ];
        return controls.map(control => ({ ...control, getStateHandler }));
    }

    override async getDeviceDetails(id: string): Promise<DeviceDetails<string> | null> {
        const device = this.service.devices().find(entry => entry.id === id);
        if (!device) {
            return null;
        }
        const base = `${this.adapter.namespace}.${id}`;
        const value = async (state: string): Promise<ioBroker.StateValue> =>
            (await this.adapter.getForeignStateAsync(`${base}.${state}`))?.val ?? null;
        const [title, artist, url, cover, elapsed, length] = await Promise.all(
            ['title', 'artist', 'url', 'cover', 'elapsed', 'duration'].map(value),
        );
        return {
            id,
            schema: {
                type: 'panel',
                items: {
                    name: { type: 'staticInfo', label: T.name, data: device.name, xs: 12 },
                    title: { type: 'staticInfo', label: T.title, data: String(title || '-'), xs: 12 },
                    artist: { type: 'staticInfo', label: T.channel, data: String(artist || '-'), xs: 12 },
                    position: {
                        type: 'staticInfo',
                        label: T.position,
                        data: length ? `${duration(elapsed)} / ${duration(length)}` : '-',
                        xs: 12,
                    },
                    // a click on the picture opens the video
                    ...(cover
                        ? {
                              cover: {
                                  type: 'staticImage',
                                  src: String(cover),
                                  href: url ? String(url) : undefined,
                                  xs: 12,
                                  sm: 8,
                                  md: 6,
                              },
                          }
                        : {}),
                },
            },
        };
    }

    private async discover(context: ActionContext): Promise<InstanceRefreshResponse> {
        try {
            const found = await this.service.discover();
            const count = String(found.length);
            await context.showMessage({ en: T.found.en.replace('%s', count), de: T.found.de.replace('%s', count) });
            return { refresh: true };
        } catch (error) {
            await context.showMessage(withError(T.failed, error));
            return { refresh: false };
        }
    }

    private async pairCode(context: ActionContext): Promise<InstanceRefreshResponse> {
        const data = await context.showForm(
            {
                type: 'panel',
                items: {
                    _help: {
                        type: 'staticText', // the admin shows translated objects here too, dm-utils types it as a string
                        text: T.pairCodeDescription as unknown as string,
                        xs: 12,
                    },
                    code: {
                        type: 'text',
                        label: T.code,
                        validator: '!!data.code',
                        validatorNoSaveOnError: true,
                        xs: 12,
                    },
                    name: { type: 'text', label: T.name, default: 'TV', xs: 12 },
                },
            },
            { title: T.pairCode, buttons: ['cancel', 'apply'] },
        );
        if (!data) {
            return { refresh: false };
        }
        try {
            await this.service.pairWithCode(String(data.code), String(data.name || 'TV'));
            await context.showMessage(T.added);
            return { refresh: true };
        } catch (error) {
            await context.showMessage(withError(T.failed, error));
            return { refresh: false };
        }
    }

    private async addFound(id: string, context: ActionContext): Promise<DeviceRefreshResponse<string>> {
        const found = this.service.found().find(entry => `found:${entry.udn || entry.ip}` === id);
        if (!found) {
            return { refresh: 'devices' };
        }
        const name = found.name || found.ip;
        try {
            await this.service.addFound(found, name);
            await context.showMessage(T.added);
            return { refresh: 'devices' };
        } catch (error) {
            // Fire TV and others: the TV code always works, so ask for it right here
            const data = await context.showForm(
                {
                    type: 'panel',
                    items: {
                        _error: { type: 'staticText', text: withError(T.failed, error) as unknown as string, xs: 12 },
                        _help: { type: 'staticText', text: T.addFailedCode as unknown as string, xs: 12 },
                        code: {
                            type: 'text',
                            label: T.code,
                            validator: '!!data.code',
                            validatorNoSaveOnError: true,
                            xs: 12,
                        },
                    },
                },
                { title: T.pairCode, buttons: ['cancel', 'apply'] },
            );
            if (data?.code) {
                try {
                    await this.service.pairWithCode(String(data.code), name, found.udn);
                    await context.showMessage(T.added);
                } catch (codeError) {
                    await context.showMessage(withError(T.failed, codeError));
                }
            }
        }
        return { refresh: 'devices' };
    }

    private async play(id: string, context: ActionContext): Promise<DeviceRefreshResponse<string>> {
        const data = await context.showForm(
            { type: 'panel', items: { target: { type: 'text', label: T.playTarget, xs: 12 } } },
            { title: T.play, buttons: ['cancel', 'apply'] },
        );
        if (data?.target) {
            try {
                await this.service.play(id, String(data.target));
            } catch (error) {
                await context.showMessage(withError(T.failed, error));
            }
        }
        return { refresh: 'none' };
    }

    /** Ask for words, show what YouTube finds, play the chosen one */
    private async searchAndPlay(id: string, context: ActionContext): Promise<DeviceRefreshResponse<string>> {
        const words = await context.showForm(
            { type: 'panel', items: { query: { type: 'text', label: T.searchWords, xs: 12 } } },
            { title: T.searchPlay, buttons: ['cancel', 'apply'] },
        );
        const query = String(words?.query ?? '').trim();
        if (!query) {
            return { refresh: 'none' };
        }
        let results: SearchResult[];
        try {
            results = await this.service.search(query);
        } catch (error) {
            await context.showMessage(withError(T.failed, error));
            return { refresh: 'none' };
        }
        if (!results.length) {
            await context.showMessage(T.nothingFound);
            return { refresh: 'none' };
        }
        const choice = await context.showForm(
            {
                type: 'panel',
                items: {
                    target: {
                        type: 'select',
                        label: T.result,
                        options: results.map(result => ({ label: labelOf(result), value: result.id })),
                        noTranslation: true,
                        xs: 12,
                    },
                },
            },
            { title: T.searchPlay, buttons: ['cancel', 'apply'], data: { target: results[0]!.id }, maxWidth: 'md' },
        );
        if (choice?.target) {
            try {
                await this.service.play(id, String(choice.target));
            } catch (error) {
                await context.showMessage(withError(T.failed, error));
            }
        }
        return { refresh: 'none' };
    }

    private async rename(id: string, context: ActionContext): Promise<DeviceRefreshResponse<string>> {
        const device = this.service.devices().find(entry => entry.id === id);
        const data = await context.showForm(
            { type: 'panel', items: { name: { type: 'text', label: T.name, default: device?.name ?? '', xs: 12 } } },
            { title: T.rename, buttons: ['cancel', 'apply'] },
        );
        if (data?.name) {
            await this.service.rename(id, String(data.name));
        }
        return { refresh: 'devices' };
    }

    private async remove(id: string): Promise<DeviceRefreshResponse<string>> {
        await this.service.remove(id);
        return { refresh: 'devices' };
    }
}
