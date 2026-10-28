/*
 * cpmfs.js: the CP/M 2.2 file system of a disk image, from outside the
 * machine: list, read, write and erase files, and write the system tracks.
 * Used to build the boot disk and to drop files onto a drive.
 *
 * The layout follows the disk parameter block (DPB) the BIOS gives the
 * BDOS for that format, so what is written here is what CP/M reads.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const { Disk } = node ? require('./devices/fdc.js') : root.DigitalRerun;

    const SECTOR = 128;
    const SKEW6 = [1, 7, 13, 19, 25, 5, 11, 17, 23, 3, 9, 15, 21, 2, 8, 14, 20, 26, 6, 12, 18, 24, 4, 10, 16, 22];

    /** The DPBs of system/bios.asm, one per format. */
    const DPB = {
        'sssd8': { spt: 26, bsh: 3, exm: 0, dsm: 242, drm: 63, dirBlocks: 2, off: 2, skew: SKEW6 },
        'hd4mb': { spt: 128, bsh: 4, exm: 0, dsm: 2039, drm: 1023, dirBlocks: 16, off: 0, skew: null }
    };

    class CpmFsError extends Error {}

    /** 'pip.com' -> { name: 'PIP     ', ext: 'COM' }; refuses what CP/M cannot name. */
    function splitName(fileName) {
        const m = /^([^.]{1,8})(?:\.([^.]{0,3}))?$/.exec(fileName.trim().toUpperCase());
        if (!m || /[\s<>.,;:=?*[\]|()/\\"]/.test(m[1] + (m[2] || ''))) {
            throw new CpmFsError(`'${fileName}' is not a CP/M file name (8.3, no spaces or punctuation)`);
        }
        return { name: m[1].padEnd(8), ext: (m[2] || '').padEnd(3) };
    }

    class CpmFs {
        /** `disk` is a DigitalRerun.Disk (or anything with `format` and `data`). */
        constructor(disk) {
            const dpb = DPB[disk.format];
            if (!dpb) throw new CpmFsError(`no file system known for '${disk.format}'`);
            this.disk = disk;
            this.dpb = dpb;
            this.blockSize = SECTOR << dpb.bsh;
            this.recordsPerBlock = 1 << dpb.bsh;
            this.wide = dpb.dsm > 255;               // 16-bit block numbers
            this.slots = this.wide ? 8 : 16;         // block numbers per entry
            this.entries = dpb.drm + 1;
            // Records one directory entry covers: (exm + 1) logical extents of 128.
            this.entryRecords = (dpb.exm + 1) * 128;
        }

        /** Byte offset in the image of logical record `rec` of the data area. */
        recordOffset(rec) {
            const { spt, off, skew } = this.dpb;
            const track = off + Math.floor(rec / spt);
            const s = rec % spt;
            const sector = skew ? skew[s] : s + 1;
            return (track * spt + sector - 1) * SECTOR;
        }

        readBlockRecord(block, r) {
            const o = this.recordOffset(block * this.recordsPerBlock + r);
            return this.disk.data.subarray(o, o + SECTOR);
        }

        dirEntryOffset(i) {
            const perRecord = SECTOR / 32;
            return this.recordOffset(Math.floor(i / perRecord)) + (i % perRecord) * 32;
        }

        entry(i) {
            const o = this.dirEntryOffset(i);
            return this.disk.data.subarray(o, o + 32);
        }

        blocksOf(e) {
            const out = [];
            for (let k = 0; k < this.slots; k++) {
                const b = this.wide ? e[16 + 2 * k] | (e[17 + 2 * k] << 8) : e[16 + k];
                if (b) out.push(b);
            }
            return out;
        }

        /** Every used directory entry, grouped by file. */
        files() {
            const map = new Map();
            for (let i = 0; i < this.entries; i++) {
                const e = this.entry(i);
                if (e[0] > 15) continue;            // 0E5h free (and 16-31 unused here)
                const name = String.fromCharCode(...e.subarray(1, 9).map(c => c & 0x7F)).trimEnd();
                const ext = String.fromCharCode(...e.subarray(9, 12).map(c => c & 0x7F)).trimEnd();
                const key = `${e[0]}:${name}.${ext}`;
                if (!map.has(key)) {
                    map.set(key, {
                        user: e[0], name: ext ? `${name}.${ext}` : name,
                        readOnly: !!(e[9] & 0x80), system: !!(e[10] & 0x80), extents: []
                    });
                }
                map.get(key).extents.push({ index: i, ex: (e[12] & 0x1F) | (e[14] << 5), rc: e[15], blocks: this.blocksOf(e) });
            }
            for (const f of map.values()) {
                f.extents.sort((a, b) => a.ex - b.ex);
                const last = f.extents[f.extents.length - 1];
                // Records: the full entries before the last, plus the last one's.
                const before = Math.floor(last.ex / (this.dpb.exm + 1)) * this.entryRecords;
                const lastLogical = last.ex % (this.dpb.exm + 1);
                f.records = before + lastLogical * 128 + last.rc;
                f.size = f.records * SECTOR;
            }
            return [...map.values()];
        }

        list() {
            return this.files().map(({ user, name, size, records, readOnly, system }) => ({ user, name, size, records, readOnly, system }));
        }

        find(fileName, user = 0) {
            const { name, ext } = splitName(fileName);
            const want = (name.trimEnd() + (ext.trim() ? '.' + ext.trimEnd() : ''));
            return this.files().find(f => f.user === user && f.name === want) || null;
        }

        read(fileName, user = 0) {
            const f = this.find(fileName, user);
            if (!f) throw new CpmFsError(`${fileName}: no such file`);
            const out = new Uint8Array(f.records * SECTOR);
            let rec = 0;
            for (const ext of f.extents) {
                for (const b of ext.blocks) {
                    for (let r = 0; r < this.recordsPerBlock && rec < f.records; r++, rec++) {
                        out.set(this.readBlockRecord(b, r), rec * SECTOR);
                    }
                }
            }
            return out;
        }

        usedBlocks() {
            const used = new Set();
            for (let b = 0; b < this.dpb.dirBlocks; b++) used.add(b);
            for (const f of this.files()) for (const e of f.extents) for (const b of e.blocks) used.add(b);
            return used;
        }

        freeBytes() {
            return (this.dpb.dsm + 1 - this.usedBlocks().size) * this.blockSize;
        }

        erase(fileName, user = 0) {
            const f = this.find(fileName, user);
            if (!f) return false;
            for (const e of f.extents) this.entry(e.index)[0] = 0xE5;
            this.disk.dirty = true;
            return true;
        }

        /** Write a file, replacing one of the same name. The last record is padded with ^Z. */
        write(fileName, data, user = 0) {
            const { name, ext } = splitName(fileName);
            if (user < 0 || user > 15) throw new CpmFsError('user must be 0 to 15');
            const records = Math.ceil(data.length / SECTOR);
            const blocksNeeded = Math.ceil(records / this.recordsPerBlock);
            const entriesNeeded = Math.max(1, Math.ceil(records / this.entryRecords));

            const old = this.find(fileName, user);
            const oldEntries = old ? old.extents.map(e => e.index) : [];
            const oldBlocks = new Set(old ? old.extents.flatMap(e => e.blocks) : []);
            const used = this.usedBlocks();
            const free = [];
            for (let b = this.dpb.dirBlocks; b <= this.dpb.dsm && free.length < blocksNeeded; b++) {
                if (!used.has(b) || oldBlocks.has(b)) free.push(b);
            }
            if (free.length < blocksNeeded) throw new CpmFsError(`${fileName}: disk full`);
            const slots = [...oldEntries];
            for (let i = 0; i < this.entries && slots.length < entriesNeeded; i++) {
                if (this.entry(i)[0] === 0xE5 && !slots.includes(i)) slots.push(i);
            }
            if (slots.length < entriesNeeded) throw new CpmFsError(`${fileName}: directory full`);
            for (const i of oldEntries) this.entry(i)[0] = 0xE5;

            // Data, record by record.
            const padded = new Uint8Array(records * SECTOR).fill(0x1A);
            padded.set(data);
            for (let rec = 0; rec < records; rec++) {
                const b = free[Math.floor(rec / this.recordsPerBlock)];
                const o = this.recordOffset(b * this.recordsPerBlock + (rec % this.recordsPerBlock));
                this.disk.data.set(padded.subarray(rec * SECTOR, (rec + 1) * SECTOR), o);
            }

            // Directory entries.
            const blocksPerEntry = this.entryRecords / this.recordsPerBlock;
            for (let k = 0; k < entriesNeeded; k++) {
                const e = this.entry(slots[k]);
                e.fill(0);
                e[0] = user;
                for (let c = 0; c < 8; c++) e[1 + c] = name.charCodeAt(c);
                for (let c = 0; c < 3; c++) e[9 + c] = ext.charCodeAt(c);
                const first = k * this.entryRecords;
                const inEntry = Math.min(this.entryRecords, records - first);
                // The last logical extent used in this entry, and its record count.
                const logical = inEntry === 0 ? 0 : Math.floor((inEntry - 1) / 128);
                const ex = k * (this.dpb.exm + 1) + logical;
                e[12] = ex & 0x1F;
                e[14] = ex >> 5;
                e[15] = inEntry === 0 ? 0 : inEntry - logical * 128;
                const blocks = free.slice(k * blocksPerEntry, (k + 1) * blocksPerEntry);
                blocks.forEach((b, j) => {
                    if (this.wide) { e[16 + 2 * j] = b & 0xFF; e[17 + 2 * j] = b >> 8; } else e[16 + j] = b;
                });
            }
            this.disk.dirty = true;
        }

        /** Write `bytes` into the system tracks, from track 0 sector 1, in order. */
        writeSystem(bytes) {
            const room = this.dpb.off * this.dpb.spt * SECTOR;
            if (bytes.length > room) throw new CpmFsError(`the system is ${bytes.length} bytes; the system tracks hold ${room}`);
            this.disk.data.set(bytes, 0);
            this.disk.dirty = true;
        }

        readSystem() {
            return this.disk.data.slice(0, this.dpb.off * this.dpb.spt * SECTOR);
        }

        /** Wipe the directory (files are gone; system tracks kept). */
        format() {
            for (let i = 0; i < this.entries; i++) this.entry(i).fill(0xE5);
            this.disk.dirty = true;
        }
    }

    /** Text from the host (LF line ends) as CP/M text: CR LF, ended by ^Z. */
    function toCpmText(bytes) {
        const out = [];
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b === 0x0A && bytes[i - 1] !== 0x0D) out.push(0x0D);
            out.push(b);
        }
        out.push(0x1A);
        return Uint8Array.from(out);
    }

    /** CP/M text as host text: up to the first ^Z, CR LF as LF. */
    function fromCpmText(bytes) {
        const out = [];
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b === 0x1A) break;
            if (b === 0x0D && bytes[i + 1] === 0x0A) continue;
            out.push(b);
        }
        return Uint8Array.from(out);
    }

    /** Extensions treated as text when files cross between host and disk. */
    const TEXT_TYPES = new Set(['ASM', 'MAC', 'Z80', 'LIB', 'SUB', 'TXT', 'DOC', 'BAS', 'PAS', 'C', 'H', 'FOR', 'PLI', 'PRN', 'LST', 'HEX', 'ME', 'INF', 'MSG', 'LIC']);

    function isTextName(fileName) {
        const m = /\.([^.]+)$/.exec(fileName);
        return !!m && TEXT_TYPES.has(m[1].toUpperCase());
    }

    /** A new, empty disk of `format` with a file system on it. */
    function blankDisk(format = 'sssd8', options) {
        return new Disk(format, null, options);
    }

    const api = { CpmFs, CpmFsError, DPB, splitName, blankDisk, toCpmText, fromCpmText, isTextName };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
