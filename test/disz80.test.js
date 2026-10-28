'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { disassemble, isCall } = require('../js/disz80.js');

/** Disassemble a byte list at `org`, all of it. */
function dis(bytes, org = 0x100) {
    const mem = new Uint8Array(65536);
    mem.set(bytes, org);
    const out = [];
    for (let a = org; a < org + bytes.length;) {
        const i = disassemble(x => mem[x], a);
        out.push(i.text);
        a += i.length;
    }
    return out;
}

test('main page: loads, jumps, arithmetic, relative jumps', () => {
    assert.deepEqual(dis([0xC3, 0x5C, 0xE7, 0x3E, 0x07, 0x21, 0x34, 0x12, 0x7E, 0x77, 0x76, 0x18, 0xFE, 0x20, 0x02, 0xC6, 0x80, 0xEB, 0x08, 0xD3, 0x01]), [
        'JP 0E75Ch', 'LD A,07h', 'LD HL,1234h', 'LD A,(HL)', 'LD (HL),A', 'HALT',
        'JR 010Bh', 'JR NZ,0111h', 'ADD A,80h', 'EX DE,HL', "EX AF,AF'", 'OUT (01h),A']);
    assert.deepEqual(dis([0xCD, 0x05, 0x00, 0xC9, 0xFF, 0xF5, 0xC1, 0x10, 0xFE, 0x32, 0x00, 0x80]), [
        'CALL 0005h', 'RET', 'RST 38h', 'PUSH AF', 'POP BC', 'DJNZ 0107h', 'LD (8000h),A']);
});

test('CB, ED and block instructions', () => {
    assert.deepEqual(dis([0xCB, 0x47, 0xCB, 0x3E, 0xCB, 0xFF, 0xED, 0xB0, 0xED, 0x52, 0xED, 0x43, 0x00, 0x90, 0xED, 0x56, 0xED, 0x78, 0xED, 0x44]), [
        'BIT 0,A', 'SRL (HL)', 'SET 7,A', 'LDIR', 'SBC HL,DE', 'LD (9000h),BC', 'IM 1', 'IN A,(C)', 'NEG']);
});

test('IX and IY, with displacements and the DDCB form', () => {
    assert.deepEqual(dis([0xDD, 0x21, 0x00, 0x40, 0xDD, 0x7E, 0x05, 0xFD, 0x77, 0xFE, 0xDD, 0x66, 0x02, 0xDD, 0x34, 0x01,
        0xDD, 0xCB, 0x03, 0x46, 0xFD, 0xCB, 0xFF, 0xC6, 0xDD, 0x26, 0x12, 0xDD, 0xE9, 0xFD, 0xE5]), [
        'LD IX,4000h', 'LD A,(IX+05h)', 'LD (IY-02h),A', 'LD H,(IX+02h)', 'INC (IX+01h)',
        'BIT 0,(IX+03h)', 'SET 0,(IY-01h)', 'LD IXH,12h', 'JP (IX)', 'PUSH IY']);
});

test('every opcode decodes to something, within four bytes', () => {
    for (const pre of [[], [0xCB], [0xED], [0xDD], [0xFD], [0xDD, 0xCB, 0x00], [0xFD, 0xCB, 0x7F]]) {
        for (let op = 0; op < 256; op++) {
            const mem = new Uint8Array(65536);
            mem.set([...pre, op, 0x34, 0x12, 0x56]);
            const i = disassemble(a => mem[a], 0);
            assert.ok(i.text && !/undefined|NaN/.test(i.text), `${pre} ${op}: ${i.text}`);
            assert.ok(i.length >= 1 && i.length <= 4, `${pre} ${op}: ${i.length}`);
        }
    }
});

test('the CCP starts as it should', () => {
    const fs = require('node:fs'), path = require('node:path');
    const sys = fs.readFileSync(path.join(__dirname, '../system/cpm22.bin'));
    const mem = new Uint8Array(65536);
    mem.set(sys.subarray(128), 0xE400);                       // CCP, BDOS, BIOS where they run
    assert.match(disassemble(a => mem[a], 0xE400).text, /^JP 0E7..h$/);
    assert.match(disassemble(a => mem[a], 0xFA00).text, /^JP 0F[AB]..h$/);   // the BIOS jump table
    assert.ok(isCall(a => mem[a], 0xFA00) === false);
});
