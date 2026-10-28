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

    class Console {
        constructor() {
            this.queue = [];
            /** Called with each byte the CPU writes. */
            this.output = null;
            /** Status reads that found no key since the last key or output: a polling loop. */
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
            this.idlePolls++;
            return 0x00;
        }

        read() {
            this.idlePolls = 0;
            return this.queue.length ? this.queue.shift() : 0x00;
        }

        write(byte) {
            this.idlePolls = 0;
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
