'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CpmFs } = require('../js/cpmfs.js');
const { fromFolder, cpmName } = require('../js/folderdisk.js');

const item = (p, data) => ({ path: p, read: async () => (typeof data === 'string' ? Buffer.from(data, 'latin1') : data) });
const names = (disk, user = 0) => new CpmFs(disk).list().filter(f => f.user === user).map(f => f.name).sort();

test('names CP/M cannot hold are made into 8.3 ones', () => {
    assert.equal(cpmName('wordstar.com'), 'WORDSTAR.COM');
    assert.equal(cpmName('My Letter 1988.text'), 'MYLETTER.TEX');
    assert.equal(cpmName('a.b.c'), 'AB.C');
    assert.equal(cpmName('README'), 'README');
    assert.equal(cpmName('...'), 'FILE');
});

test('a folder becomes a disk: names fixed, text converted, user areas, junk and strays left out', async () => {
    const r = await fromFolder([
        item('WS.COM', Buffer.from([0xC3, 0, 1, 0xFF, 0x00])), item('WSOVLY1.OVR', Buffer.alloc(3000, 7)),
        item('Read Me.txt', 'one\ntwo\n'), item('read me.txt', 'dup\n'), item('.DS_Store', 'x'), item('Thumbs.db', 'x'),
        item('2/NOTES.TXT', 'in user 2\n'), item('user15/A.COM', Buffer.alloc(10)),
        item('docs/deep/x.txt', 'no'), item('16/Y.TXT', 'no')
    ], 'WordStar');
    assert.equal(r.format, 'sssd8');
    assert.deepEqual(names(r.disk), ['README.TXT', 'README2.TXT', 'WS.COM', 'WSOVLY1.OVR']);
    assert.deepEqual(names(r.disk, 2), ['NOTES.TXT']);
    assert.deepEqual(names(r.disk, 15), ['A.COM']);
    assert.deepEqual(r.skipped.map(s => s[0]).sort(), ['16/Y.TXT', 'docs/deep/x.txt']);
    assert.deepEqual(r.renamed.map(x => x[1]).sort(), ['README.TXT', 'README2.TXT']);
    const fsys = new CpmFs(r.disk);
    assert.equal(Buffer.from(fsys.read('README.TXT').subarray(0, 10)).toString('latin1'), 'one\r\ntwo\r\n');     // CP/M line ends
    assert.deepEqual([...fsys.read('WS.COM').subarray(0, 5)], [0xC3, 0, 1, 0xFF, 0]);                          // a program is left alone
    assert.equal(r.disk.name, 'WordStar');
});

test('the smallest disk that holds it: bigger folders get the 400K disk, then the hard disk', async () => {
    const big = n => [item('A.DAT', Buffer.alloc(n, 1))];
    assert.equal((await fromFolder(big(200e3), 'x')).format, 'sssd8');
    assert.equal((await fromFolder(big(300e3), 'x')).format, 'dsdd5');
    assert.equal((await fromFolder(big(1e6), 'x')).format, 'hd4mb');
    await assert.rejects(fromFolder(big(5e6), 'x'), /does not fit/);
    const many = Array.from({ length: 100 }, (_, i) => item(`F${i}.DAT`, Buffer.alloc(10, 1)));   // too many for a 64 entry directory
    assert.equal((await fromFolder(many, 'x')).format, 'hd4mb');
});

test('an empty folder is refused', async () => {
    await assert.rejects(fromFolder([item('.DS_Store', 'x')], 'x'), /no file/);
});
