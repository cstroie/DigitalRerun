'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Machine } = require('../js/machine.js');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs } = require('../js/cpmfs.js');
const { buildDisk } = require('../js/shelf.js');

const ROOT = path.join(__dirname, '..');
const shelf = JSON.parse(fs.readFileSync(path.join(ROOT, 'disks/shelf.json'), 'utf8'));
const read = async p => new Uint8Array(fs.readFileSync(path.join(ROOT, p)));
const entry = id => shelf.find(e => e.id === id);

/** A machine booted from the system disk with a shelf disk in `drive`. */
async function withDisk(id, drive, loose = false) {
    const m = new Machine();
    m.out = '';
    m.console.output = b => { m.out += String.fromCharCode(b); };
    m.fdc.mount(0, Disk.fromImage(await read('disks/cpm22.dsk')));
    m.fdc.mount(drive, await buildDisk(entry(id), read));
    m.reset();
    m.settle = () => { for (let i = 0; i < 40000; i++) { m.run(200000); if (loose ? m.idle : m.waiting) return; } };
    m.cmd = text => { m.out = ''; m.console.paste(text + '\r'); m.settle(); return m.out; };
    m.settle();
    return m;
}

test('every shelf entry is listed with what the page needs, and its files exist', () => {
    for (const e of shelf) {
        assert.ok(e.id && e.name && e.description && e.credit && e.licence && e.category, e.id);
        assert.ok(['sssd8', 'hd4mb'].includes(e.format), e.id);
        if (e.image) assert.ok(fs.existsSync(path.join(ROOT, e.image)), e.image);
        else for (const f of e.files) assert.ok(fs.existsSync(path.join(ROOT, f.path)), f.path);
    }
    assert.deepEqual(shelf.map(e => e.id).sort(), ['bbcbasic', 'bdsc', 'cpm22', 'hitech', 'zork1', 'zork2', 'zork3']);
});

test('each shelf disk builds as the page builds it, every file on it', async () => {
    for (const e of shelf.filter(x => x.files)) {
        const fsys = new CpmFs(await buildDisk(e, read));
        assert.deepEqual(fsys.list().map(f => f.name).sort(), e.files.map(f => f.name).sort(), e.id);
    }
});

test('BBC BASIC: the tokenized example runs', async () => {
    const m = await withDisk('bbcbasic', 1, true);           // it waits for keys between other work
    m.cmd('B:');
    assert.match(m.cmd('BBCBASIC'), /BBC BASIC \(Z80\)/);
    m.cmd('LOAD "MANDEL"');
    assert.match(m.cmd('LIST'), /Mandelbrot/);                   // (running it takes minutes, as it did)
    assert.match(m.cmd('LOAD "PRIMES"') + m.cmd('RUN'), /168 primes/);
});

test('BDS C compiles, links and runs HELLO.C', async () => {
    const m = await withDisk('bdsc', 1);
    m.cmd('B:');
    m.cmd('CC HELLO');
    m.cmd('CLINK HELLO');
    assert.match(m.cmd('HELLO'), /Hello from BDS C[\s\S]*5 squared is 25/);
});

test('HI-TECH C compiles and runs HELLO.C from the I: hard disk', async () => {
    const m = await withDisk('hitech', 8);
    m.cmd('I:');
    m.cmd('C HELLO.C');
    assert.match(m.cmd('HELLO'), /Hello from HI-TECH C[\s\S]*5 squared is 25/);
});

test('Zork II starts from its shelf disk', async () => {
    const m = await withDisk('zork2', 2);
    m.cmd('C:');
    assert.match(m.cmd('VEZZA ZORK2.Z3'), /ZORK II/i);
});
