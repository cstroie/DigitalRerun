#!/usr/bin/env node
/*
 * stamp.js: write the build stamp into js/version.js.
 *
 *   node tools/stamp.js            write it
 *   node tools/stamp.js --check    exit 1 when it is stale
 *
 * The stamp is the first 12 hex digits of a SHA-256 over every file the
 * service worker caches (its SHELL list), js/version.js taken with the
 * stamp blanked. Run it after any change to those files, and raise
 * VERSION in js/version.js for a release.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const VERSION_FILE = path.join(ROOT, 'js/version.js');
const STAMP = /BUILD: '([0-9a-f]{12})'/;

function shell() {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const list = /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1];
    return [...list.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(f => f !== './');
}

function build() {
    const h = crypto.createHash('sha256');
    for (const f of shell()) {
        let data = fs.readFileSync(path.join(ROOT, f));
        if (f === 'js/version.js') data = Buffer.from(data.toString('utf8').replace(STAMP, "BUILD: '000000000000'"));
        h.update(f + '\0').update(data);
    }
    return h.digest('hex').slice(0, 12);
}

function current() {
    return STAMP.exec(fs.readFileSync(VERSION_FILE, 'utf8'))[1];
}

if (require.main === module) {
    const stamp = build();
    if (process.argv.includes('--check')) {
        if (stamp !== current()) { console.error(`js/version.js: build ${current()} is stale, run node tools/stamp.js (${stamp})`); process.exit(1); }
        console.log(`build ${stamp} is current`);
    } else {
        fs.writeFileSync(VERSION_FILE, fs.readFileSync(VERSION_FILE, 'utf8').replace(STAMP, `BUILD: '${stamp}'`));
        console.log(`js/version.js: build ${stamp}`);
    }
}

module.exports = { shell, build, current };
