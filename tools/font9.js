#!/usr/bin/env node
/*
 * font9.js: turn tools/font9.txt into js/font9.js.
 *
 *   node tools/font9.js
 *
 * Each glyph becomes 9 numbers, one per pin row (row 0 = top pin),
 * bit 4 = the leftmost of 5 columns.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'font9.txt'), 'utf8').split('\n');
const glyphs = new Map();
let code = null, rows = [];
const flush = () => {
    if (code === null) return;
    if (rows.length !== 7 && rows.length !== 9) throw new Error(`glyph ${code}: ${rows.length} rows, want 7 or 9`);
    while (rows.length < 9) rows.push('.....');
    glyphs.set(code, rows.map(r => parseInt(r.replace(/#/g, '1').replace(/\./g, '0'), 2)));
};
for (const line of src) {
    if (line.startsWith('# ') || line.trim() === '' && code === null) continue;
    if (/^[.#]{5}$/.test(line)) { rows.push(line); continue; }
    if (line.trim() === '') continue;
    flush();
    code = /^0x[0-9a-f]+$/i.test(line) ? parseInt(line, 16) : line.charCodeAt(0);
    rows = [];
}
flush();
for (let c = 0x20; c < 0x7F; c++) if (!glyphs.has(c)) throw new Error(`no glyph for ${c} '${String.fromCharCode(c)}'`);

const body = [];
for (let c = 0x20; c < 0x7F; c++) body.push(`        [${glyphs.get(c).join(',')}], // ${String.fromCharCode(c)}`);
const out = `/*
 * font9.js: jscpm's dot-matrix font, ASCII 20h-7Eh. Generated from
 * tools/font9.txt by tools/font9.js: edit that file, not this one.
 * Each glyph is 9 pin rows (top first); bit 4 is the leftmost column.
 */
(function (root) {
    'use strict';
    const FONT9 = [
${body.join('\n')}
    ];
    if (typeof module !== 'undefined' && module.exports) module.exports = { FONT9 };
    else (root.JSCPM = root.JSCPM || {}).FONT9 = FONT9;
})(typeof window !== 'undefined' ? window : globalThis);
`;
fs.writeFileSync(path.join(__dirname, '..', 'js', 'font9.js'), out);
console.log(`js/font9.js: ${glyphs.size} glyphs`);
