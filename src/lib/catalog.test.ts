import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { type CatalogError, catalogError, catalogItems, findPlayer, searchRequestOf, searchTypeOf } from './catalog';
import type { StoredDevice } from '../types';

const device = (id: string, name: string): StoredDevice => ({ id, name, screenId: 's', loungeToken: 't' });
const DEVICES = [device('tv_11111111', 'Living room TV'), device('tv_22222222', 'Küche'), device('tv_3', 'Bedroom TV')];

describe('catalog: media.search', () => {
    it('searches query, title, artist and album together', () => {
        assert.deepEqual(searchRequestOf('Sailing Oceanaire'), {
            query: 'Sailing Oceanaire',
            type: 'all',
            limit: 10,
            offset: 0,
        });
        assert.deepEqual(searchRequestOf({ title: 'Bohemian Rhapsody', artist: 'Queen', type: 'track', limit: 3 }), {
            query: 'Bohemian Rhapsody Queen',
            type: 'video',
            limit: 3,
            offset: 0,
        });
        assert.equal(
            searchRequestOf({ query: ' live ', album: 'A Night at the Opera' }).query,
            'live A Night at the Opera',
        );
        assert.equal(searchRequestOf({}).query, '');
        assert.equal(searchRequestOf(null).query, '');
    });

    it('maps the types of the catalog', () => {
        assert.equal(searchTypeOf(undefined), 'all');
        assert.equal(searchTypeOf('all'), 'all');
        assert.equal(searchTypeOf('video'), 'video');
        assert.equal(searchTypeOf('tracks'), 'video');
        assert.equal(searchTypeOf('song'), 'video');
        assert.equal(searchTypeOf('artist'), 'channel');
        assert.equal(searchTypeOf('channel'), 'channel');
        assert.equal(searchTypeOf('album'), 'playlist');
        assert.equal(searchTypeOf(['playlist', 'album']), 'playlist');
        // different ones or unknown ones: everything, as before
        assert.equal(searchTypeOf('video,channel'), 'all');
        assert.equal(searchTypeOf('podcast'), 'all');
    });

    it('limits limit and offset', () => {
        assert.equal(searchRequestOf({ query: 'x', limit: 50 }).limit, 20);
        assert.equal(searchRequestOf({ query: 'x', limit: '0' }).limit, 1);
        assert.equal(searchRequestOf({ query: 'x', limit: '' }).limit, 10);
        assert.equal(searchRequestOf({ query: 'x', offset: '5' }).offset, 5);
        assert.equal(searchRequestOf({ query: 'x', offset: -3 }).offset, 0);
    });

    it('answers the results as items of the catalog', () => {
        assert.deepEqual(
            catalogItems([
                {
                    type: 'video',
                    id: '0L27s5EjM2c',
                    title: '30 Knots',
                    channel: 'Sailing Oceanaire',
                    duration: 1034,
                    thumbnail: 'img',
                },
                { type: 'video', id: 'live1234567', title: 'Live', channel: 'C', duration: 0, live: true },
                {
                    type: 'channel',
                    id: 'UCbmF2AHnpQsogOLW-MxBiJg',
                    title: 'Sailing Oceanaire',
                    channel: 'Sailing Oceanaire',
                },
                { type: 'playlist', id: 'PLx', title: 'Best of', channel: 'Queen' },
            ]),
            [
                {
                    type: 'video',
                    uri: '0L27s5EjM2c',
                    id: '0L27s5EjM2c',
                    name: '30 Knots',
                    artists: ['Sailing Oceanaire'],
                    durationSec: 1034,
                    image: 'img',
                },
                { type: 'video', uri: 'live1234567', id: 'live1234567', name: 'Live', artists: ['C'], live: true },
                {
                    type: 'channel',
                    uri: 'UCbmF2AHnpQsogOLW-MxBiJg',
                    id: 'UCbmF2AHnpQsogOLW-MxBiJg',
                    name: 'Sailing Oceanaire',
                },
                { type: 'playlist', uri: 'PLx', id: 'PLx', name: 'Best of', artists: ['Queen'] },
            ],
        );
    });
});

describe('catalog: media.play and media.getPlayers', () => {
    const none = (): boolean => false;

    it('finds the device by id or name', () => {
        assert.equal((findPlayer(DEVICES, 'tv_22222222', none) as StoredDevice).name, 'Küche');
        assert.equal((findPlayer(DEVICES, 'kuche', none) as StoredDevice).id, 'tv_22222222');
        assert.equal((findPlayer(DEVICES, 'LIVING ROOM TV', none) as StoredDevice).id, 'tv_11111111');
        assert.equal((findPlayer(DEVICES, 'bedroom', none) as StoredDevice).id, 'tv_3');
    });

    it('says which devices fit or exist', () => {
        assert.deepEqual(findPlayer(DEVICES, 'TV', none), {
            error: '"TV" fits Living room TV, Bedroom TV',
            reason: 'AMBIGUOUS',
            candidates: ['Living room TV', 'Bedroom TV'],
        });
        const missing = findPlayer(DEVICES, 'Garage', none);
        assert.equal((missing as { reason: string }).reason, 'DEVICE_NOT_FOUND');
        assert.deepEqual((missing as CatalogError).devices, ['Living room TV', 'Küche', 'Bedroom TV']);
        assert.equal((findPlayer([], 'x', none) as { reason: string }).reason, 'DEVICE_NOT_FOUND');
    });

    it('chooses the device if none is named', () => {
        assert.equal((findPlayer([DEVICES[1]!], undefined, none) as StoredDevice).id, 'tv_22222222');
        assert.equal((findPlayer(DEVICES, '', id => id === 'tv_3') as StoredDevice).id, 'tv_3');
        assert.equal((findPlayer(DEVICES, undefined, none) as { reason: string }).reason, 'AMBIGUOUS');
        assert.equal((findPlayer(DEVICES, undefined, () => true) as { reason: string }).reason, 'AMBIGUOUS');
    });

    it('names the reason of a failure', () => {
        assert.deepEqual(catalogError(new Error('the YouTube app is not open')), {
            error: 'the YouTube app is not open',
            reason: 'NOT_CONNECTED',
        });
        assert.equal(catalogError(new Error('YouTube found nothing for "xyz"')).reason, 'NOT_FOUND');
        assert.equal(catalogError(new Error('YouTube knows no channel @nobody')).reason, 'NOT_FOUND');
        assert.equal(catalogError(new Error('nothing to search for')).reason, 'BAD_REQUEST');
        assert.equal(catalogError(new Error('YouTube answered the search with 500')).reason, 'NOT_CONNECTED');
        assert.equal(catalogError(new Error('Unknown device tv_9')).reason, 'DEVICE_NOT_FOUND');
        assert.deepEqual(catalogError('something else'), { error: 'something else' });
    });
});
