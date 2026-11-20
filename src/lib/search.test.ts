/* eslint-disable @typescript-eslint/require-await -- the fake fetch mirrors the async API */
import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import {
    type SearchResult,
    channelAddressOf,
    closestChannel,
    parseSearchAnswer,
    resolveTarget,
    searchYouTube,
    secondsOf,
    withFirstVideo,
} from './search';

const CHANNEL_ID = 'UCbmF2AHnpQsogOLW-MxBiJg';
const browse = (browseId: string): object => ({ browseEndpoint: { browseId } });

/** The shape of a real answer of youtubei/v1/search, cut down to the fields the parser reads */
const ANSWER = {
    contents: {
        twoColumnSearchResultsRenderer: {
            primaryContents: {
                sectionListRenderer: {
                    contents: [
                        {
                            itemSectionRenderer: {
                                contents: [
                                    {
                                        officialCardViewModel: {
                                            header: {
                                                pageHeaderViewModel: {
                                                    title: {
                                                        dynamicTextViewModel: {
                                                            text: { content: 'Sailing Oceanaire | Wik & Rox' },
                                                            rendererContext: {
                                                                commandContext: {
                                                                    onTap: { innertubeCommand: browse(CHANNEL_ID) },
                                                                },
                                                            },
                                                        },
                                                    },
                                                    image: {
                                                        contentPreviewImageViewModel: {
                                                            image: { sources: [{ url: '//yt3.ggpht.com/a=s176' }] },
                                                        },
                                                    },
                                                    metadata: {
                                                        contentMetadataViewModel: {
                                                            metadataRows: [
                                                                {
                                                                    metadataParts: [
                                                                        { text: { content: '@SailingOceanaire' } },
                                                                    ],
                                                                },
                                                                {
                                                                    metadataParts: [
                                                                        { text: { content: '13.600 Abonnenten' } },
                                                                        { text: { content: '50 Videos' } },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    {
                                        videoRenderer: {
                                            videoId: '0L27s5EjM2c',
                                            title: {
                                                runs: [{ text: "30 Knots Forced Us Into Greece's Clearest Bay" }],
                                            },
                                            ownerText: {
                                                runs: [
                                                    {
                                                        text: 'Sailing Oceanaire | Wik & Rox',
                                                        navigationEndpoint: browse(CHANNEL_ID),
                                                    },
                                                ],
                                            },
                                            lengthText: { simpleText: '17:14' },
                                            viewCountText: { simpleText: '91.671 Aufrufe' },
                                            publishedTimeText: { simpleText: 'vor 1 Monat' },
                                            badges: [
                                                {
                                                    metadataBadgeRenderer: {
                                                        style: 'BADGE_STYLE_TYPE_SIMPLE',
                                                        label: '4K',
                                                    },
                                                },
                                            ],
                                        },
                                    },
                                    // Shorts: left out
                                    { gridShelfViewModel: { contents: [{ shortsLockupViewModel: {} }] } },
                                    {
                                        videoRenderer: {
                                            videoId: 'rFZHOHl-L8A',
                                            title: { runs: [{ text: 'lofi hip hop radio' }] },
                                            ownerText: { runs: [{ text: 'Lofi Girl' }] },
                                            viewCountText: { runs: [{ text: '12.918' }, { text: ' Zuschauer' }] },
                                            badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_LIVE_NOW' } }],
                                        },
                                    },
                                    // the same video again: left out
                                    { videoRenderer: { videoId: '0L27s5EjM2c', title: { simpleText: 'again' } } },
                                    {
                                        lockupViewModel: {
                                            contentId: 'PLmz0BVHJJeEp0bP9RFk6RRd7fjvsJjP7w',
                                            contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                                            contentImage: {
                                                collectionThumbnailViewModel: {
                                                    primaryThumbnail: {
                                                        thumbnailViewModel: {
                                                            image: {
                                                                sources: [
                                                                    { url: 'https://i.ytimg.com/vi/x/hq720.jpg' },
                                                                ],
                                                            },
                                                            overlays: [
                                                                {
                                                                    thumbnailOverlayBadgeViewModel: {
                                                                        thumbnailBadges: [
                                                                            {
                                                                                thumbnailBadgeViewModel: {
                                                                                    text: '18 Videos',
                                                                                },
                                                                            },
                                                                        ],
                                                                    },
                                                                },
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                            metadata: {
                                                lockupMetadataViewModel: {
                                                    title: { content: 'Sailing Music 2026' },
                                                    metadata: {
                                                        contentMetadataViewModel: {
                                                            metadataRows: [
                                                                {
                                                                    metadataParts: [
                                                                        {
                                                                            text: {
                                                                                content: 'Chillwave Vibes',
                                                                                commandRuns: [
                                                                                    {
                                                                                        onTap: {
                                                                                            innertubeCommand:
                                                                                                browse(
                                                                                                    'UCbQwrzA0CxEMXEviCT2REow',
                                                                                                ),
                                                                                        },
                                                                                    },
                                                                                ],
                                                                            },
                                                                        },
                                                                    ],
                                                                },
                                                            ],
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    {
                                        channelRenderer: {
                                            channelId: 'UCHUCBur3YxKDvWYDFKMPftA',
                                            title: { simpleText: 'Ocean Air Media' },
                                            subscriberCountText: { simpleText: '@oceanairmedia' },
                                            videoCountText: { simpleText: '1.200 Abonnenten' },
                                            thumbnail: { thumbnails: [{ url: '//yt3.ggpht.com/b' }] },
                                        },
                                    },
                                    // a mix and a playlist the state `youtube` does not take: left out
                                    {
                                        lockupViewModel: {
                                            contentId: 'RDATfmbG9maSBoaXAgaG9w',
                                            contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                                        },
                                    },
                                    {
                                        lockupViewModel: {
                                            contentId: 'VLnotaplaylist',
                                            contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                                        },
                                    },
                                    { adSlotRenderer: {} },
                                ],
                            },
                        },
                    ],
                },
            },
        },
    },
};

describe('search', () => {
    it('reads times as seconds', () => {
        assert.equal(secondsOf('17:14'), 1034);
        assert.equal(secondsOf('1:02:03'), 3723);
        assert.equal(secondsOf('LIVE'), 0);
        assert.equal(secondsOf(''), 0);
    });

    it('reads channels, videos and playlists in the order of YouTube', () => {
        assert.deepEqual(parseSearchAnswer(ANSWER), [
            {
                type: 'channel',
                id: CHANNEL_ID,
                title: 'Sailing Oceanaire | Wik & Rox',
                channel: 'Sailing Oceanaire | Wik & Rox',
                channelId: CHANNEL_ID,
                handle: '@SailingOceanaire',
                subscribers: '13.600 Abonnenten',
                videos: '50 Videos',
                thumbnail: 'https://yt3.ggpht.com/a=s176',
            },
            {
                type: 'video',
                id: '0L27s5EjM2c',
                title: "30 Knots Forced Us Into Greece's Clearest Bay",
                channel: 'Sailing Oceanaire | Wik & Rox',
                channelId: CHANNEL_ID,
                duration: 1034,
                views: '91.671 Aufrufe',
                published: 'vor 1 Monat',
                thumbnail: 'https://i.ytimg.com/vi/0L27s5EjM2c/hqdefault.jpg',
            },
            {
                type: 'video',
                id: 'rFZHOHl-L8A',
                title: 'lofi hip hop radio',
                channel: 'Lofi Girl',
                duration: 0,
                live: true,
                views: '12.918 Zuschauer',
                thumbnail: 'https://i.ytimg.com/vi/rFZHOHl-L8A/hqdefault.jpg',
            },
            {
                type: 'playlist',
                id: 'PLmz0BVHJJeEp0bP9RFk6RRd7fjvsJjP7w',
                title: 'Sailing Music 2026',
                channel: 'Chillwave Vibes',
                channelId: 'UCbQwrzA0CxEMXEviCT2REow',
                videos: '18 Videos',
                thumbnail: 'https://i.ytimg.com/vi/x/hq720.jpg',
            },
            {
                type: 'channel',
                id: 'UCHUCBur3YxKDvWYDFKMPftA',
                title: 'Ocean Air Media',
                channel: 'Ocean Air Media',
                channelId: 'UCHUCBur3YxKDvWYDFKMPftA',
                handle: '@oceanairmedia',
                subscribers: '1.200 Abonnenten',
                thumbnail: 'https://yt3.ggpht.com/b',
            },
        ]);
    });

    it('keeps only the type asked for', () => {
        assert.deepEqual(
            parseSearchAnswer(ANSWER, 'video').map(r => r.id),
            ['0L27s5EjM2c', 'rFZHOHl-L8A'],
        );
        assert.deepEqual(
            parseSearchAnswer(ANSWER, 'channel').map(r => r.id),
            [CHANNEL_ID, 'UCHUCBur3YxKDvWYDFKMPftA'],
        );
    });

    it('leaves out a topic card, which has no handle', () => {
        const topic = structuredClone(ANSWER);
        const card =
            topic.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0]!
                .itemSectionRenderer.contents[0]!.officialCardViewModel!;
        card.header.pageHeaderViewModel.metadata.contentMetadataViewModel.metadataRows.shift();
        assert.equal(parseSearchAnswer(topic)[0]!.id, '0L27s5EjM2c');
    });

    it('survives answers of another shape', () => {
        assert.deepEqual(parseSearchAnswer(null), []);
        assert.deepEqual(parseSearchAnswer({ contents: { somethingNew: {} } }), []);
    });

    it('asks YouTube with the filter, the language and the limit', async () => {
        let body: { query?: string; params?: string; context?: { client?: { hl?: string } } } = {};
        const fakeFetch = (async (url: string, init: RequestInit) => {
            assert.match(String(url), /youtubei\/v1\/search/);
            body = JSON.parse(init.body as string);
            return new Response(JSON.stringify(ANSWER));
        }) as unknown as typeof fetch;
        const results = await searchYouTube(
            '  Sailing Oceanair ',
            { type: 'video', limit: 1, language: 'zh-cn' },
            fakeFetch,
        );
        assert.deepEqual(
            results.map(r => r.id),
            ['0L27s5EjM2c'],
        );
        assert.equal(body.query, 'Sailing Oceanair');
        assert.equal(body.params, 'EgIQAQ==');
        assert.equal(body.context?.client?.hl, 'zh-CN');

        await searchYouTube('x', { type: 'all' }, fakeFetch);
        assert.equal(body.params, undefined);
        assert.equal(body.context?.client?.hl, 'en');
    });

    it('fails on an empty query and when YouTube does not answer', async () => {
        const failing = (async () => new Response('busy', { status: 429 })) as unknown as typeof fetch;
        await assert.rejects(searchYouTube(' ', {}, failing), /nothing to search/);
        await assert.rejects(searchYouTube('x', {}, failing), /429/);
    });

    it('finds channel addresses: handles, /@, /c/ and /user/', () => {
        assert.deepEqual(channelAddressOf('@SailingOceanaire'), {
            url: 'https://www.youtube.com/@SailingOceanaire',
            name: '@SailingOceanaire',
        });
        assert.deepEqual(channelAddressOf('https://www.youtube.com/@SailingOceanAir'), {
            url: 'https://www.youtube.com/@SailingOceanAir',
            name: '@SailingOceanAir',
        });
        assert.deepEqual(channelAddressOf('youtube.com/@SailingOceanaire/videos'), {
            url: 'https://www.youtube.com/@SailingOceanaire',
            name: '@SailingOceanaire',
        });
        assert.equal(channelAddressOf('https://m.youtube.com/c/LofiGirl')?.name, 'LofiGirl');
        assert.equal(channelAddressOf('https://www.youtube.com/user/Name')?.url, 'https://www.youtube.com/user/Name');
        assert.equal(channelAddressOf('Sailing Ocean Air'), null);
        assert.equal(channelAddressOf('https://example.com/@x'), null);
        assert.equal(channelAddressOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
    });

    describe('what a text plays', () => {
        /** A fake YouTube: resolve_url knows only `@SailingOceanaire`, every search answers ANSWER */
        function fakeYouTube(): { fetch: typeof fetch; calls: string[] } {
            const calls: string[] = [];
            const fakeFetch = (async (url: string, init: RequestInit) => {
                const body = JSON.parse(init.body as string) as { url?: string; query?: string; params?: string };
                if (String(url).includes('resolve_url')) {
                    calls.push(`resolve ${body.url}`);
                    return /@sailingoceanaire$/i.test(body.url ?? '')
                        ? new Response(JSON.stringify({ endpoint: { browseEndpoint: { browseId: CHANNEL_ID } } }))
                        : new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
                }
                calls.push(`search ${body.query} ${body.params ?? ''}`.trim());
                return new Response(JSON.stringify(ANSWER));
            }) as unknown as typeof fetch;
            return { fetch: fakeFetch, calls };
        }

        it('takes IDs, URLs and commands as they are, without asking YouTube', async () => {
            const yt = fakeYouTube();
            for (const text of ['dQw4w9WgXcQ', CHANNEL_ID, 'https://youtu.be/dQw4w9WgXcQ', 'pause']) {
                assert.deepEqual(await resolveTarget(` ${text} `, {}, yt.fetch), { target: text, how: 'target' });
            }
            assert.deepEqual(yt.calls, []);
        });

        it('plays the channel of a handle', async () => {
            const yt = fakeYouTube();
            assert.deepEqual(await resolveTarget('https://www.youtube.com/@SailingOceanaire', {}, yt.fetch), {
                target: CHANNEL_ID,
                how: 'channel',
                channel: '@SailingOceanaire',
            });
            assert.deepEqual(yt.calls, ['resolve https://www.youtube.com/@SailingOceanaire']);
        });

        it('takes the channel most like a misspelt handle, not the first one YouTube lists', () => {
            const channel = (title: string, handle: string): SearchResult => ({
                type: 'channel',
                id: `UC${handle.replace(/\W/g, '').padEnd(22, 'x').slice(0, 22)}`,
                title,
                channel: title,
                handle,
            });
            const kite = channel('Kiteboarding Cruise', '@Kiteboarding-cruise');
            const sailing = channel('Sailing Oceanaire | Wik & Rox', '@SailingOceanaire');
            assert.equal(closestChannel([kite, sailing], '@SailingOceanAir'), sailing);
            assert.equal(closestChannel([kite, sailing], '@SailingOcenaire'), sailing, 'a letter missing');
            // nothing alike: YouTube's own first guess
            assert.equal(closestChannel([kite, sailing], '@Zzzzzzzz'), kite);
            assert.equal(closestChannel([], '@x'), undefined);
        });

        it('searches a handle YouTube does not know among the channels', async () => {
            const yt = fakeYouTube();
            const found = await resolveTarget('https://www.youtube.com/@SailingOceanAir', {}, yt.fetch);
            assert.equal(found.target, CHANNEL_ID);
            assert.equal(found.how, 'channel');
            assert.deepEqual(yt.calls, [
                'resolve https://www.youtube.com/@SailingOceanAir',
                'search SailingOceanAir EgIQAg==',
            ]);
        });

        it('plays the first hit for other words: here the channel YouTube puts on top', async () => {
            const yt = fakeYouTube();
            assert.deepEqual(await resolveTarget('Sailing Ocean Air', { language: 'de' }, yt.fetch), {
                target: CHANNEL_ID,
                how: 'channel',
                title: 'Sailing Oceanaire | Wik & Rox',
                channel: '@SailingOceanaire',
            });
            assert.deepEqual(yt.calls, ['search Sailing Ocean Air']);
        });

        it('fails if YouTube finds nothing', async () => {
            const empty = (async () => new Response(JSON.stringify({}))) as unknown as typeof fetch;
            await assert.rejects(resolveTarget('qwertzuiop asdf', {}, empty), /nothing for "qwertzuiop asdf"/);
            const notFound = (async (url: string) =>
                String(url).includes('resolve_url')
                    ? new Response('{}', { status: 404 })
                    : new Response(JSON.stringify({}))) as unknown as typeof fetch;
            await assert.rejects(resolveTarget('@nobody123', {}, notFound), /no channel @nobody123/);
        });
    });

    describe('channels and playlists start at their first video', () => {
        /** The RSS feed: the newest upload of the channel, the first video of the playlist; no feed for a mix */
        function fakeFeed(): { fetch: typeof fetch; calls: string[] } {
            const calls: string[] = [];
            const fakeFetch = (async (url: string) => {
                calls.push(String(url).replace('https://www.youtube.com/feeds/videos.xml?', ''));
                const video = String(url).includes(`channel_id=${CHANNEL_ID}`)
                    ? '-CHaS8UOHFc'
                    : String(url).includes('playlist_id=PLmz0BVHJJeEp0bP9RFk6RRd7fjvsJjP7w')
                      ? 'wZIjeCJfK6c'
                      : null;
                return video
                    ? new Response(`<feed><title>x</title><entry><yt:videoId>${video}</yt:videoId></entry></feed>`)
                    : new Response('Not Found', { status: 404 });
            }) as unknown as typeof fetch;
            return { fetch: fakeFetch, calls };
        }

        it('plays the uploads of a channel from the newest video', async () => {
            const feed = fakeFeed();
            assert.equal(
                await withFirstVideo(CHANNEL_ID, feed.fetch),
                'https://www.youtube.com/watch?v=-CHaS8UOHFc&list=UUbmF2AHnpQsogOLW-MxBiJg',
            );
            assert.deepEqual(feed.calls, [`channel_id=${CHANNEL_ID}`]);
        });

        it('plays a playlist from its first video', async () => {
            const feed = fakeFeed();
            assert.equal(
                await withFirstVideo('PLmz0BVHJJeEp0bP9RFk6RRd7fjvsJjP7w', feed.fetch),
                'https://www.youtube.com/watch?v=wZIjeCJfK6c&list=PLmz0BVHJJeEp0bP9RFk6RRd7fjvsJjP7w',
            );
        });

        it('leaves videos, playlists with a video, commands and lists without a feed as they are', async () => {
            const feed = fakeFeed();
            for (const target of [
                'dQw4w9WgXcQ',
                'https://www.youtube.com/watch?v=abcdefghijk&list=PLmz0BVHJJeEp0bP9RFk6RRd7fjvsJjP7w',
                'pause',
            ]) {
                assert.equal(await withFirstVideo(target, feed.fetch), target);
            }
            assert.deepEqual(feed.calls, [], 'no feed asked for');
            assert.equal(await withFirstVideo('PLnofeedxxxxxxxxxx', feed.fetch), 'PLnofeedxxxxxxxxxx');
            const offline = (async () => {
                throw new Error('offline');
            }) as unknown as typeof fetch;
            assert.equal(await withFirstVideo(CHANNEL_ID, offline), CHANNEL_ID);
        });
    });
});
