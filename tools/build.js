#!/usr/bin/env node
/*
 * build.js: assemble the system and write the boot disk.
 *
 *   node tools/build.js
 *
 * system/boot.asm, system/dri/ccp.asm, system/dri/bdos.asm and
 * system/bios.asm are assembled with js/asm8080.js into
 *   system/boot.bin   the loader (track 0, sector 1)
 *   system/cpm22.bin  the system tracks: loader + CCP + BDOS + BIOS
 *   system/*.lst      listings (not kept in git)
 * system/sysgen.asm and prtdemo.asm become SYSGEN.COM and PRTDEMO.COM on the disk.
 * and disks/cpm22.dsk is made: an 8" disk with those system tracks and
 * every file of disks/cpm22/ (plus the system sources) on it.
 * disks/zork1/ becomes disks/zork1.dsk, the game disk for D:.
 * Only needed after changing a source: the app loads the results.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { assemble, formatListing } = require('../js/asm8080.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText } = require('../js/cpmfs.js');

const ROOT = path.join(__dirname, '..');
const MSIZE = 64;
const CCP = (MSIZE - 7) * 1024;      // 0E400h
const BDOS = CCP + 0x800;            // 0EC00h
const BIOS = CCP + 0x1600;           // 0FA00h
const SYSTEM_BYTES = 2 * 26 * 128;   // two 8" tracks

function build(file, origin, length) {
    const src = fs.readFileSync(path.join(ROOT, 'system', file), 'latin1');
    const r = assemble(src, origin === null ? {} : { defines: { origin } });
    fs.writeFileSync(path.join(ROOT, 'system', file.replace(/\.asm$/, '.lst').replace(/^dri\//, '')), formatListing(r) + '\n');
    const lo = origin === null ? 0 : origin;
    const hi = length ? lo + length - 1 : r.high;
    return { result: r, image: r.image(lo, hi) };
}

function main() {
    const boot = build('boot.asm', null, 128);
    const ccp = build('dri/ccp.asm', CCP, 0x800);
    const bdos = build('dri/bdos.asm', BDOS, 0xE00);
    const bios = build('bios.asm', null);
    const biosEnd = bios.result.symbols.get('BIOSEND');
    const biosLoaded = biosEnd - BIOS;
    const room = SYSTEM_BYTES - 128 - 0x800 - 0xE00;
    if (biosLoaded > room) throw new Error(`the BIOS code is ${biosLoaded} bytes; the system tracks hold ${room}`);
    if (bios.result.high > 0xFFFF) throw new Error('the BIOS runs past 0FFFFh');

    const system = new Uint8Array(SYSTEM_BYTES);
    system.set(boot.image, 0);
    system.set(ccp.image, 128);
    system.set(bdos.image, 128 + 0x800);
    system.set(bios.result.image(BIOS, BIOS + room - 1), 128 + 0x1600);
    const com = file => { const r = build(file, null).result; return r.image(0x100, r.high); };
    const sysgenCom = com('sysgen.asm');
    const prtdemoCom = com('prtdemo.asm');
    fs.writeFileSync(path.join(ROOT, 'system/boot.bin'), boot.image);
    fs.writeFileSync(path.join(ROOT, 'system/cpm22.bin'), system);

    const disk = new Disk('ibm-3740');
    const fsys = new CpmFs(disk);
    fsys.writeSystem(system);
    const dir = path.join(ROOT, 'disks/cpm22');
    const files = fs.readdirSync(dir).filter(f => /^[A-Z0-9$_-]{1,8}(\.[A-Z0-9$_-]{0,3})?$/.test(f)).sort();
    for (const f of files) fsys.write(f, fs.readFileSync(path.join(dir, f)));
    fsys.write('SYSGEN.COM', sysgenCom);
    fsys.write('PRTDEMO.COM', prtdemoCom);
    for (const f of ['bios.asm', 'boot.asm', 'sysgen.asm', 'prtdemo.asm']) fsys.write(f.toUpperCase(), toCpmText(fs.readFileSync(path.join(ROOT, 'system', f))));
    fs.writeFileSync(path.join(ROOT, 'disks/cpm22.dsk'), disk.data);

    // The Zork I game disk: an 8" data disk (no system), text files with CP/M line ends.
    const zork = new Disk('ibm-3740');
    const zfs = new CpmFs(zork);
    const zdir = path.join(ROOT, 'disks/zork1');
    for (const f of fs.readdirSync(zdir).sort()) {
        const data = fs.readFileSync(path.join(zdir, f));
        const name = f.startsWith('LICENSE-') ? f.slice(8) + '.LIC' : f;       // LICENSE-VEZZA -> VEZZA.LIC
        zfs.write(name, /\.(TXT|LIC)$/i.test(name) ? toCpmText(data) : data);
    }
    fs.writeFileSync(path.join(ROOT, 'disks/zork1.dsk'), zork.data);

    const hex = v => v.toString(16).toUpperCase().padStart(4, '0') + 'h';
    console.log(`CCP ${hex(CCP)}, BDOS ${hex(BDOS)}, BIOS ${hex(BIOS)}-${hex(bios.result.high)} (${biosLoaded} of ${room} bytes on disk)`);
    console.log(`disks/cpm22.dsk: ${fsys.list().length} files, ${fsys.freeBytes() >> 10}K free`);
    console.log(`disks/zork1.dsk: ${zfs.list().map(f => f.name).join(' ')}, ${zfs.freeBytes() >> 10}K free`);
}

main();
