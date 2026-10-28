'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText, fromCpmText, splitName, isTextName } = require('../js/cpmfs.js');

const random = (n, seed = 1) => Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24);

for (const format of ['ibm-3740', 'hd4mb']) {
    test(`${format}: write, list, read back, erase`, () => {
        const fsys = new CpmFs(new Disk(format));
        const free = fsys.freeBytes();
        const small = random(300), big = random(40000, 7);   // big spans several extents
        fsys.write('small.bin', small);
        fsys.write('BIG.DAT', big, 3);
        const list = fsys.list();
        assert.deepEqual(list.map(f => [f.user, f.name, f.records]).sort(),
            [[0, 'SMALL.BIN', 3], [3, 'BIG.DAT', Math.ceil(40000 / 128)]]);
        assert.deepEqual([...fsys.read('SMALL.BIN').subarray(0, 300)], [...small]);
        assert.deepEqual([...fsys.read('big.dat', 3).subarray(0, 40000)], [...big]);
        assert.equal(fsys.read('small.bin')[300], 0x1A);
        assert.ok(fsys.freeBytes() < free);
        assert.ok(fsys.erase('BIG.DAT', 3));
        fsys.write('small.bin', random(10));                 // replace keeps one file
        assert.equal(fsys.list().length, 1);
        assert.ok(fsys.erase('SMALL.BIN'));
        assert.equal(fsys.freeBytes(), free);
    });
}

test('a full disk and a full directory are refused', () => {
    const fsys = new CpmFs(new Disk('ibm-3740'));
    assert.throws(() => fsys.write('HUGE.DAT', new Uint8Array(300000)), /disk full/);
    for (let i = 0; i < 64; i++) fsys.write(`F${i}.TXT`, new Uint8Array(1));
    assert.throws(() => fsys.write('ONEMORE.TXT', new Uint8Array(1)), /directory full/);
});

test('names and text', () => {
    assert.deepEqual(splitName('pip.com'), { name: 'PIP     ', ext: 'COM' });
    assert.throws(() => splitName('too long name.txt'));
    assert.throws(() => splitName('a.b.c'));
    assert.ok(isTextName('bios.asm') && !isTextName('pip.com'));
    const text = Buffer.from('one\ntwo\n');
    assert.deepEqual([...toCpmText(text)], [...Buffer.from('one\r\ntwo\r\n\x1a')]);
    assert.equal(Buffer.from(fromCpmText(toCpmText(text))).toString(), 'one\ntwo\n');
});

test('system tracks', () => {
    const fsys = new CpmFs(new Disk('ibm-3740'));
    fsys.writeSystem(Uint8Array.of(1, 2, 3));
    assert.deepEqual([...fsys.readSystem().subarray(0, 3)], [1, 2, 3]);
    assert.equal(fsys.readSystem().length, 6656);
    assert.throws(() => fsys.writeSystem(new Uint8Array(7000)));
    assert.equal(fsys.list().length, 0);
});
