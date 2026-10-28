/*
 * storage.js: disks and settings kept in the browser (IndexedDB), so a
 * reload finds the drives as they were left.
 *
 *   disks:    key = drive number, value = { name, format, data, readOnly }
 *   settings: key = name, value = anything
 */
(function (root) {
    'use strict';

    const DB = 'jscpm';
    const VERSION = 1;

    function open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB, VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('disks')) db.createObjectStore('disks');
                if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    let dbPromise = null;
    const db = () => (dbPromise = dbPromise || open());

    function call(store, mode, fn) {
        return db().then(d => new Promise((resolve, reject) => {
            const tx = d.transaction(store, mode);
            const req = fn(tx.objectStore(store));
            tx.oncomplete = () => resolve(req && req.result);
            tx.onerror = () => reject(tx.error);
        }));
    }

    const Storage = {
        saveDisk(drive, disk) {
            return call('disks', 'readwrite', s => s.put({
                name: disk.name, format: disk.format, readOnly: disk.readOnly, data: disk.data.slice()
            }, drive));
        },
        removeDisk(drive) { return call('disks', 'readwrite', s => s.delete(drive)); },
        loadDisks() {
            return db().then(d => new Promise((resolve, reject) => {
                const out = new Map();
                const tx = d.transaction('disks', 'readonly');
                const req = tx.objectStore('disks').openCursor();
                req.onsuccess = () => {
                    const c = req.result;
                    if (c) { out.set(c.key, c.value); c.continue(); }
                };
                tx.oncomplete = () => resolve(out);
                tx.onerror = () => reject(tx.error);
            }));
        },
        get(key) { return call('settings', 'readonly', s => s.get(key)); },
        set(key, value) { return call('settings', 'readwrite', s => s.put(value, key)); }
    };

    (root.JSCPM = root.JSCPM || {}).Storage = Storage;
})(typeof window !== 'undefined' ? window : globalThis);
