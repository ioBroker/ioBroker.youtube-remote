/* eslint-disable @typescript-eslint/require-await -- the fake fetch mirrors the async API */
import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { PlayerState } from '@iobroker/youtube-lounge';
import { lookUpVideo, mediaStateOf } from './playerStates';

const playing = (
    state: PlayerState,
): { videoId: string; listId: string; currentTime: number; duration: number; state: PlayerState } => ({
    videoId: 'jNQXAC9IVRw',
    listId: '',
    currentTime: 1,
    duration: 19,
    state,
});

describe('player states', () => {
    it('maps the lounge state to media.state', () => {
        assert.equal(mediaStateOf(playing(PlayerState.Playing)), 1);
        assert.equal(mediaStateOf(playing(PlayerState.Buffering)), 1);
        assert.equal(mediaStateOf(playing(PlayerState.Paused)), 0);
        assert.equal(mediaStateOf(playing(PlayerState.Ended)), 2);
        assert.equal(mediaStateOf(null), 2);
    });

    it('reads title, channel and picture over oEmbed', async () => {
        const fakeFetch = (async (url: string) => {
            assert.match(
                String(url),
                /oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DjNQXAC9IVRw/,
            );
            return new Response(
                JSON.stringify({
                    title: 'Me at the zoo',
                    author_name: 'jawed',
                    thumbnail_url: 'https://i.ytimg.com/x.jpg',
                }),
            );
        }) as unknown as typeof fetch;
        assert.deepEqual(await lookUpVideo('jNQXAC9IVRw', fakeFetch), {
            title: 'Me at the zoo',
            artist: 'jawed',
            cover: 'https://i.ytimg.com/x.jpg',
        });
        const notFound = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
        assert.equal(await lookUpVideo('privatevid1', notFound), null);
    });
});
