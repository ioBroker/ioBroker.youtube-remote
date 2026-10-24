import type { AdapterInstance } from '@iobroker/adapter-core';
import {
    DeviceManagement,
    type ActionContext,
    type DeviceDetails,
    type DeviceInfo,
    type DeviceLoadContext,
    type DeviceRefreshResponse,
    type InstanceDetails,
    type InstanceRefreshResponse,
} from '@iobroker/dm-utils';
import type { DialDevice } from '@iobroker/youtube-lounge';
import type { StoredDevice } from '../types';

/** What the Device Manager needs from the adapter */
export interface YouTubeService {
    devices(): StoredDevice[];
    /** Devices of the last search that are not added yet */
    found(): DialDevice[];
    discover(): Promise<DialDevice[]>;
    addFound(device: DialDevice, name: string): Promise<StoredDevice>;
    pairWithCode(code: string, name: string): Promise<StoredDevice>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    play(id: string, target: string): Promise<void>;
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
        en: 'Video, playlist, channel (UC…) or YouTube URL',
        de: 'Video, Playlist, Kanal (UC…) oder YouTube-URL',
    },
    paired: { en: 'Paired devices', de: 'Gekoppelte Geräte' },
    discovered: { en: 'Found devices', de: 'Gefundene Geräte' },
};

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
            actions: [
                { id: 'play', icon: 'play', description: T.play, handler: (id, ctx) => this.play(id, ctx) },
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
                        timeout: 60000,
                        handler: (id, ctx) => this.addFound(id, ctx),
                    },
                ],
                group: { key: 'found', name: T.discovered, icon: 'search' },
            });
        }
        context.setTotalDevices(devices.length);
        devices.forEach(device => context.addDevice(device));
    }

    override getDeviceDetails(id: string): DeviceDetails<string> | null {
        const device = this.service.devices().find(entry => entry.id === id);
        return device
            ? {
                  id,
                  schema: {
                      type: 'panel',
                      items: { name: { type: 'staticInfo', label: T.name, data: device.name } },
                  },
              }
            : null;
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
        try {
            await this.service.addFound(found, found.name || found.ip);
            await context.showMessage(T.added);
        } catch (error) {
            await context.showMessage(withError(T.failed, error));
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
