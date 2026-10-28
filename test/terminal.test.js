'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Terminal, ATTR } = require('../js/terminal.js');

const term = s => { const t = new Terminal(); t.writeString(s); return t; };

test('text, CR LF, backspace and tabs', () => {
    const t = term('abc\r\nxy\bz\tq');
    assert.equal(t.text().split('\n').slice(0, 2).join('|'), 'abc|xz      q');
    assert.deepEqual([t.x, t.y], [9, 1]);
});

test('cursor addressing and erasing', () => {
    const t = term('hello world\x1b[1;7H\x1b[K\x1b[3;5HX\x1b[2A\x1b[1D!');
    assert.equal(t.text().split('\n')[0], 'hell!');      // back to row 1, column 5
    assert.equal(t.text().split('\n')[2], '    X');
    t.writeString('\x1b[2J');
    assert.equal(t.text().trim(), '');
});

test('wraps at column 80 and scrolls at the bottom', () => {
    const t = new Terminal();
    t.writeString('x'.repeat(81));
    assert.deepEqual([t.x, t.y], [1, 1]);
    for (let i = 0; i < 30; i++) t.writeString(`line ${i}\r\n`);
    assert.equal(t.text().split('\n')[22], 'line 29');
});

test('scroll region, insert and delete lines', () => {
    const t = new Terminal();
    for (let i = 0; i < 5; i++) t.writeString(`\x1b[${i + 1};1Hrow${i}`);
    t.writeString('\x1b[2;4r\x1b[4;1H\n');           // scroll rows 2-4 only
    assert.deepEqual(t.text().split('\n').slice(0, 5), ['row0', 'row2', 'row3', '', 'row4']);
    t.writeString('\x1b[1;1H\x1b[r\x1b[1L');
    assert.equal(t.text().split('\n')[1], 'row0');
});

test('attributes and status replies', () => {
    const t = term('\x1b[1;7mA\x1b[0mB');
    assert.equal(t.attrs[0][0], ATTR.BOLD | ATTR.REVERSE);
    assert.equal(t.attrs[0][1], 0);
    const replies = [];
    t.reply = b => replies.push(String.fromCharCode(...b));
    t.writeString('\x1b[6n');
    assert.deepEqual(replies, ['\x1b[1;3R']);
});
