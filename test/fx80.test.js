'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FX80 } = require('../js/fx80.js');

function printer() {
    const dots = [];
    const p = new FX80({ dot: (x, y) => dots.push([x, y]) });
    p.dotList = dots;
    return p;
}

test('a character strikes its glyph, pica pitch 1/10"', () => {
    const p = printer();
    p.writeString('H');
    assert.equal(p.dotList.length, 7 * 2 + 3);         // two uprights of 7 and the bar's 3 inner dots
    assert.ok(Math.abs(p.x - 0.1) < 1e-9);
    p.writeString('\x1bM'); p.writeString('H');           // elite: 1/12"
    assert.ok(Math.abs(p.x - (0.1 + 1 / 12)) < 1e-9);
    p.writeString('\x0fH');                              // condensed
    assert.ok(Math.abs(p.x - (0.1 + 1 / 12 + 1 / 17.16)) < 1e-9);
});

test('emphasized and double-strike double the dots; enlarged doubles the width', () => {
    const count = s => { const p = printer(); p.writeString(s); return p; };
    const n = count('I').dotList.length;
    assert.equal(count('\x1bEI').dotList.length, 2 * n);
    assert.equal(count('\x1bGI').dotList.length, 2 * n);
    const wide = count('\x1bW1I');
    assert.ok(Math.abs(wide.x - 0.2) < 1e-9);
    const so = count('\x0eI\r\nI');                       // SO lasts one line
    assert.ok(Math.abs(so.x - 0.1) < 1e-9);
});

test('line spacing, form feed and CR', () => {
    const p = printer();
    const y0 = p.y;
    p.writeString('\n');
    assert.ok(Math.abs(p.y - y0 - 1 / 6) < 1e-9);
    p.writeString('\x1b0\n');
    assert.ok(Math.abs(p.y - y0 - 1 / 6 - 1 / 8) < 1e-9);
    p.writeString('\x1b3\x24\n');                        // 36/216 = 1/6
    assert.ok(Math.abs(p.y - y0 - 1 / 6 - 1 / 8 - 1 / 6) < 1e-9);
    p.writeString('AB\r');
    assert.equal(p.x, 0);
    p.writeString('\f');
    assert.ok(Math.abs(p.y - (11 + y0)) < 1e-9);
});

test('bit image: ESC K takes n1 n2 columns of 8 pins at 60 dpi', () => {
    const p = printer();
    p.write(0x1B); p.writeString('K'); p.write(3); p.write(0);
    [0x80, 0xFF, 0x01].forEach(b => p.write(b));
    assert.equal(p.dotList.length, 1 + 8 + 1);
    assert.ok(Math.abs(p.x - 3 / 60) < 1e-9);
    p.writeString('A');                                   // back to text after the data
    assert.ok(p.dotList.length > 10);
});

test('unknown and skipped sequences do not print their parameters', () => {
    const p = printer();
    p.writeString('\x1bR\x02\x1bU1\x1b8\x1b@');
    assert.equal(p.dotList.length, 0);
    p.writeString('\x1bD\x05\x0a\x00\tX');                // tabs at 5 and 10
    assert.ok(Math.abs(p.x - 0.6) < 1e-9);
});

test('codes 80h-FFh print in italics and underline adds a rule', () => {
    const p = printer();
    p.write(0xC9);                                        // italic I
    const xs = p.dotList.map(d => d[0]);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 0.02);
    const u = printer();
    u.writeString('\x1b-1 ');
    assert.equal(u.dotList.length, 12);
});
