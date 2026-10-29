'use strict';
/*
 * play.js: PLAY.COM for a disk. system/play.asm with the command line
 * filled in: it types `command` at the CP/M prompt (the CCP's buffer).
 */
const fs = require('fs');
const path = require('path');
const { assemble } = require('../js/asm8080.js');

function playCom(command) {
    const src = fs.readFileSync(path.join(__dirname, '../system/play.asm'), 'latin1').replace('@CMD@', command.toUpperCase());
    const r = assemble(src, {});
    return r.image(0x100, r.high);
}

module.exports = { playCom };
