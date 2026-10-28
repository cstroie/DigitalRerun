'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { assemble, AsmError } = require('../js/asm8080.js');

const bytes = src => [...assemble(src).image()];

test('8080 instructions encode', () => {
    assert.deepEqual(bytes(' mov a,m\n mvi b,12h\n lxi h,1234h\n push psw\n rst 7\n jnz 0100h'),
        [0x7E, 0x06, 0x12, 0x21, 0x34, 0x12, 0xF5, 0xFF, 0xC2, 0x00, 0x01]);
    assert.deepEqual(bytes(' ldax d\n stax b\n dad sp\n in 0\n out 1\n xchg\n pchl'),
        [0x1A, 0x02, 0x39, 0xDB, 0x00, 0xD3, 0x01, 0xEB, 0xE9]);
});

test('labels, forward references, expressions and $', () => {
    const r = assemble([
        'start:  jmp   there',
        'k       equ   (there-start)*2 + 1',
        '        db    k, low 1234h, high 1234h, \'A\'+1, -1 and 0ffh',
        'there:  dw    $, 0ffh shl 4, not 0',
        '        ds    2',
        'last    equ   $'
    ].join('\n'));
    assert.deepEqual([...r.image()], [0xC3, 0x08, 0x00, 0x11, 0x34, 0x12, 0x42, 0xFF, 0x08, 0x00, 0xF0, 0x0F, 0xFF, 0xFF]);
    assert.equal(r.symbols.get('LAST'), 0x10);
});

test('strings: DRI single quotes, doubled quotes, AS double quotes', () => {
    assert.deepEqual(bytes(" db 'It''s',0\n db \"OK$\""), [73, 116, 39, 115, 0, 79, 75, 36]);
});

test('conditional assembly and defines', () => {
    const src = 'a equ 1\n if a\n db 1\n else\n db 2\n endif\n ifdef origin\n db origin\n endif\n ifndef nothere\n db 3\n endif';
    assert.deepEqual([...assemble(src).image()], [1, 3]);
    assert.deepEqual([...assemble(src, { defines: { origin: 9 } }).image()], [1, 9, 3]);
});

test('errors name the line', () => {
    assert.throws(() => assemble(' nop\n mov a,q'), e => e instanceof AsmError && e.line === 2);
    assert.throws(() => assemble(' jmp nowhere'), /undefined symbol/);
    assert.throws(() => assemble('x: nop\nx: nop'), /defined twice/);
});

test("the DRI CCP and BDOS assemble to Digital Research's own binaries", () => {
    // Assembled at the origins of the CP/M 2.2 distribution's CPM.SYS (Xerox
    // 1800, CCP 0DC00h, BDOS 0E400h), the images hash as that file's do with
    // its six serial number bytes zeroed: byte for byte the original system.
    const sha = b => crypto.createHash('sha256').update(b).digest('hex');
    const build = (file, origin, length) => {
        const src = fs.readFileSync(path.join(__dirname, '../system/dri', file), 'latin1');
        return assemble(src, { defines: { origin } }).image(origin, origin + length - 1);
    };
    assert.equal(sha(build('ccp.asm', 0xDC00, 0x800)), '17e0926a26784c69afaf9342f3f58779eb97ca5be79526fc03a9b2ff7f3922a5');
    assert.equal(sha(build('bdos.asm', 0xE400, 0xE00)), '18c6e55610ba51a843450f1cc69c00c1895488e3f44b99fdeb16fc95ac2a4c66');
});
