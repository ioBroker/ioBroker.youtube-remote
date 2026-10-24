import { type NowPlaying, PlayerState } from '@iobroker/youtube-lounge';

/** `media.state`: 0 pause, 1 play, 2 stop */
export const MEDIA_STATES: Record<number, string> = { 0: 'pause', 1: 'play', 2: 'stop' };

/** The detailed player states of `playerState` */
export const PLAYER_STATES: Record<number, string> = {
    [PlayerState.Unstarted]: 'unstarted',
    [PlayerState.Ended]: 'ended',
    [PlayerState.Playing]: 'playing',
    [PlayerState.Paused]: 'paused',
    [PlayerState.Buffering]: 'buffering',
    [PlayerState.Cued]: 'cued',
    [PlayerState.Advertisement]: 'advertisement',
};

/** `media.state` of what the TV plays: playing, buffering and ads count as play */
export function mediaStateOf(playing: NowPlaying | null): number {
    switch (playing?.state) {
        case PlayerState.Playing:
        case PlayerState.Buffering:
        case PlayerState.Advertisement:
            return 1;
        case PlayerState.Paused:
            return 0;
        default:
            return 2;
    }
}

/** Title, channel and picture of a video, from oEmbed */
export interface VideoInfo {
    title: string;
    artist: string;
    cover: string;
}

/**
 * Read title, channel and picture of a video over oEmbed of YouTube; no API key needed.
 *
 * @param videoId the video
 * @returns the info, `null` if YouTube does not know the video (private, removed) or does not answer
 */
export async function lookUpVideo(videoId: string, fetchFn: typeof fetch = fetch): Promise<VideoInfo | null> {
    try {
        const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
        const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
        if (res.status !== 200) {
            return null;
        }
        const info = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
        return {
            title: info.title ?? '',
            artist: info.author_name ?? '',
            cover: info.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        };
    } catch {
        return null;
    }
}
