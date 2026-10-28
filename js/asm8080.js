/*
 * asm8080.js: a two-pass 8080 assembler.
 *
 * It reads the dialect of CP/M's ASM.COM and of Macro Assembler AS in 8080
 * mode, enough to build the original CCP and BDOS sources and the BIOS:
 *
 *   label:  mnemonic operands   ; comment
 *   name    equ   expression        (also SET, =)
 *   org, db/defb, dw/defw, ds/defs, end
 *   if/else/endif, ifdef/ifndef     (conditional assembly, nested)
 *   title, page, .cpu, cpu, listing, name, maclib (ignored)
 *
 * Numbers: 123, 0ffh, 1010b, 17o/17q, $1f, 0x1f; 'c' and "c" characters;
 * $ is the location counter. Operators, lowest precedence first:
 *   OR | XOR ^   AND &   EQ = NE <> LT < LE <= GT > GE >=
 *   + -   * / MOD SHL << SHR >>   unary - + NOT ~ HIGH LOW
 * Symbols are case-insensitive. Arithmetic is 16-bit.
 */
(function (root) {
    'use strict';

    const REG = { B: 0, C: 1, D: 2, E: 3, H: 4, L: 5, M: 6, A: 7 };
    const RP = { B: 0, D: 1, H: 2, SP: 3 };
    const RPPSW = { B: 0, D: 1, H: 2, PSW: 3 };

    const IMPLIED = {
        NOP: 0x00, RLC: 0x07, RRC: 0x0F, RAL: 0x17, RAR: 0x1F, DAA: 0x27, CMA: 0x2F, STC: 0x37,
        CMC: 0x3F, HLT: 0x76, RNZ: 0xC0, RZ: 0xC8, RNC: 0xD0, RC: 0xD8, RPO: 0xE0, RPE: 0xE8,
        RP: 0xF0, RM: 0xF8, RET: 0xC9, XTHL: 0xE3, PCHL: 0xE9, XCHG: 0xEB, SPHL: 0xF9,
        DI: 0xF3, EI: 0xFB
    };
    const ALU_REG = { ADD: 0x80, ADC: 0x88, SUB: 0x90, SBB: 0x98, ANA: 0xA0, XRA: 0xA8, ORA: 0xB0, CMP: 0xB8 };
    const ALU_IMM = { ADI: 0xC6, ACI: 0xCE, SUI: 0xD6, SBI: 0xDE, ANI: 0xE6, XRI: 0xEE, ORI: 0xF6, CPI: 0xFE };
    const ADDR16 = {
        LDA: 0x3A, STA: 0x32, LHLD: 0x2A, SHLD: 0x22, JMP: 0xC3, CALL: 0xCD,
        JNZ: 0xC2, JZ: 0xCA, JNC: 0xD2, JC: 0xDA, JPO: 0xE2, JPE: 0xEA, JP: 0xF2, JM: 0xFA,
        CNZ: 0xC4, CZ: 0xCC, CNC: 0xD4, CC: 0xDC, CPO: 0xE4, CPE: 0xEC, CP: 0xF4, CM: 0xFC
    };
    const IGNORED = new Set(['TITLE', 'PAGE', '.CPU', 'CPU', 'LISTING', 'NAME', 'MACLIB', 'EJECT', 'SPACE', '.Z80', '.8080', 'ASEG', 'CSEG', 'DSEG']);

    class AsmError extends Error {
        constructor(message, line) {
            super(line ? `line ${line}: ${message}` : message);
            this.line = line;
        }
    }

    /* ---------- expressions ---------- */

    function tokenize(text, line) {
        const tokens = [];
        let i = 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch === ' ' || ch === '\t') { i++; continue; }
            if (ch === "'" || ch === '"') {
                let j = i + 1, s = '';
                for (;;) {
                    if (j >= text.length) throw new AsmError('unterminated string', line);
                    if (text[j] === ch) {
                        if (text[j + 1] === ch) { s += ch; j += 2; continue; }
                        break;
                    }
                    s += text[j++];
                }
                tokens.push({ t: 'str', v: s });
                i = j + 1;
                continue;
            }
            const two = text.substr(i, 2);
            if (['<=', '>=', '<>', '<<', '>>', '==', '!='].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
            if ('+-*/()&|^~<>=,'.includes(ch)) { tokens.push({ t: 'op', v: ch }); i++; continue; }
            const m = /^[A-Za-z0-9_$.?@]+/.exec(text.slice(i));
            if (!m) throw new AsmError(`unexpected character '${ch}'`, line);
            tokens.push({ t: 'word', v: m[0] });
            i += m[0].length;
        }
        return tokens;
    }

    function parseNumber(w) {
        const u = w.toUpperCase();
        let m;
        if (u === '$') return null;
        if ((m = /^\$([0-9A-F]+)$/.exec(u))) return parseInt(m[1], 16);
        if ((m = /^0X([0-9A-F]+)$/.exec(u))) return parseInt(m[1], 16);
        if (!/^[0-9]/.test(u)) return null;
        if ((m = /^([0-9A-F]+)H$/.exec(u))) return parseInt(m[1], 16);
        if ((m = /^([01]+)B$/.exec(u))) return parseInt(m[1], 2);
        if ((m = /^([0-7]+)[OQ]$/.exec(u))) return parseInt(m[1], 8);
        if ((m = /^([0-9]+)D?$/.exec(u))) return parseInt(m[1], 10);
        return undefined;
    }

    const WORD_OPS = { OR: '|', XOR: '^', AND: '&', NOT: '~', MOD: 'MOD', SHL: '<<', SHR: '>>', EQ: '=', NE: '<>', LT: '<', LE: '<=', GT: '>', GE: '>=', HIGH: 'HIGH', LOW: 'LOW' };

    /* Evaluate tokens; `lookup(name)` returns a value or undefined (unknown yet). */
    function evaluate(tokens, ctx) {
        let pos = 0;
        let unknown = false;
        const peek = () => {
            const tk = tokens[pos];
            if (!tk) return null;
            if (tk.t === 'word' && WORD_OPS[tk.v.toUpperCase()]) return WORD_OPS[tk.v.toUpperCase()];
            return tk.t === 'op' ? tk.v : null;
        };
        const take = () => tokens[pos++];
        const bin = (ops, next, fn) => () => {
            let v = next();
            for (let op = peek(); op && ops.includes(op); op = peek()) {
                take();
                v = fn(op, v, next());
            }
            return v;
        };
        const cmp = (op, a, b) => {
            const r = op === '=' || op === '==' ? a === b : op === '<>' || op === '!=' ? a !== b
                : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
            return r ? 0xFFFF : 0;
        };
        const unary = () => {
            const op = peek();
            if (op === '-') { take(); return (-unary()) & 0xFFFF; }
            if (op === '+') { take(); return unary(); }
            if (op === '~') { take(); return (~unary()) & 0xFFFF; }
            if (op === 'HIGH') { take(); return (unary() >> 8) & 0xFF; }
            if (op === 'LOW') { take(); return unary() & 0xFF; }
            return primary();
        };
        const primary = () => {
            const tk = take();
            if (!tk) throw new AsmError('expression expected', ctx.line);
            if (tk.t === 'op' && tk.v === '(') {
                const v = orExpr();
                const close = take();
                if (!close || close.v !== ')') throw new AsmError("')' expected", ctx.line);
                return v;
            }
            if (tk.t === 'str') {
                if (tk.v.length === 0 || tk.v.length > 2) throw new AsmError('string in expression must be 1 or 2 characters', ctx.line);
                return tk.v.length === 1 ? tk.v.charCodeAt(0) : (tk.v.charCodeAt(0) << 8) | tk.v.charCodeAt(1);
            }
            if (tk.t === 'word') {
                if (tk.v === '$') return ctx.pc & 0xFFFF;
                const n = parseNumber(tk.v);
                if (n === undefined) throw new AsmError(`bad number '${tk.v}'`, ctx.line);
                if (n !== null) return n & 0xFFFF;
                const v = ctx.lookup(tk.v.toUpperCase());
                if (v === undefined) { unknown = true; return 0; }
                return v & 0xFFFF;
            }
            throw new AsmError(`unexpected '${tk.v}'`, ctx.line);
        };
        const mul = bin(['*', '/', 'MOD', '<<', '>>'], unary, (op, a, b) => {
            if ((op === '/' || op === 'MOD') && b === 0) { if (unknown) return 0; throw new AsmError('division by zero', ctx.line); }
            return (op === '*' ? a * b : op === '/' ? Math.floor(a / b) : op === 'MOD' ? a % b : op === '<<' ? a << b : a >>> b) & 0xFFFF;
        });
        const add = bin(['+', '-'], mul, (op, a, b) => (op === '+' ? a + b : a - b) & 0xFFFF);
        const rel = bin(['=', '==', '<>', '!=', '<', '<=', '>', '>='], add, cmp);
        const andExpr = bin(['&'], rel, (op, a, b) => a & b);
        const orExpr = bin(['|', '^'], andExpr, (op, a, b) => (op === '|' ? a | b : a ^ b));
        const value = orExpr();
        if (pos < tokens.length) throw new AsmError(`unexpected '${tokens[pos].v}'`, ctx.line);
        return { value, unknown };
    }

    /* Split an operand field at top-level commas (not inside strings or parentheses). */
    function splitOperands(text) {
        const out = [];
        let depth = 0, cur = '', quote = null;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (quote) {
                cur += ch;
                if (ch === quote) {
                    if (text[i + 1] === quote) { cur += text[++i]; } else quote = null;
                }
                continue;
            }
            if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
            cur += ch;
        }
        if (cur.trim() !== '' || out.length) out.push(cur.trim());
        return out;
    }

    /* Remove a comment, respecting quotes. */
    function stripComment(text) {
        let quote = null;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (quote) { if (ch === quote) quote = null; continue; }
            if (ch === "'" || ch === '"') {
                // A lone apostrophe after a letter (e.g. AF') is not a string here.
                quote = ch;
                continue;
            }
            if (ch === ';') return text.slice(0, i);
        }
        return text;
    }

    /* ---------- statements ---------- */

    function parseLine(raw) {
        let text = stripComment(raw).replace(/\s+$/, '');
        if (text.trim() === '' ) return null;
        let label = null;
        // "label:" anywhere at the start, or a word in column 1.
        let m = /^\s*([A-Za-z_$.?@][A-Za-z0-9_$.?@]*):+/.exec(text);
        if (m) {
            label = m[1];
            text = text.slice(m[0].length);
        } else if (/^[A-Za-z_$.?@]/.test(text)) {
            m = /^([A-Za-z_$.?@][A-Za-z0-9_$.?@]*)/.exec(text);
            const word = m[1].toUpperCase();
            const isOp = IMPLIED[word] !== undefined || ALU_REG[word] !== undefined || ALU_IMM[word] !== undefined
                || ADDR16[word] !== undefined || DIRECTIVES.has(word) || IGNORED.has(word) || OTHER_OPS.has(word);
            if (!isOp) { label = m[1]; text = text.slice(m[0].length); }
        }
        text = text.trim();
        if (text === '') return { label, op: null, args: '' };
        m = /^(\S+)\s*(.*)$/.exec(text);
        let op = m[1].toUpperCase();
        let args = m[2];
        // "name equ value" written as "name: equ" was handled; "name = value" too.
        if (op === '=') op = 'EQU';
        return { label, op, args };
    }

    const DIRECTIVES = new Set(['ORG', 'EQU', 'SET', 'DB', 'DEFB', 'DEFM', 'DW', 'DEFW', 'DS', 'DEFS', 'END',
        'IF', 'IFDEF', 'IFNDEF', 'ELSE', 'ENDIF', 'IFE', 'IFT', 'IFF']);
    const OTHER_OPS = new Set(['MOV', 'MVI', 'INR', 'DCR', 'LXI', 'DAD', 'INX', 'DCX', 'PUSH', 'POP',
        'LDAX', 'STAX', 'RST', 'IN', 'OUT']);

    /**
     * Assemble `source`. Options:
     *   defines: { NAME: value }   symbols set before pass 1 (like asl -D)
     * Returns { memory: Map<addr, byte>, low, high, symbols, listing, image(lo, hi) }.
     * Throws AsmError on the first error.
     */
    function assemble(source, options = {}) {
        const lines = source.split(/\r?\n/);
        const defines = {};
        for (const [k, v] of Object.entries(options.defines || {})) defines[k.toUpperCase()] = v & 0xFFFF;
        let symbols = new Map();
        let memory;
        let listing;

        for (let pass = 1; pass <= 2; pass++) {
            const passSymbols = new Map();
            memory = new Map();
            listing = [];
            let pc = 0;
            const cond = [];     // stack of { active, taken, parentActive }
            const active = () => cond.every(c => c.active);
            const lookup = name => {
                if (name in defines) return defines[name];
                if (passSymbols.has(name)) return passSymbols.get(name);
                if (pass === 2 && symbols.has(name)) return symbols.get(name);
                return pass === 1 && symbols.has(name) ? symbols.get(name) : undefined;
            };
            const defined = name => name in defines || passSymbols.has(name) || symbols.has(name);

            for (let n = 0; n < lines.length; n++) {
                const lineNo = n + 1;
                const st = parseLine(lines[n]);
                if (!st) continue;
                const ctx = { pc, line: lineNo, lookup };
                const expr = (text, need) => {
                    const r = evaluate(tokenize(text, lineNo), ctx);
                    if (r.unknown && (pass === 2 || need)) {
                        throw new AsmError(`undefined symbol in '${text}'`, lineNo);
                    }
                    return r.value;
                };

                // Conditionals are processed even when inactive.
                const op = st.op;
                if (op === 'IF' || op === 'IFT' || op === 'IFE' || op === 'IFF' || op === 'IFDEF' || op === 'IFNDEF') {
                    let truth = false;
                    if (active()) {
                        if (op === 'IFDEF' || op === 'IFNDEF') {
                            truth = defined(st.args.trim().toUpperCase());
                            if (op === 'IFNDEF') truth = !truth;
                        } else {
                            truth = expr(st.args, true) !== 0;
                            if (op === 'IFE' || op === 'IFF') truth = !truth;
                        }
                    }
                    cond.push({ active: truth, taken: truth });
                    continue;
                }
                if (op === 'ELSE') {
                    const c = cond[cond.length - 1];
                    if (!c) throw new AsmError('ELSE without IF', lineNo);
                    const parentActive = cond.slice(0, -1).every(x => x.active);
                    c.active = parentActive && !c.taken;
                    c.taken = c.taken || c.active;
                    continue;
                }
                if (op === 'ENDIF') {
                    if (!cond.pop()) throw new AsmError('ENDIF without IF', lineNo);
                    continue;
                }
                if (!active()) continue;
                if (op === 'END') break;

                const start = pc;
                const bytes = [];
                const emit8 = v => bytes.push(v & 0xFF);
                const emit16 = v => { bytes.push(v & 0xFF); bytes.push((v >> 8) & 0xFF); };
                const define = (name, value, redefinable) => {
                    const key = name.toUpperCase();
                    if (!redefinable && passSymbols.has(key) && passSymbols.get(key) !== value) {
                        throw new AsmError(`symbol '${name}' defined twice`, lineNo);
                    }
                    passSymbols.set(key, value & 0xFFFF);
                };

                if (op === 'EQU' || op === 'SET') {
                    if (!st.label) throw new AsmError(`${op} needs a name`, lineNo);
                    const r = evaluate(tokenize(st.args, lineNo), ctx);
                    if (r.unknown && pass === 2) throw new AsmError(`undefined symbol in '${st.args}'`, lineNo);
                    if (!r.unknown) define(st.label, r.value, op === 'SET');
                    listing.push({ line: lineNo, addr: r.value, bytes: [], text: lines[n], equ: true });
                    continue;
                }
                if (st.label) define(st.label, pc, false);
                if (op === null) { listing.push({ line: lineNo, addr: pc, bytes: [], text: lines[n] }); continue; }
                if (IGNORED.has(op)) continue;

                const args = splitOperands(st.args);
                const reg = (a, table, what) => {
                    const v = table[(a || '').toUpperCase()];
                    if (v === undefined) throw new AsmError(`${what} expected, got '${a}'`, lineNo);
                    return v;
                };
                const count = k => { if (args.length !== k) throw new AsmError(`${op} takes ${k} operand(s)`, lineNo); };

                if (op === 'ORG') { pc = expr(st.args, true); listing.push({ line: lineNo, addr: pc, bytes: [], text: lines[n] }); continue; }
                else if (op === 'DS' || op === 'DEFS') { pc = (pc + expr(args[0], true)) & 0xFFFF; listing.push({ line: lineNo, addr: start, bytes: [], text: lines[n] }); continue; }
                else if (op === 'DB' || op === 'DEFB' || op === 'DEFM') {
                    for (const a of args) {
                        const s = /^(['"])(.*)\1$/.exec(a);
                        if (s && s[2].length !== 1) {
                            const q = s[1];
                            for (const ch of s[2].split(q + q).join(q)) emit8(ch.charCodeAt(0));
                        } else emit8(expr(a));
                    }
                }
                else if (op === 'DW' || op === 'DEFW') { for (const a of args) emit16(expr(a)); }
                else if (IMPLIED[op] !== undefined) { count(0); emit8(IMPLIED[op]); }
                else if (ALU_REG[op] !== undefined) { count(1); emit8(ALU_REG[op] | reg(args[0], REG, 'register')); }
                else if (ALU_IMM[op] !== undefined) { count(1); emit8(ALU_IMM[op]); emit8(expr(args[0])); }
                else if (ADDR16[op] !== undefined) { count(1); emit8(ADDR16[op]); emit16(expr(args[0])); }
                else if (op === 'MOV') {
                    count(2);
                    const d = reg(args[0], REG, 'register'), s = reg(args[1], REG, 'register');
                    if (d === 6 && s === 6) throw new AsmError('MOV M,M is not an instruction', lineNo);
                    emit8(0x40 | (d << 3) | s);
                }
                else if (op === 'MVI') { count(2); emit8(0x06 | (reg(args[0], REG, 'register') << 3)); emit8(expr(args[1])); }
                else if (op === 'INR') { count(1); emit8(0x04 | (reg(args[0], REG, 'register') << 3)); }
                else if (op === 'DCR') { count(1); emit8(0x05 | (reg(args[0], REG, 'register') << 3)); }
                else if (op === 'LXI') { count(2); emit8(0x01 | (reg(args[0], RP, 'register pair') << 4)); emit16(expr(args[1])); }
                else if (op === 'DAD') { count(1); emit8(0x09 | (reg(args[0], RP, 'register pair') << 4)); }
                else if (op === 'INX') { count(1); emit8(0x03 | (reg(args[0], RP, 'register pair') << 4)); }
                else if (op === 'DCX') { count(1); emit8(0x0B | (reg(args[0], RP, 'register pair') << 4)); }
                else if (op === 'PUSH') { count(1); emit8(0xC5 | (reg(args[0], RPPSW, 'register pair') << 4)); }
                else if (op === 'POP') { count(1); emit8(0xC1 | (reg(args[0], RPPSW, 'register pair') << 4)); }
                else if (op === 'LDAX' || op === 'STAX') {
                    count(1);
                    const rp = reg(args[0], { B: 0, D: 1 }, 'B or D');
                    emit8((op === 'LDAX' ? 0x0A : 0x02) | (rp << 4));
                }
                else if (op === 'RST') {
                    count(1);
                    const v = expr(args[0], true);
                    if (v > 7) throw new AsmError('RST takes 0 to 7', lineNo);
                    emit8(0xC7 | (v << 3));
                }
                else if (op === 'IN') { count(1); emit8(0xDB); emit8(expr(args[0])); }
                else if (op === 'OUT') { count(1); emit8(0xD3); emit8(expr(args[0])); }
                else throw new AsmError(`unknown instruction '${op}'`, lineNo);

                for (let i = 0; i < bytes.length; i++) memory.set((start + i) & 0xFFFF, bytes[i]);
                pc = (pc + bytes.length) & 0xFFFF;
                listing.push({ line: lineNo, addr: start, bytes, text: lines[n] });
            }
            if (cond.length) throw new AsmError('IF without ENDIF');
            symbols = passSymbols;
        }

        let low = 0xFFFF, high = -1;
        for (const a of memory.keys()) { if (a < low) low = a; if (a > high) high = a; }
        return {
            memory, symbols, listing,
            low: high < 0 ? 0 : low,
            high: high < 0 ? -1 : high,
            /** Bytes from lo to hi inclusive; gaps filled with `fill`. */
            image(lo = low, hi = high, fill = 0) {
                const out = new Uint8Array(hi - lo + 1).fill(fill);
                for (const [a, v] of memory) if (a >= lo && a <= hi) out[a - lo] = v;
                return out;
            }
        };
    }

    /** A printable listing: address, bytes, source. */
    function formatListing(result) {
        const hex = (v, w) => v.toString(16).toUpperCase().padStart(w, '0');
        return result.listing.map(l => {
            const b = l.bytes.slice(0, 4).map(x => hex(x, 2)).join(' ');
            const addr = l.equ ? '=' + hex(l.addr, 4) : hex(l.addr, 4) + ' ';
            return `${addr} ${b.padEnd(12)}${l.text}`;
        }).join('\n');
    }

    const api = { assemble, formatListing, AsmError };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else (root.DigitalRerun = root.DigitalRerun || {}).Asm8080 = api;
})(typeof window !== 'undefined' ? window : globalThis);
