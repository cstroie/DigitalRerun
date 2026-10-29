#!/usr/bin/env node
/*
 * private-shelf.js: build a private catalog from software you may not share.
 *
 *   node tools/private-shelf.js <sources> <out> [--category=<name>] [--vezza=<VEZZA.COM>]
 *
 * Every Z-machine story file found under <sources> (.z1-.z8, or the .dat
 * files of the DOS releases: recognised by their header) becomes a game
 * disk in <out>: the story, VEZZA.COM, its licence, PLAY.COM and a
 * README.TXT, as the shelf's own game disks. <out>/shelf.json lists them
 * in the shelf's format. Put <out> on your own web server (docs/private-shelf.md)
 * and give the app its address: nothing of it is kept in the repository.
 *
 * <sources>/titles.json (optional) names the games:
 *   { "zork1.dat": { "name": "Zork I", "description": "…", "category": "…" } }
 * keyed by the story's file name, lower case. Without it a name is made
 * from the file name. Nothing is read from the story's text.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Disk } = require('../js/devices/fdc.js');
const { CpmFs, toCpmText } = require('../js/cpmfs.js');
const { playCom } = require('./play.js');

const ROOT = path.join(__dirname, '..');
const STORY = /\.(z[1-8]|dat)$/i;

/** The header of a Z-machine story, or null when the bytes are not one. */
function storyHeader(b) {
    if (b.length < 64 || b[0] < 1 || b[0] > 8) return null;
    const w = i => (b[i] << 8) | b[i + 1];
    const high = w(4), pc = w(6), stat = w(14);
    if (high < 64 || high > b.length || stat < 64 || stat > b.length) return null;
    if (b[0] !== 6 && b[0] !== 7 && pc >= b.length) return null;
    return { version: b[0], release: w(2), serial: Buffer.from(b.subarray(18, 24)).toString('latin1') };
}

function* walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(p);
        else if (e.isFile()) yield p;
    }
}

/** The smallest disk format that holds `bytes` of files with room to spare. */
function formatFor(bytes) {
    for (const [format, size] of [['sssd8', 240e3], ['dsdd5', 390e3]]) if (bytes + 16e3 <= size) return format;
    return 'hd4mb';
}

const humanize = s => s.toLowerCase().replace(/\.[^.]*$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function build(sources, out, { category = 'Private', vezza = path.join(ROOT, 'disks/shelf/zork2/VEZZA.COM'), vezzaLic = path.join(ROOT, 'disks/shelf/zork2/VEZZA.LIC') } = {}) {
    const titlesFile = path.join(sources, 'titles.json');
    const titles = fs.existsSync(titlesFile) ? JSON.parse(fs.readFileSync(titlesFile, 'utf8')) : {};
    fs.mkdirSync(out, { recursive: true });
    const vezzaCom = fs.readFileSync(vezza);
    const lic = fs.existsSync(vezzaLic) ? toCpmText(fs.readFileSync(vezzaLic)) : null;
    const used = new Set();
    const entries = [];
    for (const file of walk(sources)) {
        if (!STORY.test(file)) continue;
        const bytes = fs.readFileSync(file);
        const head = storyHeader(bytes);
        if (!head) continue;
        const base = path.basename(file);
        const stem = path.basename(file, path.extname(file)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'GAME';
        let id = stem;
        for (let n = 2; used.has(id); n++) id = stem.slice(0, 8 - String(n).length) + n;
        used.add(id);
        const story = `${id}.Z${head.version}`;
        const meta = titles[base.toLowerCase()] || {};
        const name = meta.name || humanize(base);
        const text = [
            name.toUpperCase(), '='.repeat(name.length), '',
            `Play it:      PLAY      (types VEZZA ${story} for you)`,
            'Save and restore inside the game with SAVE and RESTORE (give a file',
            'name). QUIT leaves the game.', '',
            `${story.padEnd(11)}the story, release ${head.release}, serial ${head.serial}, Z-machine version ${head.version}.`,
            'PLAY.COM   types the line above at the CP/M prompt.',
            'VEZZA.COM  Vezza by Shawn Sijnstra, GPL-2.0-or-later: see VEZZA.LIC.', ''
        ].join('\n');
        const files = [[story, bytes], ['VEZZA.COM', vezzaCom], ['PLAY.COM', playCom(`VEZZA ${story}`)], ['README.TXT', toCpmText(Buffer.from(text))]];
        if (lic) files.push(['VEZZA.LIC', lic]);
        const format = formatFor(files.reduce((t, [, d]) => t + d.length, 0));
        const disk = new Disk(format);
        const fsys = new CpmFs(disk);
        for (const [n, d] of files) fsys.write(n, d);
        const image = `${id.toLowerCase()}.dsk`;
        fs.writeFileSync(path.join(out, image), disk.data);
        entries.push({
            id: id.toLowerCase(), name, format, image, category: meta.category || category,
            description: meta.description || `Z-machine version ${head.version}, release ${head.release}. Type PLAY, or VEZZA ${story}.`,
            credit: meta.credit || '', licence: 'private', size: disk.data.length
        });
    }
    entries.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    fs.writeFileSync(path.join(out, 'shelf.json'), JSON.stringify(entries, null, 1) + '\n');
    return entries;
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const opt = k => (args.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || undefined;
    const [sources, out] = args.filter(a => !a.startsWith('--'));
    if (!sources || !out) {
        console.error('usage: node tools/private-shelf.js <sources> <out> [--category=<name>] [--vezza=<VEZZA.COM>]');
        process.exit(2);
    }
    console.log(`private shelf: reading ${sources}, writing ${out}`);
    const entries = build(sources, out, { category: opt('category'), vezza: opt('vezza') });
    for (const e of entries) console.log(`  ${e.id}: ${e.name} (${e.format}, ${e.size >> 10}K)`);
    console.log(`${entries.length} disk${entries.length === 1 ? '' : 's'} and shelf.json written`);
}

module.exports = { build, storyHeader, formatFor };
