/*
 * disz80.js: a Z80 disassembler, every opcode and prefix (CB, ED, DD/FD
 * with IX/IY, DDCB/FDCB), after the usual x/y/z/p/q decoding of the
 * opcode byte. Numbers are hex with an h, a leading 0 before a letter
 * (0E400h), as Zilog's assemblers write them.
 *
 *   disassemble(read, addr) -> { addr, length, bytes, text }
 *   read(a) returns the byte at a (a is taken modulo 64K).
 */
(function (root) {
    'use strict';

    const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
    const RP = ['BC', 'DE', 'HL', 'SP'];
    const RP2 = ['BC', 'DE', 'HL', 'AF'];
    const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
    const ALU = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
    const ROT = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
    const IM = ['0', '0', '1', '2', '0', '0', '1', '2'];
    const BLI = [['LDI', 'CPI', 'INI', 'OUTI'], ['LDD', 'CPD', 'IND', 'OUTD'], ['LDIR', 'CPIR', 'INIR', 'OTIR'], ['LDDR', 'CPDR', 'INDR', 'OTDR']];
    const ACC = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF'];
    const ED7 = ['LD I,A', 'LD R,A', 'LD A,I', 'LD A,R', 'RRD', 'RLD', 'NOP', 'NOP'];

    function hex(v, digits) {
        const s = v.toString(16).toUpperCase().padStart(digits, '0');
        return (/^[A-F]/.test(s) ? '0' : '') + s + 'h';
    }

    function disassemble(read, addr) {
        let pc = addr & 0xFFFF;
        const bytes = [];
        const next = () => { const b = read(pc) & 0xFF; bytes.push(b); pc = (pc + 1) & 0xFFFF; return b; };
        const n = () => hex(next(), 2);
        const nn = () => { const lo = next(); return hex(lo | (next() << 8), 4); };
        const rel = () => { const d = next(); return hex((pc + (d < 128 ? d : d - 256)) & 0xFFFF, 4); };

        let ix = null;                 // 'IX' or 'IY' after a DD or FD prefix
        let disp = null;               // its displacement, read once
        let op = next();
        while (op === 0xDD || op === 0xFD) {
            ix = op === 0xDD ? 'IX' : 'IY';
            op = next();
        }
        const d = () => {               // (IX+d) for (HL)
            if (disp === null) disp = next();
            const v = disp < 128 ? disp : disp - 256;
            return `(${ix}${v < 0 ? '-' : '+'}${hex(Math.abs(v), 2)})`;
        };
        // r[i] with the index register substituted: H/L become IXH/IXL unless (HL) is in the same instruction
        const r = (i, plain = false) => {
            if (!ix) return R[i];
            if (i === 6) return d();
            if (plain) return R[i];
            if (i === 4) return ix + 'H';
            if (i === 5) return ix + 'L';
            return R[i];
        };
        const hl = () => ix || 'HL';
        const rp = p => (p === 2 ? hl() : RP[p]);
        const rp2 = p => (p === 2 ? hl() : RP2[p]);
        let text;

        if (op === 0xCB) {
            if (ix) {                    // DD CB d op: the displacement comes before the opcode
                const where = d();
                const o = next();
                const x = o >> 6, y = (o >> 3) & 7, z = o & 7;
                const copy = z !== 6 ? `,${R[z]}` : '';     // undocumented: the result also to a register
                if (x === 0) text = `${ROT[y]} ${where}${copy}`;
                else if (x === 1) text = `BIT ${y},${where}`;
                else text = `${x === 2 ? 'RES' : 'SET'} ${y},${where}${copy}`;
            } else {
                const o = next();
                const x = o >> 6, y = (o >> 3) & 7, z = o & 7;
                text = x === 0 ? `${ROT[y]} ${R[z]}` : `${['', 'BIT', 'RES', 'SET'][x]} ${y},${R[z]}`;
            }
        } else if (op === 0xED) {
            const o = next();
            const x = o >> 6, y = (o >> 3) & 7, z = o & 7, p = y >> 1, q = y & 1;
            if (x === 1) {
                switch (z) {
                    case 0: text = y === 6 ? 'IN (C)' : `IN ${R[y]},(C)`; break;
                    case 1: text = y === 6 ? 'OUT (C),0' : `OUT (C),${R[y]}`; break;
                    case 2: text = `${q ? 'ADC' : 'SBC'} HL,${RP[p]}`; break;
                    case 3: text = q ? `LD ${RP[p]},(${nn()})` : `LD (${nn()}),${RP[p]}`; break;
                    case 4: text = 'NEG'; break;
                    case 5: text = y === 1 ? 'RETI' : 'RETN'; break;
                    case 6: text = `IM ${IM[y]}`; break;
                    default: text = ED7[y];
                }
            } else if (x === 2 && z <= 3 && y >= 4) text = BLI[y - 4][z];
            else text = `DB 0EDh,${hex(o, 2)}`;
        } else {
            const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
            if (x === 0) {
                switch (z) {
                    case 0:
                        if (y === 0) text = 'NOP';
                        else if (y === 1) text = "EX AF,AF'";
                        else if (y === 2) text = `DJNZ ${rel()}`;
                        else if (y === 3) text = `JR ${rel()}`;
                        else text = `JR ${CC[y - 4]},${rel()}`;
                        break;
                    case 1: text = q ? `ADD ${hl()},${rp(p)}` : `LD ${rp(p)},${nn()}`; break;
                    case 2:
                        text = [
                            ['LD (BC),A', 'LD (DE),A', () => `LD (${nn()}),${hl()}`, () => `LD (${nn()}),A`],
                            ['LD A,(BC)', 'LD A,(DE)', () => `LD ${hl()},(${nn()})`, () => `LD A,(${nn()})`]
                        ][q][p];
                        if (typeof text === 'function') text = text();
                        break;
                    case 3: text = `${q ? 'DEC' : 'INC'} ${rp(p)}`; break;
                    case 4: text = `INC ${r(y)}`; break;
                    case 5: text = `DEC ${r(y)}`; break;
                    case 6: { const dst = r(y); text = `LD ${dst},${n()}`; break; }
                    default: text = ACC[y];
                }
            } else if (x === 1) {
                if (y === 6 && z === 6) text = 'HALT';
                else {
                    const mem = y === 6 || z === 6;        // LD H,(IX+d) keeps H
                    text = `LD ${r(y, mem)},${r(z, mem)}`;
                }
            } else if (x === 2) {
                text = ALU[y] + r(z);
            } else {
                switch (z) {
                    case 0: text = `RET ${CC[y]}`; break;
                    case 1: text = q ? ['RET', 'EXX', `JP (${hl()})`, `LD SP,${hl()}`][p] : `POP ${rp2(p)}`; break;
                    case 2: text = `JP ${CC[y]},${nn()}`; break;
                    case 3:
                        text = [() => `JP ${nn()}`, null, () => `OUT (${n()}),A`, () => `IN A,(${n()})`,
                            () => `EX (SP),${hl()}`, () => 'EX DE,HL', () => 'DI', () => 'EI'][y]();
                        break;
                    case 4: text = `CALL ${CC[y]},${nn()}`; break;
                    case 5: text = q ? `CALL ${nn()}` : `PUSH ${rp2(p)}`; break;
                    case 6: text = ALU[y] + n(); break;
                    default: text = `RST ${hex(y * 8, 2)}`;
                }
            }
        }
        return { addr: addr & 0xFFFF, length: bytes.length, bytes, text };
    }

    /** Does the instruction call (CALL, RST): a step over runs it to the next one. */
    function isCall(read, addr) {
        const op = read(addr & 0xFFFF) & 0xFF;
        return op === 0xCD || (op & 0xC7) === 0xC4 || (op & 0xC7) === 0xC7;
    }

    const api = { disassemble, isCall, hex };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else (root.DigitalRerun = root.DigitalRerun || {}).Disz80 = api;
})(typeof window !== 'undefined' ? window : globalThis);
