import { MAX_RESULTS, type SearchResult, type SearchType } from './search';
import type { StoredDevice } from '../types';

/**
 * The commands of the shared catalog of ioBroker.assistant (HELP.md, family `media`): `search` answers its `items`
 * next to `results`, `getPlayers` lists the devices and `play` plays on one. Pure functions, tested without a TV.
 */

/** An answer that failed: `reason` is a code of the catalog */
export interface CatalogError {
    error: string;
    reason?: string;
    [key: string]: unknown;
}

/** media.search: the message as it comes */
export interface CatalogSearchMessage {
    query?: string;
    title?: string;
    artist?: string;
    album?: string;
    type?: string | string[];
    limit?: number | string;
    offset?: number | string;
}

/** One item of media.search; `uri` is what `play` (and the state `youtube`) takes */
export interface CatalogItem {
    type: 'video' | 'channel' | 'playlist';
    uri: string;
    id: string;
    name: string;
    /** The channel of a video or a playlist */
    artists?: string[];
    durationSec?: number;
    live?: boolean;
    image?: string;
}

/** The types of the catalog and what YouTube searches for them; the others search everything */
const TYPES: Record<string, Exclude<SearchType, 'all'>> = {
    video: 'video',
    track: 'video',
    song: 'video',
    movie: 'video',
    episode: 'video',
    channel: 'channel',
    artist: 'channel',
    playlist: 'playlist',
    album: 'playlist',
};

/**
 * The type of searchYouTube for the `type` of a message: the own types (all, video, channel, playlist) and the ones
 * of the catalog (track and song = video, artist = channel, album = playlist); several that mean the same are that
 * type, different ones or unknown ones search everything (as before).
 *
 * @param type one type, several comma separated or an array
 */
export function searchTypeOf(type: unknown): SearchType {
    const list = (Array.isArray(type) ? (type as unknown[]) : [type])
        .flatMap(t => (typeof t === 'string' ? t.split(/[\s,;]+/) : []))
        .map(t => t.trim().toLowerCase().replace(/s$/, ''))
        .filter(Boolean);
    const types = new Set(list.map(t => TYPES[t] ?? 'all'));
    return types.size === 1 ? [...types][0]! : 'all';
}

function count(value: unknown, min: number, max: number, def: number): number {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && value !== '' && value !== null ? Math.min(max, Math.max(min, n)) : def;
}

/**
 * The words, type, limit and offset for a search message: `query` and the fields of the catalog `title`, `artist`
 * and `album` are searched together. `offset` skips the first results; YouTube gives at most 20 per search, so
 * offset + limit beyond 20 gives fewer.
 *
 * @param message the message, or the words as a string
 */
export function searchRequestOf(message: unknown): { query: string; type: SearchType; limit: number; offset: number } {
    const m = (typeof message === 'string' ? { query: message } : (message ?? {})) as CatalogSearchMessage;
    const words = [m.query, m.title, m.artist, m.album]
        .map(part => (typeof part === 'string' || typeof part === 'number' ? String(part).trim() : ''))
        .filter(Boolean);
    return {
        query: words.join(' '),
        type: searchTypeOf(m.type),
        limit: count(m.limit, 1, MAX_RESULTS, 10),
        offset: count(m.offset, 0, MAX_RESULTS, 0),
    };
}

/**
 * The results of a search as items of the catalog
 *
 * @param results the results of searchYouTube
 */
export function catalogItems(results: SearchResult[]): CatalogItem[] {
    return results.map(r => {
        const item: CatalogItem = { type: r.type, uri: r.id, id: r.id, name: r.title };
        if (r.type !== 'channel' && r.channel) {
            item.artists = [r.channel];
        }
        if (typeof r.duration === 'number' && r.duration > 0) {
            item.durationSec = r.duration;
        }
        if (r.live) {
            item.live = true;
        }
        if (r.thumbnail) {
            item.image = r.thumbnail;
        }
        return item;
    });
}

function fold(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/**
 * The device a message means: its ID or name (case and accents do not count; an exact name wins over a part of
 * it). Without a name: the only device, else the only one whose YouTube app is open.
 *
 * @param devices the paired devices
 * @param wanted ID or name, empty = choose
 * @param isOpen whether the YouTube app of a device is open
 */
export function findPlayer(
    devices: StoredDevice[],
    wanted: unknown,
    isOpen: (id: string) => boolean,
): StoredDevice | CatalogError {
    const names = devices.map(d => d.name);
    const value = typeof wanted === 'string' || typeof wanted === 'number' ? String(wanted).trim() : '';
    if (!devices.length) {
        return { error: 'No device is paired (tab Devices of the settings)', reason: 'DEVICE_NOT_FOUND', devices: [] };
    }
    if (!value) {
        const open = devices.filter(d => isOpen(d.id));
        const only = devices.length === 1 ? devices : open.length === 1 ? open : [];
        if (only.length === 1) {
            return only[0]!;
        }
        return { error: `Which device? ${names.join(', ')}`, reason: 'AMBIGUOUS', candidates: names };
    }
    const byId = devices.find(d => d.id === value);
    if (byId) {
        return byId;
    }
    const name = fold(value);
    const exact = devices.filter(d => fold(d.name) === name);
    const partial = exact.length ? exact : devices.filter(d => name && fold(d.name).includes(name));
    if (partial.length === 1) {
        return partial[0]!;
    }
    if (partial.length > 1) {
        const candidates = partial.map(d => d.name);
        return { error: `"${value}" fits ${candidates.join(', ')}`, reason: 'AMBIGUOUS', candidates };
    }
    return { error: `No device "${value}"; paired: ${names.join(', ')}`, reason: 'DEVICE_NOT_FOUND', devices: names };
}

/**
 * The answer for a failed search or play
 *
 * @param e what was thrown
 */
export function catalogError(e: unknown): CatalogError {
    const error = e instanceof Error ? e.message : String(e);
    let reason: string | undefined;
    if (/nothing to search/.test(error)) {
        reason = 'BAD_REQUEST';
    } else if (/YouTube app is not open/.test(error)) {
        reason = 'NOT_CONNECTED';
    } else if (/found nothing|knows no channel/.test(error)) {
        reason = 'NOT_FOUND';
    } else if (/Unknown device/.test(error)) {
        reason = 'DEVICE_NOT_FOUND';
    } else if ((e as Error)?.name === 'TimeoutError' || /timeout|timed out/i.test(error)) {
        reason = 'TIMEOUT';
    } else if (/YouTube answered/.test(error)) {
        reason = 'NOT_CONNECTED';
    }
    return reason ? { error, reason } : { error };
}
