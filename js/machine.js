/*
 * machine.js: a Z80 with 64K of RAM, a console, a printer and a disk
 * controller on I/O ports.
 *
 * Reset works like z80pack's: the "boot ROM" reads sector 1 of track 0 of
 * drive A: into 0000h and starts the CPU there. That sector is the loader
 * written on the disk, which brings in CCP, BDOS and BIOS from the system
 * tracks and jumps to the BIOS. Nothing about CP/M is built in here: change
 * the system tracks and you change the system.
 */
(function (root) {
    'use strict';

    const node = typeof module !== 'undefined' && module.exports;
    const Z80 = node ? require('./z80.js') : root.DigitalRerun.Z80;
    const { FDC } = node ? require('./devices/fdc.js') : root.DigitalRerun;
    const { Console, PrinterPort } = node ? require('./devices/serial.js') : root.DigitalRerun;

    class Machine {
        constructor() {
            this.memory = new Uint8Array(65536);
            this.console = new Console();
            this.printer = new PrinterPort();
            this.fdc = new FDC(this.memory);
            this.cycles = 0;
            /** 'stopped' | 'running' | 'halted' */
            this.state = 'stopped';
            const mem = this.memory;
            this.cpu = new Z80({
                mem_read: a => mem[a],
                mem_write: (a, v) => { mem[a] = v; },
                io_read: port => this.input(port & 0xFF),
                io_write: (port, v) => this.output(port & 0xFF, v)
            });
        }

        input(port) {
            switch (port) {
                case 0: return this.console.status();
                case 1: return this.console.read();
                case 2: return this.printer.status();
                case 10: case 14: return this.fdc.in(port);
                default: return 0xFF;
            }
        }

        output(port, value) {
            switch (port) {
                case 1: this.console.write(value); break;
                case 3: this.printer.write(value); break;
                case 10: case 11: case 12: case 13: case 15: case 16: case 17:
                    this.fdc.out(port, value);
                    break;
            }
        }

        /** Clear RAM, load the boot sector of A: and start at 0000h. */
        reset() {
            this.memory.fill(0);
            this.cpu.reset();
            this.cycles = 0;
            const fdc = this.fdc;
            Object.assign(fdc, { drive: 0, track: 0, sector: 1, dma: 0x0000 });
            const status = fdc.command(0);
            if (status !== 0) {
                this.state = 'stopped';
                return false;
            }
            fdc.dma = 0x80;
            this.state = 'running';
            return true;
        }

        get halted() {
            return this.cpu.getState().halted;
        }

        /**
         * Run for about `budget` T-states. Returns the T-states used. Stops
         * early when the program sits waiting for a key (so an idle machine
         * costs nothing) or on HALT.
         */
        run(budget) {
            if (this.state !== 'running') return 0;
            const cpu = this.cpu;
            const con = this.console;
            let used = 0;
            con.idlePolls = 0;
            while (used < budget) {
                used += cpu.run_instruction();
                if (con.idlePolls > 64) break;
            }
            this.cycles += used;
            if (this.halted) this.state = 'halted';
            return used;
        }
    }

    const api = { Machine };
    if (node) module.exports = api;
    else Object.assign(root.DigitalRerun = root.DigitalRerun || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
