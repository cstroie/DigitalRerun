/*
 * serial.js: the console and the printer ports.
 *
 *   IN  0   console status: 0FFh when a key is waiting, else 0
 *   IN  1   console data: the next key
 *   OUT 1   console data: a character to the terminal
 *   IN  2   printer status: 0FFh when ready, 0 when off line
 *   OUT 3   printer data: a byte to the printer
 */
(function (root) {
    'use strict';

    const PASTE_WAIT = 16;

    class Console {
        constructor() {
            this.queue = [];
            /** Called with each byte the CPU writes. */
            this.output = null;
            /** Status reads that found no key since the last key or output: a polling loop. */
            this.idlePolls = 0;
            /** Pasted text, waiting to be typed one key at a time. */
            this.pending = [];
            this.waits = 0;
        }

        /**
         * Type text at a careful typist's pace: each key is offered only once
         * the program has asked for one PASTE_WAIT times in a row with nothing
         * printed in between, that is when it really waits for a key. The
         * BDOS looks for ^S each time it prints a character and keeps a key
         * it finds there; a program that reads the keyboard another way then
         * loses it. Waiting for quiet means no key is there to be taken.
         */
        paste(keys) {
            for (const ch of keys) this.pending.push(ch.charCodeAt(0) & 0xFF);
            this.idlePolls = 0;
        }

        /** Queue keys: a string or an array of byte values. */
        type(keys) {
            if (typeof keys === 'string') {
                for (const ch of keys) this.queue.push(ch.charCodeAt(0) & 0xFF);
            } else this.queue.push(...keys);
            this.idlePolls = 0;
        }

        status() {
            if (this.queue.length) return 0xFF;
            if (this.pending.length) {                 // a paste is under way: not idle
                if (++this.waits >= PASTE_WAIT) { this.waits = 0; this.queue.push(this.pending.shift()); }
                return 0x00;
            }
            this.idlePolls++;
            return 0x00;
        }

        read() {
            this.idlePolls = 0;
            return this.queue.length ? this.queue.shift() : 0x00;
        }

        write(byte) {
            this.idlePolls = 0;
            this.waits = 0;
            if (this.output) this.output(byte & 0x7F);
        }
    }

    class PrinterPort {
        constructor() {
            this.online = true;
            /** Called with each byte the CPU prints. */
            this.output = null;
        }

        status() { return this.online ? 0xFF : 0x00; }

        write(byte) {
            if (this.output) this.output(byte);
        }
    }

    const api = { Console, PrinterPort };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
