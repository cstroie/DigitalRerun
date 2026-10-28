/*
 * fx80.js: an Epson FX-80 dot matrix printer.
 *
 * FX80 interprets the bytes CP/M sends to LST: and strikes dots on a
 * continuous strip of fanfold paper: x is inches from the left edge of the
 * printable width (8"), y inches from the top of the first sheet. A sink
 * receives the dots: PaperView draws them on page canvases; tests count them.
 *
 * Supported (FX-80 manual names):
 *   CR LF FF BS HT VT, SO DC4 (enlarged for one line), SI DC2 (condensed),
 *   CAN (cancel line), DEL, BEL (ignored)
 *   ESC E F   emphasized        ESC G H   double-strike
 *   ESC 4 5   italic            ESC - n   underline
 *   ESC W n   enlarged          ESC S n / ESC T   super/subscript
 *   ESC M P   elite / pica      ESC ! n   master select
 *   ESC 0 1 2 / ESC 3 n / ESC A n   line spacing   ESC J n   feed n/216"
 *   ESC C n / ESC C 0 n   form length   ESC N n / ESC O   skip perforation
 *   ESC D ... 0   tabs          ESC l n / ESC Q n   left / right margin
 *   ESC K L Y Z n1 n2 data, ESC * m n1 n2 data   bit image
 *   ESC @     reset; codes 80h-FFh print in italics, as on the FX-80
 * Recognised and skipped with their parameters: ESC R, U, <, 8, 9, 7, 6,
 * ESC ? (reassign graphics), ESC & / ESC % / ESC : (download characters),
 * ESC B (vertical tabs: VT then acts as LF), ESC i, ESC s, ESC p.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const FONT9 = node ? require('./font9.js').FONT9 : root.JSCPM.FONT9;

    const PIN = 1 / 72;              // vertical distance between pins
    const PAPER_WIDTH = 8.0;         // printable width, inches (80 columns pica)
    const DENSITY = { 0: 60, 1: 120, 2: 120, 3: 240, 4: 80, 5: 72, 6: 90 };
    const TOP = 1 / 3;               // first line below the top of form

    class FX80 {
        /** `sink` gets dot(x, y) and feed(y) (paper moved to y). */
        constructor(sink = null) {
            this.sink = sink;
            this.y = TOP;
            this.reset();
        }

        reset() {
            this.lineSpacing = 1 / 6;
            this.pageLength = 11;
            this.skip = 0;                       // lines skipped over the perforation
            this.leftMargin = 0;                 // in columns
            this.rightMargin = 80;               // in columns
            this.pitch = 10;                     // characters per inch: 10 pica, 12 elite
            this.condensed = false;
            this.enlarged = false;               // ESC W
            this.enlargedLine = false;           // SO: until the line ends
            this.emphasized = false;
            this.double = false;
            this.italic = false;
            this.underline = false;
            this.script = 0;                     // 0 none, 1 super, 2 sub
            this.tabs = [];
            for (let c = 8; c < 80; c += 8) this.tabs.push(c);
            this.vtabs = false;
            this.x = 0;
            this.esc = null;                     // escape sequence being read
            this.dots = 0;
        }

        /* --- geometry --- */

        get columnWidth() {                      // width of one column for margins and tabs
            return 1 / (this.condensed ? 17.16 : this.pitch);
        }

        get charWidth() {
            return this.columnWidth * (this.enlarged || this.enlargedLine ? 2 : 1);
        }

        get pageTop() {                          // top of the sheet the head is on
            return Math.floor(this.y / this.pageLength) * this.pageLength;
        }

        strike(x, y) {
            this.dots++;
            if (this.sink) this.sink.dot(x, y);
        }

        /* --- input --- */

        write(byte) {
            if (this.esc) return this.escByte(byte);
            const b = byte & 0xFF;
            const low = b & 0x7F;
            if (low < 0x20) return this.control(low);
            if (b === 0x7F) return;
            if (b === 0xFF) return;
            this.printChar(low, b >= 0x80);
        }

        writeString(s) {
            for (const ch of s) this.write(ch.charCodeAt(0));
        }

        control(c) {
            switch (c) {
                case 0x0D: this.carriageReturn(); break;
                case 0x0A: this.lineFeed(); break;
                case 0x0B: if (this.vtabs) this.lineFeed(); else this.lineFeed(); break;
                case 0x0C: this.formFeed(); break;
                case 0x08: this.x = Math.max(this.leftMargin * this.columnWidth, this.x - this.charWidth); break;
                case 0x09: this.tab(); break;
                case 0x0E: this.enlargedLine = true; break;          // SO
                case 0x14: this.enlargedLine = false; break;         // DC4
                case 0x0F: this.condensed = true; break;             // SI
                case 0x12: this.condensed = false; break;            // DC2
                case 0x18: this.x = this.leftMargin * this.columnWidth; break;   // CAN
                case 0x1B: this.esc = { cmd: null, args: [] }; break;
                // BEL, NUL and the rest: nothing
            }
        }

        carriageReturn() {
            this.x = this.leftMargin * this.columnWidth;
        }

        feed(dy) {
            this.y += dy;
            const bottom = this.pageTop + this.pageLength - this.skip * this.lineSpacing;
            if (this.skip && this.y > bottom - 1e-9) this.y = this.pageTop + this.pageLength + TOP;
            if (this.sink && this.sink.feed) this.sink.feed(this.y);
        }

        lineFeed() {
            this.enlargedLine = false;
            this.feed(this.lineSpacing);
        }

        formFeed() {
            this.enlargedLine = false;
            this.x = this.leftMargin * this.columnWidth;
            this.y = this.pageTop + this.pageLength + TOP;
            if (this.sink && this.sink.feed) this.sink.feed(this.y);
        }

        /** Start on a fresh sheet (the paper was torn off). */
        tearOff() {
            this.y = this.pageTop + this.pageLength + TOP;
            this.x = this.leftMargin * this.columnWidth;
        }

        tab() {
            const col = Math.round(this.x / this.columnWidth + 1e-6);
            const next = this.tabs.find(t => t > col);
            if (next === undefined) return;
            this.x = Math.min(next, this.rightMargin) * this.columnWidth;
        }

        printChar(code, italic) {
            const w = this.charWidth;
            const right = Math.min(this.rightMargin * this.columnWidth, PAPER_WIDTH);
            if (this.x + w > right + 1e-6) {             // the line is full: print it, go on below
                this.carriageReturn();
                this.lineFeed();
            }
            const glyph = FONT9[code - 0x20];
            const colPitch = w / 6;                      // 5 dot columns plus a space
            const slant = this.italic || italic;
            let rowPitch = PIN, y0 = this.y;
            if (this.script) {                           // half height, top or bottom half
                rowPitch = PIN / 2;
                if (this.script === 2) y0 += 3.5 * PIN;
            }
            const passes = (this.double || this.script ? [0, 1 / 216] : [0]);
            for (const dy of passes) {
                for (let r = 0; r < 9; r++) {
                    const bits = glyph[r];
                    if (!bits) continue;
                    const shear = slant ? (6 - r) * colPitch * 0.3 : 0;
                    for (let c = 0; c < 5; c++) {
                        if (!(bits & (0x10 >> c))) continue;
                        const x = this.x + (c + 0.5) * colPitch + shear;
                        const y = y0 + r * rowPitch + dy;
                        this.strike(x, y);
                        if (this.emphasized) this.strike(x + colPitch / 2, y);
                        if (this.enlarged || this.enlargedLine) this.strike(x + colPitch / 2, y);
                    }
                }
            }
            if (this.underline) {
                const y = this.y + 9 * PIN;
                for (let u = 0; u < 12; u++) this.strike(this.x + (u + 0.5) * w / 12, y);
            }
            this.x += w;
        }

        bitImage(dpi, data) {
            const step = 1 / dpi;
            for (let i = 0; i < data.length; i++) {
                const b = data[i];
                if (this.x > PAPER_WIDTH) break;
                for (let p = 0; p < 8; p++) if (b & (0x80 >> p)) this.strike(this.x, this.y + p * PIN);
                this.x += step;
            }
        }

        /* --- escape sequences --- */

        escByte(byte) {
            const e = this.esc;
            if (e.cmd === null) {
                e.cmd = byte;
                e.need = this.argCount(byte, []);
                if (e.need === 0) return this.escDone();
                return;
            }
            e.args.push(byte);
            if (e.need === 'zero') {                    // ESC D / ESC B: until a 0 or a decrease
                if (byte === 0 || e.args.length > 32) return this.escDone();
                return;
            }
            const need = this.argCount(e.cmd, e.args);
            if (e.args.length >= need) this.escDone();
        }

        /** Parameter bytes the command takes, knowing the ones read so far. */
        argCount(cmd, args) {
            const c = String.fromCharCode(cmd);
            const count = (a, b) => (args.length >= 2 ? args[a] | (args[b] << 8) : Infinity);
            switch (c) {
                case 'E': case 'F': case 'G': case 'H': case '4': case '5': case 'T': case 'M': case 'P':
                case '0': case '1': case '2': case '@': case 'O': case '<': case '8': case '9': case '7': case '6':
                case '\x0e': case '\x0f': case 'm':
                    return 0;
                case '-': case 'W': case 'S': case '3': case 'A': case 'J': case 'N': case 'l': case 'Q':
                case '!': case 'R': case 'U': case 'i': case 's': case 'p': case '>': case '=':
                    return 1;
                case 'C': return args.length >= 1 && args[0] === 0 ? 2 : 1;
                case '?': return 2;
                case 'K': case 'L': case 'Y': case 'Z': return args.length < 2 ? 2 : 2 + count(0, 1);
                case '*': return args.length < 3 ? 3 : 3 + (args[1] | (args[2] << 8));
                case '^': return args.length < 3 ? 3 : 3 + 2 * (args[1] | (args[2] << 8));
                case 'D': case 'B': return 'zero';
                case ':': return 3;
                case '%': return 2;
                case '&': {                                       // ESC & 0 n m, then 12 bytes a character
                    if (args.length < 3) return 3;
                    return 3 + (Math.max(0, args[2] - args[1] + 1)) * 12;
                }
                default: return 0;
            }
        }

        escDone() {
            const { cmd, args } = this.esc;
            this.esc = null;
            const c = String.fromCharCode(cmd);
            const on = v => (v & 1) === 1;                      // 1 or '1'
            switch (c) {
                case 'E': this.emphasized = true; break;
                case 'F': this.emphasized = false; break;
                case 'G': this.double = true; break;
                case 'H': this.double = false; break;
                case '4': this.italic = true; break;
                case '5': this.italic = false; break;
                case '-': this.underline = on(args[0]); break;
                case 'W': this.enlarged = on(args[0]); break;
                case 'S': this.script = on(args[0]) ? 2 : 1; break;
                case 'T': this.script = 0; break;
                case 'M': this.pitch = 12; break;
                case 'P': this.pitch = 10; break;
                case '\x0e': this.enlargedLine = true; break;
                case '\x0f': this.condensed = true; break;
                case '!': {
                    const n = args[0];
                    this.pitch = n & 1 ? 12 : 10;
                    this.condensed = !!(n & 4) && !(n & 1);
                    this.emphasized = !!(n & 8);
                    this.double = !!(n & 16);
                    this.enlarged = !!(n & 32);
                    this.italic = !!(n & 64);
                    this.underline = !!(n & 128);
                    break;
                }
                case '0': this.lineSpacing = 1 / 8; break;
                case '1': this.lineSpacing = 7 / 72; break;
                case '2': this.lineSpacing = 1 / 6; break;
                case '3': this.lineSpacing = args[0] / 216; break;
                case 'A': this.lineSpacing = (args[0] & 0x7F) / 72; break;
                case 'J': this.feed(args[0] / 216); break;
                case 'C': this.pageLength = args[0] === 0 ? Math.max(1, args[1]) : Math.max(1, args[0]) * this.lineSpacing; break;
                case 'N': this.skip = args[0]; break;
                case 'O': this.skip = 0; break;
                case 'l': this.leftMargin = Math.min(args[0], this.rightMargin - 1); break;
                case 'Q': this.rightMargin = Math.max(args[0], this.leftMargin + 1); break;
                case 'D': {
                    this.tabs = [];
                    for (const t of args) { if (t === 0 || (this.tabs.length && t <= this.tabs[this.tabs.length - 1])) break; this.tabs.push(t); }
                    break;
                }
                case 'B': this.vtabs = args.length > 1; break;
                case 'K': this.bitImage(60, args.slice(2)); break;
                case 'L': this.bitImage(120, args.slice(2)); break;
                case 'Y': this.bitImage(120, args.slice(2)); break;
                case 'Z': this.bitImage(240, args.slice(2)); break;
                case '*': this.bitImage(DENSITY[args[0]] || 60, args.slice(3)); break;
                case '@': {
                    const y = this.y;
                    this.reset();
                    this.y = y;
                    break;
                }
                // everything else was read with its parameters and is ignored
            }
        }
    }

    /**
     * Fanfold paper in the page: one canvas per sheet, made as the paper
     * comes out. 9.5" wide with tractor strips; the printable 8" starts
     * 0.75" from the left edge.
     */
    class PaperView {
        constructor(element, { dpi = 120, pageLength = 11 } = {}) {
            this.el = element;
            this.dpi = dpi;
            this.pageLength = pageLength;
            this.sheets = [];
            this.first = 0;         // sheet index of the first canvas (after a tear-off)
            this.onChange = null;
        }

        sheet(i) {
            while (this.first + this.sheets.length <= i) this.addSheet();
            return this.sheets[i - this.first];
        }

        addSheet() {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(9.5 * this.dpi);
            canvas.height = Math.round(this.pageLength * this.dpi);
            canvas.className = 'sheet';
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fbfaf4';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // tractor strips: holes every 1/2", a perforated line inside them
            ctx.fillStyle = '#d9d6c8';
            for (let y = 0.25; y < this.pageLength; y += 0.5) {
                for (const x of [0.25, 9.25]) {
                    ctx.beginPath();
                    ctx.arc(x * this.dpi, y * this.dpi, 0.075 * this.dpi, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.strokeStyle = '#e4e1d4';
            ctx.setLineDash([2, 3]);
            for (const x of [0.5, 9.0]) {
                ctx.beginPath();
                ctx.moveTo(x * this.dpi, 0);
                ctx.lineTo(x * this.dpi, canvas.height);
                ctx.stroke();
            }
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(28, 30, 40, 0.86)';
            this.el.appendChild(canvas);
            this.sheets.push({ canvas, ctx, used: false });
            if (this.onChange) this.onChange();
        }

        dot(x, y) {
            const i = Math.floor(y / this.pageLength);
            if (i < this.first) return;
            const s = this.sheet(i);
            const r = Math.max(0.9, 0.0072 * this.dpi);
            s.ctx.beginPath();
            s.ctx.arc((x + 0.75) * this.dpi, (y - i * this.pageLength) * this.dpi, r, 0, Math.PI * 2);
            s.ctx.fill();
            s.used = true;
        }

        feed(y) {
            this.sheet(Math.floor(y / this.pageLength));
            this.lastY = y;
        }

        /** Remove every sheet before `nextY` (the printer moves on to `nextY`). */
        clear(nextY = 0) {
            for (const s of this.sheets) s.canvas.remove();
            this.sheets = [];
            this.first = Math.floor(nextY / this.pageLength);
            if (this.onChange) this.onChange();
        }

        /** Sheets with ink on them. */
        printed() {
            return this.sheets.filter(s => s.used).map(s => s.canvas);
        }
    }

    const api = { FX80, PaperView };
    if (node) module.exports = api;
    else Object.assign(root.JSCPM = root.JSCPM || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
