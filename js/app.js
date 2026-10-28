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

    const sound = new window.DigitalRerun.Sound();
    machine.console.output = b => term.write(b);
    term.reply = bytes => machine.console.type(bytes);
    term.bell = () => { $('crt').animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], 120); sound.bell(); };
    let lineChars = 0;                       // characters struck since the last CR, for the sound
    machine.printer.output = b => {
        const inText = !printer.esc;
        printer.write(b);
        if (inText && (b & 0x7F) >= 0x20 && (b & 0x7F) < 0x7F) lineChars++;
        else if (inText && b === 0x0D) { sound.printLine(lineChars); lineChars = 0; }
        else if (inText && b === 0x0A) sound.feed(1);
        else if (inText && b === 0x0C) { sound.printLine(lineChars); lineChars = 0; sound.feed(20); }
        leds.prn = performance.now();
        paperOut();
    };

    /* ---------- settings ---------- */

    const settings = { speed: 4, terminal: 'vt100', arrows: 'wordstar', phosphor: 'green', tab: 'drives', resume: true, sound: true };

    function applySettings() {
        $('speed').value = String(settings.speed);
        $('terminal').value = settings.terminal;
        term.mode = settings.terminal;
        $('arrows').value = settings.arrows;
        $('phosphor').value = settings.phosphor;
        $('resume').checked = settings.resume;
        $('sound').checked = settings.sound;
        sound.enabled = settings.sound;
        $('crt').classList.toggle('amber', settings.phosphor === 'amber');
        $('crt').classList.toggle('white', settings.phosphor === 'white');
    }

    /* ---------- tabs (phones: one panel at a time) ---------- */

    const phone = matchMedia('(max-width: 900px)');
    let unseen = 0;

    function showTab(name) {
        settings.tab = name;
        if (name === 'paper' && !phone.matches) name = 'drives';      // the desktop has no PAPER tab
        for (const b of document.querySelectorAll('#tabs [data-for]')) b.setAttribute('aria-selected', String(b.dataset.for === name));
        for (const el of document.querySelectorAll('[data-tab]')) el.classList.toggle('active', el.dataset.tab === name);
        if (name === 'paper') { unseen = 0; $('paper-badge').hidden = true; }
    }

    phone.addEventListener('change', () => showTab(settings.tab));

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

    for (const key of ['speed', 'terminal', 'arrows', 'phosphor']) {
        $(key).addEventListener('change', () => {
            settings[key] = key === 'speed' ? Number($(key).value) : $(key).value;
            // Terminal arrow keys follow the terminal; WordStar keys stay.
            if (key === 'terminal' && settings.arrows !== 'wordstar') settings.arrows = settings.terminal;
            applySettings();
            Storage.set('settings', settings).catch(() => {});
            focusScreen();
        });
    }

    /* ---------- LEDs ---------- */

    const leds = { disk: {}, prn: 0, busy: false };
    machine.fdc.onActivity = drive => {
        leds.disk[drive] = performance.now();
        sound.disk(drive, machine.fdc.track);
    };

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

    async function newDisk(drive, ask = true) {
        let label = drive === 8 ? 'hard disk' : 'blank';
        if (ask) {
            const answer = prompt(`A label for the new disk in ${LETTER(drive)}:`, label);
            if (answer === null) return;                              // cancelled
            label = answer.trim().slice(0, 32) || label;
        }
        const disk = new Disk(formatFor(drive), null, { name: label });
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

    /* ---------- paper tape ---------- */

    function renderTape() {
        const r = machine.reader, p = machine.punch.bytes.length;
        $('tape-reader').textContent = r.tape.length ? `${r.name}, ${r.left} of ${r.tape.length} bytes left` : 'no tape';
        $('tape-punch').textContent = p ? `${p} bytes punched` : 'nothing yet';
    }
    let tapeDirty = false;
    machine.reader.onRead = machine.punch.onWrite = () => { tapeDirty = true; };

    $('tapeLoadBtn').addEventListener('click', async () => {
        const [file] = await pickFile($('fileInput'));
        if (!file) return;
        let bytes = new Uint8Array(await file.arrayBuffer());
        // Text gets CP/M line ends and ^Z; anything else is read as it is, then ^Z.
        if (isTextName(file.name) || file.type.startsWith('text/')) bytes = toCpmText(bytes);
        else { const t = new Uint8Array(bytes.length + 1); t.set(bytes); t[bytes.length] = 0x1A; bytes = t; }
        machine.reader.load(bytes, file.name);
        renderTape();
        focusScreen();
    });
    $('tapeSaveBtn').addEventListener('click', () => {
        let bytes = Uint8Array.from(machine.punch.bytes);
        let a = 0, b = bytes.length;
        while (a < b && bytes[a] === 0) a++;                  // PIP's leader and trailer of nulls
        while (b > a && bytes[b - 1] === 0) b--;
        bytes = bytes.subarray(a, b);
        if (!bytes.length) { note('nothing punched yet', false); return; }
        const text = bytes.includes(0x1A) && bytes.subarray(0, bytes.indexOf(0x1A)).every(c => c >= 0x20 || c === 9 || c === 10 || c === 13 || c === 12);
        if (text) download('punched.txt', fromCpmText(bytes), 'text/plain');
        else download('punched.bin', bytes);
    });
    $('tapeClearBtn').addEventListener('click', () => { machine.punch.clear(); renderTape(); focusScreen(); });

    /* ---------- keyboard ---------- */

    const kbd = $('kbd');
    const ARROWS = {
        wordstar: { ArrowUp: [5], ArrowDown: [24], ArrowLeft: [19], ArrowRight: [4], PageUp: [18], PageDown: [3], Home: [17, 83], End: [17, 68], Delete: [7], Insert: [22] },
        vt100: { ArrowUp: [27, 91, 65], ArrowDown: [27, 91, 66], ArrowRight: [27, 91, 67], ArrowLeft: [27, 91, 68], Delete: [127] },
        adm3a: { ArrowUp: [11], ArrowDown: [10], ArrowLeft: [8], ArrowRight: [12], Home: [30], Delete: [127] }
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

    /* The phone key row: CTRL holds for the next key; the buttons never take the focus,
       so the on-screen keyboard stays open. */
    let ctrlArmed = false;
    const armCtrl = on => { ctrlArmed = on; document.querySelector('#keyrow [data-key="ctrl"]').classList.toggle('on', on); };
    const ctrlOf = ch => { const c = ch.toUpperCase().charCodeAt(0); return c >= 64 && c <= 95 ? c & 0x1F : null; };
    const KEYROW = { Escape: [27], Tab: [9], 'ctrl-c': [3] };
    $('keyrow').addEventListener('pointerdown', e => e.preventDefault());
    $('keyrow').addEventListener('click', e => {
        const b = e.target.closest('[data-key]');
        if (!b) return;
        const key = b.dataset.key;
        if (key === 'ctrl') { armCtrl(!ctrlArmed); focusScreen(); return; }
        const bytes = KEYROW[key] || ARROWS[settings.arrows][key] || ARROWS.vt100[key];
        if (bytes) { machine.console.type(bytes); kick(); }
        armCtrl(false);
        focusScreen();
    });

    kbd.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V') && e.shiftKey) return;   // let paste happen
        if (ctrlArmed && e.key.length === 1 && ctrlOf(e.key) !== null) {
            e.preventDefault();
            machine.console.type([ctrlOf(e.key)]);
            armCtrl(false);
            kick();
            return;
        }
        const bytes = keyBytes(e);
        if (!bytes) return;
        e.preventDefault();
        machine.console.type(bytes);
        kick();
    });
    // Keys typed while something else on the page has the focus go to the machine too,
    // except into form fields, and Enter or Space on a button or link.
    document.addEventListener('keydown', e => {
        const t = e.target;
        if (t === kbd || e.defaultPrevented || e.metaKey || e.altKey) return;
        if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
        if (['BUTTON', 'A', 'SUMMARY'].includes(t.tagName) && (e.key === 'Enter' || e.key === ' ')) return;
        if (e.key === 'Tab') return;                                   // keyboard navigation of the page
        if (e.ctrlKey && getSelection().toString()) return;            // copying a selection
        const bytes = keyBytes(e);
        if (!bytes) return;
        e.preventDefault();
        machine.console.type(bytes);
        kick();
        focusScreen();
    });

    // Mobile keyboards send text through input events.
    kbd.addEventListener('input', () => {
        if (kbd.value) {
            let text = kbd.value.replace(/\n/g, '\r');
            if (ctrlArmed && ctrlOf(text[0]) !== null) {
                machine.console.type([ctrlOf(text[0])]);
                text = text.slice(1);
                armCtrl(false);
            }
            // One key types at once; a word from the keyboard's suggestions is pasted, paced.
            if (text.length === 1) machine.console.type(text); else if (text) machine.console.paste(text);
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
        machine.console.paste(text.replace(/\r?\n/g, '\r').replace(/[^\x00-\x7f]/g, '?'));
        kick();
        focusScreen();
    }

    $('pasteBtn').addEventListener('click', async () => {
        try { typeText(await navigator.clipboard.readText()); } catch (e) { focusScreen(); }
    });

    /* ---------- the screen: 80 columns across, and pictures of it ---------- */

    const COLS = 80, MIN_PX = 11, MAX_PX = 30;

    /** The font size at which 80 columns fill the screen's width (measured: fonts differ). */
    function fitScreen() {
        const screen = $('screen');
        const width = screen.clientWidth;
        if (!width) return;
        const probe = document.createElement('span');
        probe.textContent = 'M'.repeat(COLS);
        probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px;white-space:pre';
        screen.appendChild(probe);
        const at100 = probe.getBoundingClientRect().width;
        probe.remove();
        if (!at100) return;
        const px = Math.max(MIN_PX, Math.min(MAX_PX, Math.floor(width * 100 / at100 * 100) / 100));
        screen.style.fontSize = `${px}px`;
    }
    new ResizeObserver(fitScreen).observe($('crt'));
    if (document.fonts) document.fonts.ready.then(fitScreen);

    /** A PNG of the screen as it looks: phosphor colour, glow, attributes, cursor, scan lines. */
    async function screenShot() {
        const crtStyle = getComputedStyle($('crt'));
        const fg = crtStyle.getPropertyValue('--fg').trim() || '#9dff8a';
        const glow = crtStyle.getPropertyValue('--glow').trim() || 'rgba(157,255,138,0.35)';
        const bg = '#050805';
        const scale = 2, px = 20 * scale, lineH = Math.round(px * 1.06), pad = 18 * scale;
        const font = `${px}px VT323, ui-monospace, monospace`;
        if (document.fonts) await document.fonts.load(font).catch(() => {});
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = font;
        const cw = ctx.measureText('M').width;
        canvas.width = Math.ceil(pad * 2 + COLS * cw);
        canvas.height = Math.ceil(pad * 2 + term.rows * lineH);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = font;
        ctx.textBaseline = 'top';
        const { BOLD, UNDERLINE, REVERSE, DIM } = window.DigitalRerun.ATTR;
        for (let r = 0; r < term.rows; r++) {
            for (let c = 0; c < term.cols; c++) {
                const code = term.chars[r][c], attr = term.attrs[r][c];
                const cursor = term.cursorVisible && r === term.y && c === term.x;
                const x = pad + c * cw, y = pad + r * lineH;
                const inverse = !!(attr & REVERSE) !== cursor;
                if (inverse) { ctx.shadowBlur = 0; ctx.fillStyle = fg; ctx.fillRect(x, y, Math.ceil(cw), lineH); }
                if (code === 32 && !(attr & UNDERLINE)) continue;
                ctx.globalAlpha = attr & DIM ? 0.6 : 1;
                ctx.fillStyle = inverse ? bg : attr & BOLD ? '#e8ffe0' : fg;
                ctx.shadowColor = glow;
                ctx.shadowBlur = inverse ? 0 : (attr & BOLD ? 9 : 6) * scale;
                ctx.fillText(String.fromCharCode(code), x, y + (lineH - px) / 2);
                if (attr & UNDERLINE) ctx.fillRect(x, y + lineH - 2 * scale, Math.ceil(cw), scale);
                ctx.globalAlpha = 1;
            }
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        for (let y = 0; y < canvas.height; y += 3 * scale) ctx.fillRect(0, y, canvas.width, scale);
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
        canvas.toBlob(b => download(`digitalrerun-screen-${stamp}.png`, b, 'image/png'));
        focusScreen();
    }
    $('shotBtn').addEventListener('click', () => screenShot().catch(() => {}));

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
        if (tapeDirty) { tapeDirty = false; renderTape(); }
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
        term.mode = settings.terminal;                    // the SETUP choice wins over the snapshot's
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

    $('sound').addEventListener('change', () => {
        settings.sound = $('sound').checked;
        applySettings();
        if (settings.sound) sound.unlock();
        Storage.set('settings', settings).catch(() => {});
    });
    // Audio may start only after a key or a tap.
    for (const ev of ['keydown', 'pointerdown']) addEventListener(ev, () => sound.unlock(), { capture: true });

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
                if (!machine.fdc.drives[1]) await newDisk(1, false);
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
