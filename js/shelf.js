/*
 * shelf.js: the disk collection. A shelf entry is a prebuilt image
 * ({ image }) or a list of files ({ files: [{ name, path }] }) put on a
 * fresh disk when it is inserted, so the repository holds no mostly empty
 * images. disks/shelf.json lists the shipped entries (tools/build.js
 * writes it); the owner's own disks live in the browser (Storage).
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const { Disk } = node ? require('./devices/fdc.js') : root.DigitalRerun;
    const { CpmFs, isTextFile, toCpmText } = node ? require('./cpmfs.js') : root.DigitalRerun;

    /** Is this file text on the disk (CP/M line ends and ^Z)? By name and content, or listed. */
    function isText(entry, name, bytes) {
        return (entry.text || []).includes(name) || isTextFile(name, bytes);
    }

    /**
     * Make the disk of a shelf entry. `fetchBytes(path)` returns a
     * Uint8Array (fetch in the page, readFileSync in Node).
     */
    async function buildDisk(entry, fetchBytes) {
        if (entry.image) {
            const disk = Disk.fromImage(await fetchBytes(entry.image), { name: entry.name });
            return disk;
        }
        const disk = new Disk(entry.format, null, { name: entry.name });
        const fsys = new CpmFs(disk);
        const data = await Promise.all(entry.files.map(f => fetchBytes(f.path)));
        entry.files.forEach((f, i) => fsys.write(f.name, isText(entry, f.name, data[i]) ? toCpmText(data[i]) : data[i]));
        disk.dirty = false;
        return disk;
    }

    const api = { buildDisk, isText };
    if (node) module.exports = api;
    else (root.DigitalRerun = root.DigitalRerun || {}).Shelf = api;
})(typeof window !== 'undefined' ? window : globalThis);
