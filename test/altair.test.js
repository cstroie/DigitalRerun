'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ALTAIR_SIZE, altairFiles } = require('../js/altair.js');

const S = 137, SPT = 32;
/** An image with the data of `files` laid out as the AltairZ80 CP/M does: 2K blocks from track 6, skew 17, 3 header bytes (the directory is the caller's). */
function image(files) {
    const img = new Uint8Array(ALTAIR_SIZE).fill(0xE5);
    const put = (rec, bytes) => {
        const t = Math.floor(rec / SPT), s = (rec % SPT) * 17 % SPT;
        img.set(bytes, (t * SPT + s) * S + 3);
    };
    let block = 4;
    for (const { data } of files) {
        for (let at = 0; at < data.length; at += 2048, block++) {
            for (let r = 0; r < 16; r++) {
                const from = at + r * 128;
                if (from < data.length) put(6 * SPT + block * 16 + r, Uint8Array.from({ length: 128 }, (_, i) => data[from + i] ?? 0x1A));
            }
        }
    }
    return img;
}

test('rejects an image of another size', () => {
    assert.throws(() => altairFiles(new Uint8Array(1000)), /not an Altair/);
});

test('reads files across extents and user areas, skewed sectors and all', () => {
    const big = Uint8Array.from({ length: 20000 }, (_, i) => (i * 7) & 255);   // 157 records: two extents
    const small = Uint8Array.from({ length: 300 }, (_, i) => 65 + (i % 26));
    const files = [{ name: 'BIG', ext: 'DAT', data: big }, { name: 'SMALL', ext: 'TXT', data: small, user: 2 }];
    // lay the directory out whole: 4 entries to a record
    const img = image(files);
    const dir = new Uint8Array(64 * 128).fill(0xE5);
    let n = 0, block = 4;
    for (const { name, ext, data, user = 0 } of files) {
        const records = Math.ceil(data.length / 128);
        for (let x = 0; x * 128 < records; x++, n++) {
            const e = dir.subarray(n * 32, n * 32 + 32);
            e.fill(0); e[0] = user; e.set(Buffer.from(name.padEnd(8) + ext.padEnd(3)), 1);
            e[12] = x; e[15] = Math.min(128, records - x * 128);
            for (let b = 0; b < Math.ceil(e[15] / 16); b++, block++) { e[16 + 2 * b] = block & 255; e[17 + 2 * b] = block >> 8; }
        }
    }
    for (let r = 0; r < 64; r++) {
        const t = 6, s = (r % SPT) * 17 % SPT;
        img.set(dir.subarray(r * 128, r * 128 + 128), ((t + Math.floor(r / SPT)) * SPT + s) * S + 3);
    }
    const got = altairFiles(img);
    assert.deepEqual(got.map(f => [f.user, f.name, f.data.length]), [[0, 'BIG.DAT', 157 * 128], [2, 'SMALL.TXT', 384]]);
    assert.deepEqual([...got[0].data.subarray(0, 20000)], [...big]);
    assert.deepEqual([...got[1].data.subarray(0, 300)], [...small]);
});

test('skips erased entries', () => {
    assert.deepEqual(altairFiles(new Uint8Array(ALTAIR_SIZE).fill(0xE5)), []);
});
