/*
 * app.js: the page. Builds the machine, connects the terminal, the
 * printer and the drives, runs the CPU in animation-frame slices, and
 * keeps the disks in IndexedDB.
 */
(function () {
    'use strict';

    const { Machine, Disk, CpmFs, Terminal, TerminalView, FX80, PaperView, Storage,
        isTextName, toCpmText, fromCpmText } = window.DigitalRerun;

    const $ = id => document.getElementById(id);
    const DRIVES = [0, 1, 2, 3, 8];                 // A: B: C: D: I:
    const LETTER = d => String.fromCharCode(65 + d);
    const FLOPPY = 'sssd8', HARD = 'hd4mb';
    const formatFor = d => (d === 8 ? HARD : FLOPPY);

    const machine = new Machine();
    const term = new Terminal(80, 24);
    const view = new TerminalView(term, $('screen'));
    const paper = new PaperView($('paper'));
    const printer = new FX80(paper);

    machine.console.output = b => term.write(b);
    term.reply = bytes => machine.console.type(bytes);
    term.bell = () => { $('crt').animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], 120); };
    machine.printer.output = b => {
        printer.write(b);
        leds.prn = performance.now();
        paperOut();
    };

    /* ---------- settings ---------- */

    const settings = { speed: 4, arrows: 'wordstar', phosphor: 'green', tab: 'drives', resume: true };

    function applySettings() {
        $('speed').value = String(settings.speed);
        $('arrows').value = settings.arrows;
        $('phosphor').value = settings.phosphor;
        $('resume').checked = settings.resume;
        $('crt').classList.toggle('amber', settings.phosphor === 'amber');
        $('crt').classList.toggle('white', settings.phosphor === 'white');
    }

    /* ---------- tabs (phones: one panel at a time) ---------- */

    const phone = matchMedia('(max-width: 900px)');
    let unseen = 0;

    function showTab(name) {
        settings.tab = name;
        for (const b of document.querySelectorAll('#tabs [data-for]')) b.setAttribute('aria-selected', String(b.dataset.for === name));
        for (const el of document.querySelectorAll('[data-tab]')) el.classList.toggle('active', el.dataset.tab === name);
        if (name === 'paper') { unseen = 0; $('paper-badge').hidden = true; }
    }

    $('tabs').addEventListener('click', e => {
        const b = e.target.closest('[data-for]');
        if (!b) return;
        showTab(b.dataset.for);
        Storage.set('settings', settings).catch(() => {});
    });

    /** Paper came out of the printer: show the tray, count new sheets on the PAPER tab. */
    function paperOut() {
        const tray = $('tray');
        if (tray.hidden || !tray.classList.contains('printed')) {
            tray.hidden = false;
            tray.classList.add('printed');
        }
        if (phone.matches && settings.tab !== 'paper') {
            const sheets = paper.printed().length || 1;
            if (sheets !== unseen) { unseen = sheets; $('paper-badge').textContent = sheets; $('paper-badge').hidden = false; }
        }
    }

    for (const key of ['speed', 'arrows', 'phosphor']) {
        $(key).addEventListener('change', () => {
            settings[key] = key === 'speed' ? Number($(key).value) : $(key).value;
            applySettings();
            Storage.set('settings', settings).catch(() => {});
            focusScreen();
        });
    }

    /* ---------- LEDs ---------- */

    const leds = { disk: {}, prn: 0, busy: false };
    machine.fdc.onActivity = drive => { leds.disk[drive] = performance.now(); };

    function updateLeds(now) {
        for (const d of DRIVES) {
            const on = now - (leds.disk[d] || 0) < 90;
            $('led-' + d).classList.toggle('on', on);
            const small = document.querySelector(`.drive[data-drive="${d}"] .led`);
            if (small) small.classList.toggle('on', on);
        }
        $('led-prn').classList.toggle('on', now - leds.prn < 90);
        const running = machine.state === 'running';
        $('led-run').classList.toggle('on', running && leds.busy);
        $('led-run').classList.toggle('idle', running && !leds.busy);
    }

    /* ---------- drives ---------- */

    let selected = 0;
    const saveTimers = {};

    function persist(drive) {
        clearTimeout(saveTimers[drive]);
        saveTimers[drive] = setTimeout(() => {
            const disk = machine.fdc.drives[drive];
            if (disk) Storage.saveDisk(drive, disk).then(() => { disk.dirty = false; }).catch(() => {});
        }, 700);
    }
    machine.fdc.onWrite = drive => persist(drive);

    function mount(drive, disk, save = true) {
        machine.fdc.mount(drive, disk);
        if (save) persist(drive);
        renderDrives();
    }

    function eject(drive) {
        machine.fdc.eject(drive);
        Storage.removeDisk(drive).catch(() => {});
        renderDrives();
    }

    function download(name, bytes, type = 'application/octet-stream') {
        const url = URL.createObjectURL(new Blob([bytes], { type }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function note(text, ok = true) {
        const el = $('drive-note');
        el.textContent = text;
        el.style.color = ok ? '' : 'var(--err)';
        clearTimeout(note.timer);
        note.timer = setTimeout(() => { el.textContent = ''; }, 4000);
    }

    function pickFile(input, accept) {
        return new Promise(resolve => {
            input.accept = accept || '';
            input.value = '';
            input.onchange = () => resolve([...input.files]);
            input.click();
        });
    }

    async function loadImage(drive) {
        const [file] = await pickFile($('fileInput'), '.dsk,.img,.bin');
        if (!file) return;
        try {
            const disk = Disk.fromImage(new Uint8Array(await file.arrayBuffer()), { name: file.name });
            if (disk.format !== formatFor(drive)) throw new Error(`${LETTER(drive)}: takes ${drive === 8 ? 'a 4 MB hard disk' : 'an 8" disk (256256 bytes)'}`);
            mount(drive, disk);
            note(`${file.name} in ${LETTER(drive)}:`);
        } catch (e) { note(e.message, false); }
    }

    /** Write a system tracks image (loader + CCP + BDOS + BIOS, like system/cpm22.bin) onto a floppy. */
    async function writeSystem(drive) {
        const [file] = await pickFile($('fileInput'), '.bin,.sys,.img');
        if (!file) return;
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            new CpmFs(machine.fdc.drives[drive]).writeSystem(bytes);
            persist(drive);
            note(`system written to ${LETTER(drive)}:${drive === 0 ? ' press RESET' : ''}`);
        } catch (e) { note(e.message, false); }
    }

    async function newDisk(drive) {
        const disk = new Disk(formatFor(drive), null, { name: drive === 8 ? 'hard disk' : 'blank' });
        if (drive !== 8 && machine.fdc.drives[0]) {
            // make it bootable: a copy of A:'s system tracks
            new CpmFs(disk).writeSystem(new CpmFs(machine.fdc.drives[0]).readSystem());
        }
        mount(drive, disk);
        note(`new disk in ${LETTER(drive)}:`);
    }

    async function shippedDisk(file, name) {
        const res = await fetch(file);
        if (!res.ok) throw new Error(`${file}: ${res.status}`);
        return new Disk(FLOPPY, new Uint8Array(await res.arrayBuffer()), { name });
    }

    const systemDisk = () => shippedDisk('disks/cpm22.dsk', 'CP/M 2.2');

    function renderDrives() {
        const box = $('drives');
        box.textContent = '';
        for (const d of DRIVES) {
            const disk = machine.fdc.drives[d];
            const row = document.createElement('div');
            row.className = 'drive' + (d === selected ? ' sel' : '');
            row.dataset.drive = d;
            row.innerHTML = `<span class="led disk"><i></i></span><span class="letter">${LETTER(d)}:</span>` +
                `<span class="name${disk ? '' : ' empty'}"></span><span class="acts"></span>`;
            row.querySelector('.name').textContent = disk ? disk.name || '(disk)' : (d === 8 ? 'no hard disk' : 'empty');
            row.querySelector('.name').title = disk ? `${disk.name} (${d === 8 ? '4 MB' : '8" SSSD'})` : '';
            const acts = row.querySelector('.acts');
            const btn = (label, title, fn) => {
                const b = document.createElement('button');
                b.className = 'small';
                b.textContent = label;
                b.title = title;
                b.addEventListener('click', e => { e.stopPropagation(); fn(); });
                acts.appendChild(b);
            };
            btn('LOAD', 'Insert a disk image (.dsk)', () => loadImage(d));
            if (disk) {
                btn('SAVE', 'Download the disk image', () => download(`${(disk.name || LETTER(d)).replace(/[^\w.-]+/g, '_').replace(/\.dsk$/i, '')}.dsk`, disk.data));
                if (d !== 8) btn('SYS', 'Write a system tracks image (.bin, up to 6656 bytes: loader, CCP, BDOS, BIOS) onto this disk', () => writeSystem(d));
                btn('⏏', 'Eject', () => eject(d));
            } else btn('NEW', 'Insert a new, empty disk', () => newDisk(d));
            row.addEventListener('click', () => { selected = d; renderDrives(); });
            box.appendChild(row);
        }
        renderFiles();
    }

    function renderFiles() {
        const box = $('files');
        box.textContent = '';
        const disk = machine.fdc.drives[selected];
        if (!disk) return;
        let fsys;
        try { fsys = new CpmFs(disk); } catch (e) { return; }
        const files = fsys.list().sort((a, b) => a.user - b.user || a.name.localeCompare(b.name));
        for (const f of files) {
            const a = document.createElement('a');
            const user = f.user ? `${f.user}/` : '';
            a.innerHTML = `<span></span><small>${Math.ceil(f.size / 1024)}K</small>`;
            a.firstChild.textContent = user + f.name;
            a.title = `${f.name}, user ${f.user}, ${f.records} records${f.system ? ', SYS' : ''}${f.readOnly ? ', R/O' : ''}: click to download`;
            a.addEventListener('click', () => {
                const data = fsys.read(f.name, f.user);
                if (isTextName(f.name)) download(f.name, fromCpmText(data), 'text/plain');
                else download(f.name, data);
            });
            box.appendChild(a);
        }
        const free = document.createElement('div');
        free.className = 'free';
        free.textContent = `${files.length} file${files.length === 1 ? "" : "s"}, ${fsys.freeBytes() >> 10}K free on ${LETTER(selected)}:`;
        box.appendChild(free);
    }

    async function putFiles(fileList) {
        const disk = machine.fdc.drives[selected];
        if (!disk) { note(`no disk in ${LETTER(selected)}:`, false); return; }
        const fsys = new CpmFs(disk);
        let n = 0;
        for (const file of fileList) {
            try {
                let data = new Uint8Array(await file.arrayBuffer());
                if (isTextName(file.name)) data = toCpmText(data);
                fsys.write(file.name, data);
                n++;
            } catch (e) { note(e.message, false); }
        }
        if (n) {
            persist(selected);
            renderFiles();
            note(`${n} file${n > 1 ? 's' : ''} on ${LETTER(selected)}: press ^C`);
        }
    }

    $('addFilesBtn').addEventListener('click', async () => {
        const files = await pickFile($('filesInput'));
        if (files.length) putFiles(files);
    });

    const panel = $('drives-panel');
    panel.addEventListener('dragover', e => { e.preventDefault(); panel.classList.add('drop'); });
    panel.addEventListener('dragleave', () => panel.classList.remove('drop'));
    panel.addEventListener('drop', e => {
        e.preventDefault();
        panel.classList.remove('drop');
        if (e.dataTransfer.files.length) putFiles([...e.dataTransfer.files]);
    });

    /* ---------- keyboard ---------- */

    const kbd = $('kbd');
    const ARROWS = {
        wordstar: { ArrowUp: [5], ArrowDown: [24], ArrowLeft: [19], ArrowRight: [4], PageUp: [18], PageDown: [3], Home: [17, 83], End: [17, 68], Delete: [7], Insert: [22] },
        vt100: { ArrowUp: [27, 91, 65], ArrowDown: [27, 91, 66], ArrowRight: [27, 91, 67], ArrowLeft: [27, 91, 68], Delete: [127] }
    };

    function keyBytes(e) {
        if (e.metaKey) return null;
        const map = ARROWS[settings.arrows];
        if (map[e.key]) return map[e.key];
        if (e.ctrlKey && !e.altKey) {
            if (e.key.length === 1) {
                const c = e.key.toUpperCase().charCodeAt(0);
                if (c >= 64 && c <= 95) return [c & 0x1F];
                if (e.key === ' ' || e.key === '2') return [0];
            }
            return null;
        }
        switch (e.key) {
            case 'Enter': return [13];
            case 'Backspace': return [8];
            case 'Tab': return [9];
            case 'Escape': return [27];
            case 'Delete': return [127];
        }
        if (e.key.length === 1 && !e.ctrlKey) {
            const c = e.key.charCodeAt(0);
            return c < 128 ? [c] : null;
        }
        return null;
    }

    function focusScreen() { kbd.focus({ preventScroll: true }); }

    kbd.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && e.shiftKey) return;   // let paste happen
        const bytes = keyBytes(e);
        if (!bytes) return;
        e.preventDefault();
        machine.console.type(bytes);
        kick();
    });
    // Mobile keyboards send text through input events.
    kbd.addEventListener('input', () => {
        if (kbd.value) {
            machine.console.type(kbd.value.replace(/\n/g, '\r'));
            kbd.value = '';
            kick();
        }
    });
    kbd.addEventListener('paste', e => {
        e.preventDefault();
        typeText(e.clipboardData.getData('text'));
    });
    $('crt').addEventListener('mouseup', () => { if (!getSelection().toString()) focusScreen(); });
    $('crt').addEventListener('focus', focusScreen);

    function typeText(text) {
        machine.console.type(text.replace(/\r?\n/g, '\r').replace(/[^\x00-\x7f]/g, '?'));
        kick();
        focusScreen();
    }

    $('pasteBtn').addEventListener('click', async () => {
        try { typeText(await navigator.clipboard.readText()); } catch (e) { focusScreen(); }
    });

    /* ---------- printer panel ---------- */

    $('onlineBtn').addEventListener('click', () => {
        machine.printer.online = !machine.printer.online;
        $('onlineBtn').classList.toggle('on', machine.printer.online);
        $('onlineBtn').textContent = machine.printer.online ? 'ON LINE' : 'OFF LINE';
    });
    $('ffBtn').addEventListener('click', () => { printer.formFeed(); paperOut(); });
    $('tearBtn').addEventListener('click', () => {
        printer.tearOff();
        paper.clear(printer.y);
        $('tray').hidden = true;
        $('tray').classList.remove('printed');
        unseen = 0;
        $('paper-badge').hidden = true;
    });
    $('pngBtn').addEventListener('click', () => {
        paper.printed().forEach((c, i) => c.toBlob(b => download(`digitalrerun-page-${i + 1}.png`, b, 'image/png')));
    });
    $('printBtn').addEventListener('click', () => window.print());

    /* ---------- running ---------- */

    let last = 0, raf = 0, rate = { t: 0, cycles: 0 };

    function frame(now) {
        raf = 0;
        const dt = Math.min(50, last ? now - last : 16);
        last = now;
        if (machine.state === 'running') {
            const before = machine.cycles;
            if (settings.speed > 0) {
                machine.run(settings.speed * 1000 * dt);
            } else {
                const until = performance.now() + 12;
                while (performance.now() < until && machine.state === 'running') {
                    machine.run(200000);
                    if (machine.console.idlePolls > 64) break;
                }
            }
            leds.busy = machine.console.idlePolls <= 64;
            rate.cycles += machine.cycles - before;
        }
        if (now - rate.t > 500) {
            const mhz = rate.cycles / ((now - rate.t) * 1000);
            $('mhz').textContent = machine.state === 'halted' ? 'HALT' : leds.busy ? `${mhz.toFixed(1)} MHz` : 'idle';
            rate = { t: now, cycles: 0 };
        }
        view.render();
        updateLeds(now);
        raf = requestAnimationFrame(frame);
    }

    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    function coldStart() {
        term.reset();
        if (!machine.fdc.drives[0]) {
            term.writeString('\r\nNo disk in A:. Insert one in DRIVES and press RESET.\r\n');
            machine.state = 'stopped';
            return;
        }
        if (!machine.reset()) term.writeString('\r\nA: does not read. Press RESET to try again.\r\n');
        focusScreen();
    }

    $('resetBtn').addEventListener('click', coldStart);

    /* ---------- snapshots ---------- */

    const { Snapshot, PWA } = window.DigitalRerun;
    const MAX_SNAPSHOTS = 12;
    const parts = { machine, terminal: term, printer };
    let lastAuto = { time: 0, cycles: -1 };

    const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

    async function saveSnapshot(kind = 'manual') {
        const snap = Snapshot.take(parts, { kind, version: window.DigitalRerun.VERSION });
        const id = kind === 'auto' ? 'auto' : 'm' + snap.time;
        await Storage.saveSnapshot(id, snap, { kind, time: snap.time, preview: snap.preview, version: snap.version, size: Snapshot.size(snap) });
        if (kind !== 'auto') {
            const manual = (await Storage.listSnapshots()).filter(s => s.kind !== 'auto');
            for (const old of manual.slice(MAX_SNAPSHOTS)) await Storage.deleteSnapshot(old.id);
        }
        renderSnapshots();
        return snap;
    }

    async function restoreSnapshot(id, { quiet = false } = {}) {
        const snap = await Storage.getSnapshot(id);
        if (!snap) throw new Error('that snapshot is gone');
        Snapshot.restore(snap, parts);
        // The disks are now the snapshot's: keep them as the current ones.
        for (const d of DRIVES) {
            const disk = machine.fdc.drives[d];
            if (disk) await Storage.saveDisk(d, disk); else await Storage.removeDisk(d);
        }
        lastAuto = { time: Date.now(), cycles: machine.cycles };
        renderDrives();
        view.render();
        kick();
        focusScreen();
        if (!quiet) PWA.toast(`Restored the snapshot of ${when(snap.time)}.`);
        return snap;
    }

    async function renderSnapshots() {
        const box = $('snapshots');
        let list = [];
        try { list = await Storage.listSnapshots(); } catch (e) { /* no storage */ }
        box.textContent = '';
        for (const s of list) {
            const row = document.createElement('div');
            row.className = 'snap';
            row.innerHTML = '<span class="when"></span><span class="acts"></span><span class="what"></span>';
            row.querySelector('.when').innerHTML = (s.kind === 'auto' ? '<b>AUTO</b>' : '') + when(s.time);
            row.querySelector('.what').textContent = s.preview || ' ';
            row.title = `${s.kind === 'auto' ? 'Saved when you left' : 'Saved by hand'}, version ${s.version || '?'}, ${Math.round(s.size / 1024)}K`;
            const acts = row.querySelector('.acts');
            const btn = (label, title, fn) => {
                const b = document.createElement('button');
                b.className = 'small';
                b.textContent = label;
                b.title = title;
                b.addEventListener('click', fn);
                acts.appendChild(b);
            };
            btn('RESTORE', 'Put the machine back to this moment', () => {
                if (!confirm(`Restore the snapshot of ${when(s.time)}? The machine as it is now is replaced (save a snapshot first to keep it).`)) return;
                restoreSnapshot(s.id).catch(e => PWA.toast(`Could not restore: ${e.message}`));
            });
            btn('✕', 'Delete this snapshot', () => Storage.deleteSnapshot(s.id).then(renderSnapshots));
            box.appendChild(row);
        }
        $('snap-note').textContent = list.length ? `${list.length}` : '';
    }

    function manualSnapshot() {
        if (machine.state === 'stopped') { PWA.toast('Nothing to save: the machine is not running.'); return; }
        saveSnapshot('manual')
            .then(s => PWA.toast(`Snapshot saved: ${when(s.time)}.`))
            .catch(e => PWA.toast(`Could not save the snapshot: ${e.message}`));
        focusScreen();
    }
    $('snapBtn').addEventListener('click', manualSnapshot);
    $('snapSaveBtn').addEventListener('click', manualSnapshot);

    $('resume').addEventListener('change', () => {
        settings.resume = $('resume').checked;
        Storage.set('settings', settings).catch(() => {});
        if (!settings.resume) Storage.deleteSnapshot('auto').then(renderSnapshots).catch(() => {});
    });

    /**
     * One automatic snapshot (id 'auto', replaced each time) when the page is
     * left (hidden or closed: at once) or the window loses focus (at most every
     * 15 s), and only if the machine ran since the last one.
     */
    function autoSnapshot(leaving) {
        if (!settings.resume || machine.state === 'stopped' || machine.cycles === lastAuto.cycles) return;
        if (!leaving && Date.now() - lastAuto.time < 15000) return;
        lastAuto = { time: Date.now(), cycles: machine.cycles };
        saveSnapshot('auto').catch(() => {});
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') autoSnapshot(true); });
    addEventListener('pagehide', () => autoSnapshot(true));
    addEventListener('blur', () => autoSnapshot(false));
    // A safety net: a page being closed may not finish writing, so also once a minute while it runs.
    setInterval(() => { if (document.visibilityState === 'visible') autoSnapshot(false); }, 60000);

    /* ---------- start ---------- */

    async function start() {
        try {
            const saved = await Storage.get('settings');
            if (saved) Object.assign(settings, saved);
        } catch (e) { /* private mode: no storage */ }
        applySettings();
        showTab(settings.tab);
        let disks = new Map();
        try { disks = await Storage.loadDisks(); } catch (e) { /* none */ }
        for (const [drive, d] of disks) {
            try { machine.fdc.mount(drive, new Disk(d.format, new Uint8Array(d.data), { name: d.name, readOnly: d.readOnly })); } catch (e) { /* skip */ }
        }
        if (!machine.fdc.drives[0]) {
            try {
                mount(0, await systemDisk());
                if (!machine.fdc.drives[1]) await newDisk(1);
            } catch (e) { note(e.message, false); }
        }
        // The Zork I game disk goes in D: once; after that D: is the owner's.
        if (!settings.zorkGiven) {
            try {
                if (!machine.fdc.drives[3]) mount(3, await shippedDisk('disks/zork1.dsk', 'Zork I'));
                settings.zorkGiven = true;
                Storage.set('settings', settings).catch(() => {});
            } catch (e) { note(e.message, false); }
        }
        renderDrives();
        renderSnapshots();
        let resumed = null;
        if (settings.resume) {
            try { resumed = await Storage.getSnapshot('auto') ? await restoreSnapshot('auto', { quiet: true }) : null; } catch (e) { resumed = null; }
        }
        if (resumed) PWA.toast(`Resumed where you left off (${when(resumed.time)}). RESET starts afresh.`);
        else coldStart();
        kick();
    }

    start();

    /** Save every changed disk now (before a reload for an update). */
    function flushDisks() {
        return Promise.all(DRIVES.map(d => {
            const disk = machine.fdc.drives[d];
            clearTimeout(saveTimers[d]);
            return disk && disk.dirty ? Storage.saveDisk(d, disk).then(() => { disk.dirty = false; }) : null;
        }));
    }

    window.DigitalRerun.PWA.init({ beforeReload: flushDisks });
})();
