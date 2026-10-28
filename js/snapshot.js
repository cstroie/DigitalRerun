/*
 * snapshot.js: the whole machine at one moment, to come back to later.
 *
 * A snapshot holds the CPU, RAM, the disk controller, a copy of every
 * mounted disk (so RAM and disks agree), the terminal screen and the
 * printer head. Printed paper is not part of it. Snapshots are plain
 * data with typed arrays: IndexedDB stores them as they are.
 */
(function (root) {
    'use strict';

    const FORMAT = 1;

    /** The last line of the screen with text on it: a preview for lists. */
    function preview(terminal) {
        const lines = terminal.text().split('\n').map(l => l.trim()).filter(Boolean);
        return (lines[lines.length - 1] || '').slice(0, 60);
    }

    function take({ machine, terminal, printer }, { kind = 'manual', version = '' } = {}) {
        return {
            format: FORMAT,
            kind,
            time: Date.now(),
            version,
            preview: preview(terminal),
            machine: machine.getState(),
            terminal: terminal.getState(),
            printer: printer.getState()
        };
    }

    function restore(snap, { machine, terminal, printer }) {
        if (!snap || snap.format !== FORMAT) throw new Error('this snapshot is from another version of the app');
        machine.setState(snap.machine);
        terminal.setState(snap.terminal);
        printer.setState(snap.printer);
    }

    /** Bytes a snapshot takes, roughly (RAM and disks). */
    function size(snap) {
        return snap.machine.memory.length + snap.machine.drives.reduce((n, d) => n + d.data.length, 0);
    }

    const api = { take, restore, size, preview, FORMAT };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else (root.DigitalRerun = root.DigitalRerun || {}).Snapshot = api;
})(typeof window !== 'undefined' ? window : globalThis);
