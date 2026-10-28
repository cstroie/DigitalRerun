'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk, FORMATS } = require('../js/devices/fdc.js');
const { CpmFs, diskFromImage, toCpmText, fromCpmText } = require('../js/cpmfs.js');

// STAT: (dsm + 1) blocks, less the directory's and NOTE.TXT's
const FLOPPIES = { ssdd5: '192k', dsdd5: '390k', ssdd5k: '182k' };

function boot(disk) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(new Uint8Array(fs.readFileSync(path.join(__dirname, '../disks/cpm22.dsk')))));
    m.fdc.mount(1, disk);
    m.reset();
    m.settle = () => { for (let i = 0; i < 3000; i++) { m.run(200000); if (m.waiting) return; } };
    m.cmd = text => { m.out = ''; m.console.paste(text + '\r'); m.settle(); return m.out; };
    m.settle();
    return m;
}

for (const [format, room] of Object.entries(FLOPPIES)) {
    test(`${FORMATS[format].name}: CP/M reads, writes and sizes it`, () => {
        const disk = new Disk(format);
        new CpmFs(disk).write('NOTE.TXT', toCpmText(Buffer.from(`written from outside on ${format}\n`)));
        const m = boot(disk);
        assert.match(m.cmd('STAT B:'), new RegExp(`Bytes Remaining On B: ${room}`));
        assert.match(m.cmd('TYPE B:NOTE.TXT'), new RegExp(`written from outside on ${format}`));
        m.cmd('PIP B:PIP.COM=A:PIP.COM');
        m.cmd('PIP B:BIOS.ASM=A:BIOS.ASM');                       // more than one extent's worth on 1K blocks
        assert.match(m.cmd('DIR B:'), /PIP {6}COM[\s\S]*BIOS {5}ASM/);
        const out = new CpmFs(disk), sys = new CpmFs(m.fdc.drives[0]);
        assert.deepEqual([...out.read('PIP.COM')], [...sys.read('PIP.COM')]);
        assert.deepEqual([...out.read('BIOS.ASM')], [...sys.read('BIOS.ASM')]);
    });
}

test('5¼" records sit where cpmtools puts them: record r of a track in sector r / (seclen/128)', () => {
    const d = new Disk('ssdd5k');                                 // 1024-byte sectors, 3 system tracks
    // track 3, sector 1 is the first data sector: the directory
    assert.equal(d.offset(3, 1), 3 * 5 * 1024);
    assert.equal(d.offset(3, 9), 3 * 5 * 1024 + 1024);           // record 8 starts the second sector
    assert.equal(d.offset(3, 10), 3 * 5 * 1024 + 1024 + 128);
    const k = new Disk('dsdd5');
    assert.equal(k.offset(1, 5), 10 * 512 + 512);
});

test('the two 200K formats are told apart by their directory', () => {
    for (const format of ['ssdd5', 'ssdd5k']) {
        const d = new Disk(format);
        const f = new CpmFs(d);
        f.write('ONE.COM', new Uint8Array(3000).fill(1));
        f.write('TWO.TXT', toCpmText(Buffer.from('two\n')));
        const found = diskFromImage(d.data.slice());
        assert.equal(found.format, format);
        assert.equal(Buffer.from(fromCpmText(new CpmFs(found).read('TWO.TXT'))).toString(), 'two\n');
    }
    assert.throws(() => Disk.fromImage(new Uint8Array(204800)), /more than one format/);
});
