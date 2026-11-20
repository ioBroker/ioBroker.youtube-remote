import { parseYouTubeTarget, uploadsPlaylistId } from '@iobroker/youtube-lounge';

/**
 * Search YouTube by keywords over the InnerTube API of the YouTube web page (the one youtube.com/results uses).
 * It needs no API key and has no quota, but Google does not document it, like the Lounge API: if YouTube changes
 * the answer, single fields or whole results may be missing until the parser follows.
 */

/** What to search for; `all` is the mix YouTube shows on its results page */
export type SearchType = 'all' | 'video' | 'channel' | 'playlist';

export const SEARCH_TYPES: SearchType[] = ['all', 'video', 'channel', 'playlist'];

/** One hit; `id` can be written to the state `youtube` as it is */
export interface SearchResult {
    type: 'video' | 'channel' | 'playlist';
    /** Video ID, playlist ID (PL…) or channel ID (UC…) */
    id: string;
    title: string;
    /** Name of the channel; for a channel its own name */
    channel: string;
    channelId?: string;
    /** Channels: the handle, e.g. `@name` */
    handle?: string;
    /** Videos: length in seconds, 0 while live */
    duration?: number;
    /** Videos: a live stream that runs now */
    live?: boolean;
    /** Texts as YouTube shows them, in the language of the search */
    views?: string;
    published?: string;
    /** Channels and playlists: e.g. "50 videos" */
    videos?: string;
    /** Channels: e.g. "13K subscribers" */
    subscribers?: string;
    thumbnail?: string;
}

export interface SearchOptions {
    type?: SearchType;
    /** At most this many results, 1-20; default 10 */
    limit?: number;
    /** Language of the texts (views, published), an ioBroker language like `de` or `zh-cn` */
    language?: string;
}

export const MAX_RESULTS = 20;

const ENDPOINT = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
/** A version of the web client; YouTube answers older ones too */
const CLIENT_VERSION = '2.20250101.00.00';
/** The filter "type" of the results page */
const FILTERS: Record<Exclude<SearchType, 'all'>, string> = {
    video: 'EgIQAQ==',
    channel: 'EgIQAg==',
    playlist: 'EgIQAw==',
};

/** The answer is deeply nested JSON whose shape YouTube changes; read it without trusting the shape */
type Json = any;

/** `simpleText`, `runs` or `content` */
function text(value: Json): string {
    if (!value) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value.simpleText === 'string') {
        return value.simpleText;
    }
    if (Array.isArray(value.runs)) {
        return value.runs.map((run: Json) => String(run?.text ?? '')).join('');
    }
    if (typeof value.content === 'string') {
        return value.content;
    }
    // a single run
    if (typeof value.text === 'string') {
        return value.text;
    }
    return '';
}

/** `1:02:03` -> 3723; 0 if it is no time */
export function secondsOf(time: string): number {
    if (!/^\d+(:\d{1,2})+$/.test(time.trim())) {
        return 0;
    }
    return time
        .trim()
        .split(':')
        .reduce((total, part) => total * 60 + Number(part), 0);
}

/** The largest picture of a `thumbnails` or `sources` list */
function pictureOf(list: Json): string | undefined {
    const url: unknown = Array.isArray(list) && list.length ? list[list.length - 1]?.url : undefined;
    if (typeof url !== 'string' || !url) {
        return undefined;
    }
    return url.startsWith('//') ? `https:${url}` : url;
}

/** Every value of `key` anywhere below `value` */
function collect(value: Json, key: string, found: Json[] = []): Json[] {
    if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
            value.forEach(entry => collect(entry, key, found));
        } else {
            for (const [name, entry] of Object.entries(value)) {
                if (name === key) {
                    found.push(entry);
                }
                collect(entry, key, found);
            }
        }
    }
    return found;
}

/** Leave out empty fields, so an agent reads only what is known */
function compact(result: SearchResult): SearchResult {
    return Object.fromEntries(
        Object.entries(result).filter(([, value]) => value !== undefined && value !== '' && value !== false),
    ) as unknown as SearchResult;
}

function video(r: Json): SearchResult | null {
    if (typeof r?.videoId !== 'string') {
        return null;
    }
    const owner = r.ownerText?.runs?.[0] ?? r.longBylineText?.runs?.[0];
    const live = (r.badges ?? []).some((badge: Json) =>
        String(badge?.metadataBadgeRenderer?.style ?? '').includes('LIVE'),
    );
    return {
        type: 'video',
        id: r.videoId,
        title: text(r.title),
        channel: text(owner),
        channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId,
        duration: secondsOf(text(r.lengthText)),
        live,
        views: text(r.viewCountText),
        published: text(r.publishedTimeText),
        thumbnail: `https://i.ytimg.com/vi/${r.videoId}/hqdefault.jpg`,
    };
}

/** YouTube puts the handle into `subscriberCountText` and the subscribers into `videoCountText`; sort by look */
function channel(r: Json): SearchResult | null {
    if (typeof r?.channelId !== 'string') {
        return null;
    }
    const texts = [text(r.subscriberCountText), text(r.videoCountText)].filter(Boolean);
    const handle = texts.find(entry => entry.startsWith('@'));
    const name = text(r.title);
    return {
        type: 'channel',
        id: r.channelId,
        title: name,
        channel: name,
        channelId: r.channelId,
        handle,
        subscribers: texts.find(entry => entry !== handle),
        thumbnail: pictureOf(r.thumbnail?.thumbnails),
    };
}

/** The channel card on top of the results; a topic card ("… - Topic") has no handle and is no channel to play */
function officialCard(r: Json): SearchResult | null {
    const header = r?.header?.pageHeaderViewModel;
    const id: unknown = collect(header?.title, 'browseEndpoint')[0]?.browseId;
    const rows: string[] = (header?.metadata?.contentMetadataViewModel?.metadataRows ?? []).flatMap((row: Json) =>
        (row?.metadataParts ?? []).map((part: Json) => text(part?.text)),
    );
    const handle = rows.find(entry => entry.startsWith('@'));
    if (typeof id !== 'string' || !id.startsWith('UC') || !handle) {
        return null;
    }
    const name = text(header.title?.dynamicTextViewModel?.text);
    const counts = rows.filter(entry => entry !== handle);
    return {
        type: 'channel',
        id,
        title: name,
        channel: name,
        channelId: id,
        handle,
        subscribers: counts[0],
        videos: counts[1],
        thumbnail: pictureOf(collect(header.image, 'sources')[0]),
    };
}

/** The newer form of playlists (and maybe videos one day) */
function lockup(r: Json): SearchResult | null {
    const id: unknown = r?.contentId;
    const kind = String(r?.contentType ?? '');
    if (typeof id !== 'string' || !/PLAYLIST|VIDEO/.test(kind)) {
        return null;
    }
    const meta = r.metadata?.lockupMetadataViewModel;
    const byline = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text;
    const badges = collect(r.contentImage, 'thumbnailBadgeViewModel').map((badge: Json) => text(badge?.text));
    const isVideo = kind.includes('VIDEO');
    const length = badges.find(badge => secondsOf(badge) > 0);
    return {
        type: isVideo ? 'video' : 'playlist',
        id,
        title: text(meta?.title),
        channel: text(byline),
        channelId: collect(byline, 'browseEndpoint')[0]?.browseId,
        duration: isVideo ? secondsOf(length ?? '') : undefined,
        videos: isVideo ? undefined : badges.find(Boolean),
        thumbnail: isVideo
            ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
            : pictureOf(collect(r.contentImage, 'sources')[0]),
    };
}

/** Old form of playlists */
function playlist(r: Json): SearchResult | null {
    if (typeof r?.playlistId !== 'string') {
        return null;
    }
    const owner = r.shortBylineText?.runs?.[0] ?? r.longBylineText?.runs?.[0];
    return {
        type: 'playlist',
        id: r.playlistId,
        title: text(r.title),
        channel: text(owner),
        channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId,
        videos: text(r.videoCountText) || (r.videoCount ? String(r.videoCount) : undefined),
        thumbnail: pictureOf(r.thumbnails?.[0]?.thumbnails ?? r.thumbnail?.thumbnails),
    };
}

const PARSERS = new Map<string, (r: Json) => SearchResult | null>([
    ['videoRenderer', video],
    ['channelRenderer', channel],
    ['officialCardViewModel', officialCard],
    ['lockupViewModel', lockup],
    ['playlistRenderer', playlist],
]);

/**
 * The results of an answer of `youtubei/v1/search`, in the order YouTube shows them. Shelves (Shorts, "latest from",
 * "people also watched"), ads, mixes and what the state `youtube` does not take are left out.
 */
export function parseSearchAnswer(answer: Json, type: SearchType = 'all'): SearchResult[] {
    const sections = answer?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    const results: SearchResult[] = [];
    for (const section of Array.isArray(sections) ? sections : []) {
        for (const item of section?.itemSectionRenderer?.contents ?? []) {
            for (const [name, renderer] of Object.entries(item ?? {})) {
                const result = PARSERS.get(name)?.(renderer);
                if (!result || (type !== 'all' && result.type !== type) || results.some(r => r.id === result.id)) {
                    continue;
                }
                if (result.id.startsWith('RD')) {
                    // a mix: a radio YouTube makes for each viewer, not a list one can name
                    continue;
                }
                try {
                    // only what the state `youtube` takes
                    parseYouTubeTarget(result.id);
                } catch {
                    continue;
                }
                results.push(compact(result));
            }
        }
    }
    return results;
}

/** ioBroker languages to the `hl` of YouTube */
function hlOf(language: string | undefined): string {
    if (!language) {
        return 'en';
    }
    return language === 'zh-cn' ? 'zh-CN' : language;
}

/**
 * Search YouTube.
 *
 * @param query the keywords, e.g. "Sailing Oceanaire"
 * @param options type, limit and language
 * @param fetchFn for tests
 * @returns the results, best first; empty if nothing was found
 * @throws {Error} if the query is empty or YouTube does not answer
 */
export async function searchYouTube(
    query: string,
    options: SearchOptions = {},
    fetchFn: typeof fetch = fetch,
): Promise<SearchResult[]> {
    const words = String(query ?? '').trim();
    if (!words) {
        throw new Error('nothing to search for');
    }
    const type = options.type && SEARCH_TYPES.includes(options.type) ? options.type : 'all';
    const limit = Math.min(MAX_RESULTS, Math.max(1, Math.round(Number(options.limit) || 10)));
    const res = await fetchFn(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION, hl: hlOf(options.language) } },
            query: words,
            ...(type === 'all' ? {} : { params: FILTERS[type] }),
        }),
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status !== 200) {
        throw new Error(`YouTube answered the search with ${res.status}`);
    }
    return parseSearchAnswer(await res.json(), type).slice(0, limit);
}

const RESOLVE_ENDPOINT = 'https://www.youtube.com/youtubei/v1/navigation/resolve_url?prettyPrint=false';

/**
 * The address of a channel by its handle or name: `@name`, `youtube.com/@name` (also `/videos` and the like),
 * `youtube.com/c/name`, `youtube.com/user/name`.
 *
 * @param input text written to `youtube`
 * @returns the address for `resolve_url` and the handle or name to search for, or null for any other text
 */
export function channelAddressOf(input: string): { url: string; name: string } | null {
    const text = String(input ?? '').trim();
    const handle = /^@([\w.-]{3,100})$/.exec(text)?.[1];
    if (handle) {
        return { url: `https://www.youtube.com/@${handle}`, name: `@${handle}` };
    }
    let url: URL;
    try {
        url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        return null;
    }
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) {
        return null;
    }
    const match = /^\/(@[^/]+|c\/[^/]+|user\/[^/]+)/.exec(url.pathname);
    if (!match) {
        return null;
    }
    const path = decodeURIComponent(match[1]!);
    return { url: `https://www.youtube.com/${path}`, name: path.replace(/^(c|user)\//, '') };
}

/**
 * The channel ID of a channel address over `resolve_url` of the YouTube web page.
 *
 * @param url e.g. https://www.youtube.com/@name
 * @param fetchFn for tests
 * @returns `UC…`, or null if YouTube does not know the address
 * @throws {Error} if YouTube does not answer
 */
export async function resolveChannel(url: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
    const res = await fetchFn(RESOLVE_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: CLIENT_VERSION } }, url }),
        signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 400) {
        return null;
    }
    if (res.status !== 200) {
        throw new Error(`YouTube answered with ${res.status}`);
    }
    const id: unknown = collect(await res.json(), 'browseEndpoint')[0]?.browseId;
    return typeof id === 'string' && /^UC[\w-]{22}$/.test(id) ? id : null;
}

/** What a text written to `youtube` or `search` plays */
export interface ResolvedTarget {
    /** For `parseYouTubeTarget`: the text itself, or the ID of a channel, video or playlist */
    target: string;
    /** target: the text is an ID, URL or command; else the kind of what was found for it */
    how: 'target' | SearchResult['type'];
    title?: string;
    channel?: string;
}

/** Lower case letters and digits only, to compare names and handles */
function letters(text: string): string {
    return text
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

/** Levenshtein distance */
function distance(a: string, b: string): number {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) {
            next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        row = next;
    }
    return row[b.length]!;
}

/**
 * The channel whose handle or name is the most like the wanted one: 0 if one contains the other, else the share of
 * letters to change. YouTube ranks the channels of a search by more than the name and not the same way every time.
 *
 * @param channels results of a channel search, in the order of YouTube (the first wins a tie)
 * @param name handle or name, e.g. "@SailingOceanAir"
 * @returns the closest one; the first one if none is close (YouTube's own guess)
 */
export function closestChannel(channels: SearchResult[], name: string): SearchResult | undefined {
    const wanted = letters(name);
    const score = (channel: SearchResult): number =>
        Math.min(
            ...[channel.handle, channel.title]
                .map(text => letters(text ?? ''))
                .filter(text => text.length >= 4)
                .map(text =>
                    text.includes(wanted) || wanted.includes(text)
                        ? 0
                        : distance(text, wanted) / Math.max(text.length, wanted.length),
                ),
        );
    let best: SearchResult | undefined;
    let bestScore = Infinity;
    for (const channel of channels) {
        const value = score(channel);
        if (value < bestScore) {
            best = channel;
            bestScore = value;
        }
    }
    return bestScore <= 0.4 ? best : channels[0];
}

/**
 * The first hit of the mix YouTube shows on its results page for the words: a channel if they name one (it plays
 * its uploads), else mostly a video, sometimes a playlist.
 *
 * @param query the words
 * @param options language of the search
 * @param fetchFn for tests
 * @throws {Error} if nothing is found or YouTube does not answer
 */
export async function firstHit(
    query: string,
    options: Pick<SearchOptions, 'language'> = {},
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedTarget> {
    const [hit] = await searchYouTube(query, { ...options, type: 'all', limit: 1 }, fetchFn);
    if (!hit) {
        throw new Error(`YouTube found nothing for "${String(query).trim()}"`);
    }
    return { target: hit.id, how: hit.type, title: hit.title, channel: hit.handle ?? hit.channel };
}

/**
 * Understand any text as something to play: what the lounge takes as it is (IDs, URLs, play/pause/…), the uploads
 * of a channel given by its handle or address (a handle YouTube does not know, e.g. misspelt, is searched for among
 * the channels), or else the first hit YouTube finds for the words (`firstHit`).
 *
 * @param input the text
 * @param options language of the search
 * @param fetchFn for tests
 * @throws {Error} if nothing is found or YouTube does not answer
 */
export async function resolveTarget(
    input: string,
    options: Pick<SearchOptions, 'language'> = {},
    fetchFn: typeof fetch = fetch,
): Promise<ResolvedTarget> {
    const text = String(input ?? '').trim();
    try {
        parseYouTubeTarget(text);
        return { target: text, how: 'target' };
    } catch {
        // a handle, an address or words
    }
    const address = channelAddressOf(text);
    if (!address) {
        return firstHit(text, options, fetchFn);
    }
    const id = await resolveChannel(address.url, fetchFn);
    if (id) {
        return { target: id, how: 'channel', channel: address.name };
    }
    // with the @ YouTube sometimes answers only an advertisement, so first without it
    const name = address.name.replace(/^@/, '');
    let channels: SearchResult[] = [];
    for (const query of new Set([name, address.name])) {
        channels = await searchYouTube(query, { ...options, type: 'channel', limit: 10 }, fetchFn);
        if (channels.length) {
            break;
        }
    }
    const hit = closestChannel(channels, address.name);
    if (!hit) {
        throw new Error(`YouTube knows no channel ${address.name}`);
    }
    return { target: hit.id, how: 'channel', title: hit.title, channel: hit.handle ?? hit.title };
}

const FEED = 'https://www.youtube.com/feeds/videos.xml';

/**
 * The first video of a playlist, or the newest upload of a channel, from the RSS feed of YouTube.
 *
 * @param kind channel or playlist
 * @param id `UC…` or the playlist ID
 * @param fetchFn for tests
 * @returns the video ID, or null if YouTube has no feed for it (a mix, a private list) or does not answer
 */
export async function firstVideoOf(
    kind: 'channel' | 'playlist',
    id: string,
    fetchFn: typeof fetch = fetch,
): Promise<string | null> {
    try {
        const param = kind === 'channel' ? 'channel_id' : 'playlist_id';
        const res = await fetchFn(`${FEED}?${param}=${encodeURIComponent(id)}`, {
            signal: AbortSignal.timeout(10_000),
        });
        if (res.status !== 200) {
            return null;
        }
        return /<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(await res.text())?.[1] ?? null;
    } catch {
        return null;
    }
}

/**
 * The YouTube app of the TV ignores a playlist without a video to start with, and so a channel (its uploads): it
 * plays on what it played. Give it the first video: the newest upload of a channel, the first one of a playlist.
 *
 * @param target what `parseYouTubeTarget` takes
 * @param fetchFn for tests
 * @returns a URL with the list and its first video; the target as it is for anything else or if YouTube does not
 *   tell the first video
 */
export async function withFirstVideo(target: string, fetchFn: typeof fetch = fetch): Promise<string> {
    let parsed: ReturnType<typeof parseYouTubeTarget>;
    try {
        parsed = parseYouTubeTarget(target);
    } catch {
        return target;
    }
    let list: string;
    let video: string | null;
    if (parsed.kind === 'channel') {
        list = uploadsPlaylistId(parsed.channelId);
        video = await firstVideoOf('channel', parsed.channelId, fetchFn);
    } else if (parsed.kind === 'playlist' && !parsed.videoId) {
        list = parsed.listId;
        video = await firstVideoOf('playlist', parsed.listId, fetchFn);
    } else {
        return target;
    }
    return video ? `https://www.youtube.com/watch?v=${video}&list=${list}` : target;
}
