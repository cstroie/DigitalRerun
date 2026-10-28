'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Z80 = require('../js/z80.js');

/** Run the bytes from 0 until HALT; return the CPU state. */
function run(bytes) {
    const mem = new Uint8Array(65536);
    mem.set(bytes);
    const cpu = new Z80({ mem_read: a => mem[a], mem_write: (a, v) => { mem[a] = v; }, io_read: () => 0xFF, io_write: () => {} });
    cpu.reset();
    for (let i = 0; i < 1000 && !cpu.getState().halted; i++) cpu.run_instruction();
    return cpu.getState();
}

test('BIT n,(IX+d) takes the undocumented Y and X flags from the address high byte', () => {
    // LD IX,2800h ; BIT 0,(IX+0) ; HALT    (28h = 0010 1000: bit 5 and bit 3 set)
    let s = run([0xDD, 0x21, 0x00, 0x28, 0xDD, 0xCB, 0x00, 0x46, 0x76]);
    assert.deepEqual([s.flags.Y, s.flags.X], [1, 1]);
    // LD IY,1000h ; BIT 0,(IY+0) ; HALT    (10h: neither)
    s = run([0xFD, 0x21, 0x00, 0x10, 0xFD, 0xCB, 0x00, 0x46, 0x76]);
    assert.deepEqual([s.flags.Y, s.flags.X], [0, 0]);
    // the displacement counts: IX=27F8h, d=+8 -> 2800h
    s = run([0xDD, 0x21, 0xF8, 0x27, 0xDD, 0xCB, 0x08, 0x46, 0x76]);
    assert.deepEqual([s.flags.Y, s.flags.X], [1, 1]);
});

test('get_pc reads the program counter', () => {
    const mem = new Uint8Array(65536);
    mem.set([0x00, 0x00, 0xC3, 0x00, 0x10]);                  // NOP NOP JP 1000h
    const cpu = new Z80({ mem_read: a => mem[a], mem_write: () => {}, io_read: () => 0xFF, io_write: () => {} });
    cpu.reset();
    cpu.run_instruction(); cpu.run_instruction();
    assert.equal(cpu.get_pc(), 2);
    cpu.run_instruction();
    assert.equal(cpu.get_pc(), 0x1000);
});
