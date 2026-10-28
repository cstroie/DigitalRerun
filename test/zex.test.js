'use strict';
// The Z80 instruction exercisers (Frank Cringle, GPL-2), run on the CPU
// core under a BDOS stub. Slow (minutes): set ZEX=1 to run, ZEX=all for
// zexall too. The .COM files are downloaded once into test/.cache/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Z80 = require('../js/z80.js');

const URL = 'https://raw.githubusercontent.com/agn453/ZEXALL/main/';
const CACHE = path.join(__dirname, '.cache');

async function fetchCom(name) {
    const file = path.join(CACHE, name);
    if (!fs.existsSync(file)) {
        fs.mkdirSync(CACHE, { recursive: true });
        const res = await fetch(URL + name);
        if (!res.ok) throw new Error(`${name}: ${res.status}`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    return fs.readFileSync(file);
}

function run(com) {
    const mem = new Uint8Array(65536);
    mem.set(com, 0x100);
    mem[0] = 0x76;                                // warm boot: HALT
    mem[5] = 0xC9;                                // BDOS: RET, functions trapped below
    mem[6] = 0x00; mem[7] = 0xF0;
    const cpu = new Z80({ mem_read: a => mem[a], mem_write: (a, v) => { mem[a] = v; }, io_read: () => 0xFF, io_write: () => {} });
    const s = cpu.getState(); s.pc = 0x100; s.sp = 0xF000; cpu.setState(s);
    let out = '';
    for (;;) {
        const st = cpu.getState();
        if (st.pc === 0) break;
        if (st.pc === 5) {
            if (st.c === 2) out += String.fromCharCode(st.e);
            if (st.c === 9) for (let a = (st.d << 8) | st.e; mem[a] !== 0x24; a++) out += String.fromCharCode(mem[a]);
        }
        cpu.run_instruction();
    }
    return out;
}

const which = process.env.ZEX === 'all' ? ['zexdoc.com', 'zexall.com'] : process.env.ZEX ? ['zexdoc.com'] : [];
for (const name of which) {
    test(`${name}: every test OK`, { timeout: 30 * 60 * 1000 }, async () => {
        const out = run(await fetchCom(name));
        assert.match(out, /Tests complete/);
        assert.doesNotMatch(out, /ERROR/, out);
    });
}
if (!which.length) test('zexdoc/zexall: skipped (set ZEX=1 or ZEX=all)', { skip: true }, () => {});
