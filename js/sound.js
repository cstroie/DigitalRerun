/*
 * sound.js: the machine's noises, synthesized (no sound files).
 *
 *   bell()            the terminal's bell
 *   disk(drive, track) an access: a head-load clunk after a pause, a step
 *                     click per track the head moves
 *   printLine(chars)  the print head rasping across a line of that length
 *   feed(lines)       the paper moving up
 *
 * Browsers start audio only after a key or a tap: unlock() is called on
 * the first one. With `enabled` false nothing is made.
 */
(function (root) {
    'use strict';

    const HEAD_UNLOAD_MS = 900;     // an idle head lifts; the next access loads it again
    const STEP_S = 0.006;           // between step clicks (an 8" drive steps in about 3-10 ms)
    const MAX_STEPS = 16;           // clicks for a long seek, after which it is one sweep

    class Sound {
        constructor() {
            this.enabled = true;
            this.ctx = null;
            this.noise = null;
            this.last = {};          // drive -> { time, track }
            this.printerFree = 0;    // when the print head is free again (ctx time)
        }

        /** Create or wake the audio context: call from a key press or a tap. */
        unlock() {
            if (!this.enabled) return;
            const AC = root.AudioContext || root.webkitAudioContext;
            if (!AC) return;
            if (!this.ctx) {
                this.ctx = new AC();
                this.master = this.ctx.createGain();
                this.master.gain.value = 0.5;
                this.master.connect(this.ctx.destination);
                const len = this.ctx.sampleRate;           // one second of white noise, reused
                this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
                const d = this.noise.getChannelData(0);
                for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
            }
            if (this.ctx.state === 'suspended') this.ctx.resume();
        }

        ready() {
            return this.enabled && this.ctx && this.ctx.state === 'running';
        }

        /** A burst of filtered noise. */
        burst(at, length, { freq = 2000, q = 1, gain = 0.3, type = 'bandpass', decay = true } = {}) {
            const src = this.ctx.createBufferSource();
            src.buffer = this.noise;
            const f = this.ctx.createBiquadFilter();
            f.type = type;
            f.frequency.value = freq;
            f.Q.value = q;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gain, at);
            if (decay) g.gain.exponentialRampToValueAtTime(0.001, at + length);
            else g.gain.setValueAtTime(0, at + length);
            src.connect(f).connect(g).connect(this.master);
            src.start(at, Math.random() * 0.5, length + 0.02);
        }

        bell() {
            if (!this.ready()) return;
            const t = this.ctx.currentTime;
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = 'square';
            o.frequency.value = 880;
            g.gain.setValueAtTime(0.08, t);
            g.gain.setValueAtTime(0, t + 0.12);
            o.connect(g).connect(this.master);
            o.start(t);
            o.stop(t + 0.13);
        }

        disk(drive, track) {
            const now = performance.now();
            const prev = this.last[drive];
            this.last[drive] = { time: now, track };
            if (!this.ready()) return;
            let t = this.ctx.currentTime;
            if (!prev || now - prev.time > HEAD_UNLOAD_MS) {
                // the head-load solenoid: a dull clunk
                this.burst(t, 0.05, { freq: 180, q: 0.8, gain: 0.5, type: 'lowpass' });
                this.burst(t, 0.02, { freq: 1200, q: 2, gain: 0.15 });
                t += 0.03;
            }
            const steps = prev ? Math.min(Math.abs(track - prev.track), MAX_STEPS) : 0;
            for (let i = 0; i < steps; i++) {
                this.burst(t + i * STEP_S, 0.008, { freq: 2600, q: 3, gain: 0.22 });
            }
        }

        printLine(chars) {
            if (!this.ready() || chars <= 0) return;
            const t = Math.max(this.ctx.currentTime, this.printerFree);
            const length = Math.min(0.9, 0.012 * chars);       // a quick printer, not a slow one
            this.burst(t, length, { freq: 3200, q: 1.5, gain: 0.12, decay: false });
            this.burst(t, length, { freq: 900, q: 2, gain: 0.06, decay: false });
            this.printerFree = t + length + 0.03;
        }

        feed(lines = 1) {
            if (!this.ready()) return;
            const t = Math.max(this.ctx.currentTime, this.printerFree);
            const length = Math.min(0.6, 0.03 * lines);
            this.burst(t, length, { freq: 400, q: 0.7, gain: 0.08, decay: false });
            this.printerFree = t + length;
        }
    }

    (root.DigitalRerun = root.DigitalRerun || {}).Sound = Sound;
})(typeof window !== 'undefined' ? window : globalThis);
