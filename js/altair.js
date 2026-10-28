/*
 * altair.js: the files of an AltairZ80 (SIMH) CP/M disk image.
 *
 * The image is 254 tracks of 32 sectors of 137 bytes: 3 bytes of the
 * Altair's sector header, the 128 bytes CP/M sees, and 6 of trailer.
 * CP/M reads it with 2K blocks, 16-bit block numbers, a directory on
 * track 6 (6 tracks reserved) and 32 sectors per track skewed by 17.
 * Only the files are taken: the image is no machine this one emulates.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;

    const TRACKS = 254, SPT = 32, SECTOR = 137, RESERVED = 6, BLOCK_RECORDS = 16, DIR_RECORDS = 64;
    const SIZE = TRACKS * SPT * SECTOR;                       // 1113536

    /** The 128 bytes of CP/M record `n`, counted from the first track. */
    function record(image, n) {
        const track = Math.floor(n / SPT), sector = (n % SPT) * 17 % SPT;
        const at = (track * SPT + sector) * SECTOR + 3;
        return image.subarray(at, at + 128);
    }

    /** The files on an Altair image: [{ user, name, data }], data in whole 128-byte records. */
    function altairFiles(image) {
        if (image.length !== SIZE) throw new Error(`not an Altair disk image (${SIZE} bytes)`);
        const base = RESERVED * SPT;
        const dir = new Uint8Array(DIR_RECORDS * 128);
        for (let i = 0; i < DIR_RECORDS; i++) dir.set(record(image, base + i), i * 128);
        const files = new Map();
        for (let at = 0; at < dir.length; at += 32) {
            const e = dir.subarray(at, at + 32);
            if (e[0] > 15) continue;                          // erased (E5) or a label
            const text = a => String.fromCharCode(...a.map(c => c & 0x7F)).trimEnd();
            const name = text(e.subarray(1, 9)), ext = text(e.subarray(9, 12));
            if (!name || /[^\x21-\x7E]/.test(name + ext)) continue;
            const key = `${e[0]}:${name}.${ext}`;
            if (!files.has(key)) files.set(key, { user: e[0], name: ext ? `${name}.${ext}` : name, extents: [] });
            files.get(key).extents.push({ number: e[12] + 32 * e[14], records: e[15], blocks: Array.from({ length: 8 }, (_, i) => e[16 + 2 * i] | e[17 + 2 * i] << 8) });
        }
        return [...files.values()].map(({ user, name, extents }) => {
            const parts = [];
            for (const x of extents.sort((a, b) => a.number - b.number)) {
                const part = new Uint8Array(x.records * 128);
                for (let r = 0; r < x.records; r++) {
                    const block = x.blocks[r >> 4];
                    if (block) part.set(record(image, base + block * BLOCK_RECORDS + (r & 15)), r * 128);
                }
                parts.push(part);
            }
            const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
            parts.reduce((at, p) => (data.set(p, at), at + p.length), 0);
            return { user, name, data };
        });
    }

    const api = { ALTAIR_SIZE: SIZE, altairFiles };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
