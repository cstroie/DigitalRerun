#!/usr/bin/env node
/*
 * private-serve.js: serve a private catalog folder for a trial.
 *
 *   node tools/private-serve.js <folder> [--port=8099] [--token=<secret>] [--origin=<app origin>]
 *
 * A plain static server that allows the app to read it from another origin
 * (CORS; --origin names the one allowed, default any) and, with --token,
 * refuses a request that lacks `Authorization: Bearer <secret>`. It speaks
 * http: a page served over https may still read http://localhost, but for
 * anything else use a real web server with https (docs/private-shelf.md).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

function server(root, { token = '', origin = '*' } = {}) {
    return http.createServer((req, res) => {
        const head = {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'Authorization',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Max-Age': '600', 'Vary': 'Origin', 'Cache-Control': 'no-store'
        };
        if (req.method === 'OPTIONS') { res.writeHead(204, head); return res.end(); }
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, head); return res.end(); }
        if (token && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401, head); return res.end(); }
        let rel;
        try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400, head); return res.end(); }
        const file = path.join(root, path.normalize(rel).replace(/^([/\\]|\.\.(?=[/\\]|$))+/, ''));
        if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, head); return res.end(); }
        res.writeHead(200, { ...head, 'Content-Type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
    });
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const opt = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
    const dir = args.find(a => !a.startsWith('--'));
    if (!dir) { console.error('usage: node tools/private-serve.js <folder> [--port=8099] [--token=<secret>] [--origin=<app origin>]'); process.exit(2); }
    const port = Number(opt('port', 8099));
    console.log(`serving ${path.resolve(dir)} on http://localhost:${port}/ ${opt('token', '') ? 'with a token' : 'without a token'}`);
    server(path.resolve(dir), { token: opt('token', ''), origin: opt('origin', '*') }).listen(port);
}

module.exports = { server };
