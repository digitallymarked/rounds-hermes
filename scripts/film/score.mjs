// The films' music: an original track, made here, on each film's own beat map (the "Sprint"
// sketch Kris picked for v1.1). 144 bpm, so a beat is 25 frames at 60 fps. A major, I vi IV V. A hit
// on each of the first three words, a snare roll and a riser under the reveal, a broken beat under
// the shots (a hit on each word card, a rewind for the flick back through the months), an impact
// on the mark, and the chord ringing out under the name. Two maps: the ad, and the 1.1 updates.
//   node scripts/film/score.mjs <out.wav> [ad|updates]
import fs from "node:fs";

// --- the beat maps, shared with the cut (ad-cut.py) ---
export const MAPS = {
  ad: { beats: 52, words: [1, 2, 3, 13, 17, 21, 25, 29, 33, 37], mark: 41, flick: 38, bars: ["A", "Fm", "D", "E", "A", "Fm", "D", "E"] },
  // what's new in 1.1, cut as a stack (stack-cut.mjs): a flip as each sheet lands, and the pile's
  // screens on the eighths between the opening hits
  updates: { beats: 48, words: [1, 2, 3, 9, 11, 15, 19, 21, 24, 28, 33], mark: 37, flick: null, bars: ["A", "Fm", "D", "E", "A", "Fm", "E"],
    lands: [12, 13, 16, 20, 22, 25, 26, 29, 30, 34, 35], pile: [1.5, 2.5, 3.5] },
};
const MAP = MAPS[process.argv[3] || "ad"];
const RATE = 48000, BPM = 144, BEAT = 60 / BPM, BEATS = MAP.beats;
const N = Math.round(BEATS * BEAT * RATE);
const L = new Float32Array(N), R = new Float32Array(N), REV = new Float32Array(N);
const pump = new Float32Array(N).fill(1);
const at = (b) => Math.round((b - 1) * BEAT * RATE); // beats count from 1, as in the cut
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

const WORDS = MAP.words; // a word card lands on each
const DROP = 9, MARK = MAP.mark, FLICK = MAP.flick;

let seed = 11;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1;
function biquad(type, f, q) {
  const w = (2 * Math.PI * Math.min(f, RATE * 0.45)) / RATE, c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
  let b0, b1, b2;
  if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = a; b1 = 0; b2 = -a; }
  const a0 = 1 + a;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * c) / a0, a2: (1 - a) / a0 };
}
function filter() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, k = null;
  return { set(type, f, q = 0.707) { k = biquad(type, f, q); }, run(x) { const y = k.b0 * x + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; } };
}
const add = (i, l, r = l) => { if (i >= 0 && i < N) { L[i] += l; R[i] += r; } };
const sendRev = (i, x) => { if (i >= 0 && i < N) REV[i] += x; };
const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));
// the kick's pump on everything tonal that rides the groove
const duck = (s, depth = 0.6, len = 0.28, speed = 11) => { for (let i = 0; i < len * RATE; i++) if (s + i < N) pump[s + i] = Math.min(pump[s + i], 1 - depth * Math.exp(-(i / RATE) * speed)); };

// --- drums ---
function kick(b, v = 1, tune = 48, dec = 7.5) {
  const s = at(b); let ph = 0;
  for (let i = 0; i < 0.5 * RATE; i++) {
    const t = i / RATE, f = tune + 120 * Math.exp(-t * 32);
    ph += (2 * Math.PI * f) / RATE;
    const click = i < 90 ? noise() * 0.25 * (1 - i / 90) : 0;
    add(s + i, (Math.sin(ph) * Math.exp(-t * dec) + click) * 0.62 * v);
  }
  duck(s);
}
function clap(b, v = 1, rev = 0.35) {
  const s = at(b), f = filter(); f.set("bp", 1500, 0.9);
  for (let i = 0; i < 0.35 * RATE; i++) {
    const t = i / RATE;
    const env = t < 0.024 ? Math.exp(-((t % 0.008) * 400)) : Math.exp(-(t - 0.024) * 15);
    const x = f.run(noise()) * env * 0.9 * v;
    add(s + i, x * 0.95, x); sendRev(s + i, x * rev);
  }
}
function snare(b, v = 1, rev = 0.25) {
  const s = at(b), f = filter(); f.set("bp", 3200, 0.6);
  let ph = 0;
  for (let i = 0; i < 0.3 * RATE; i++) {
    const t = i / RATE;
    ph += (175 + 60 * Math.exp(-t * 40)) / RATE;
    const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 22) * 0.55;
    const wire = f.run(noise()) * Math.exp(-t * 13) * 0.75;
    const x = (body + wire) * v * 0.8;
    add(s + i, x * 0.97, x); sendRev(s + i, wire * v * rev);
  }
}
function stomp(b, v = 1) {
  // a foot on a wooden floor: a low thump, a little boom, the room
  const s = at(b), f = filter(); f.set("lp", 260, 0.9);
  let ph = 0;
  for (let i = 0; i < 0.5 * RATE; i++) {
    const t = i / RATE;
    ph += (58 + 50 * Math.exp(-t * 30)) / RATE;
    const x = (f.run(noise()) * Math.exp(-t * 16) * 1.4 + Math.sin(2 * Math.PI * ph) * Math.exp(-t * 9) * 0.8) * v * 0.7;
    add(s + i, x); sendRev(s + i, x * 0.25);
  }
  duck(s, 0.5);
}
function hat(b, open = false, v = 1) {
  const s = at(b), f = filter(); f.set("hp", 7800, 0.7);
  const d = open ? 0.2 : 0.03;
  for (let i = 0; i < d * 5 * RATE; i++) {
    const t = i / RATE, x = f.run(noise()) * Math.exp(-t / d) * 0.15 * v;
    add(s + i, x * (open ? 0.8 : 1.0), x * (open ? 1.0 : 0.85));
  }
}
function tamb(b, v = 1) {
  const s = at(b), f = filter(); f.set("bp", 9500, 1.4);
  for (let i = 0; i < 0.16 * RATE; i++) {
    const t = i / RATE;
    const jingle = t < 0.03 ? 0.6 + 0.4 * Math.cos(t * 2 * Math.PI * 160) : 1;
    const x = f.run(noise()) * Math.exp(-t * 26) * jingle * 0.32 * v;
    add(s + i, x * 0.55, x); sendRev(s + i, x * 0.15);
  }
}

// --- tones ---
function piano(b, notes, len = 0.5, v = 1, rev = 0.3) {
  const s = at(b);
  for (const m of notes) {
    const f0 = hz(m), pan = 0.5 + (m - 62) / 60;
    const parts = [1, 2, 3, 4, 5, 6, 7].map((k) => ({ f: f0 * k * (1 + 0.00035 * k * k), a: 1 / Math.pow(k, 1.25), d: 1.1 + 0.85 * k, ph: 0 }));
    for (let i = 0; i < (len + 0.6) * RATE; i++) {
      const t = i / RATE;
      let x = 0;
      for (const p of parts) { p.ph += p.f / RATE; x += Math.sin(2 * Math.PI * p.ph) * p.a * Math.exp(-t * p.d); }
      const hammer = i < 240 ? noise() * 0.12 * (1 - i / 240) : 0;
      const env = Math.min(1, t / 0.002) * (t < len ? 1 : Math.exp(-(t - len) * 9));
      const y = (x + hammer) * env * 0.11 * v / Math.sqrt(notes.length) * (pump[s + i] ?? 1);
      add(s + i, y * (1.2 - pan), y * (0.2 + pan)); sendRev(s + i, y * rev);
    }
  }
}
function bell(b, m, v = 1, echo = true) {
  const s = at(b), f = hz(m);
  let pc = 0, pm = 0;
  for (let i = 0; i < 1.2 * RATE; i++) {
    const t = i / RATE;
    pm += (f * 3.5) / RATE;
    const mod = Math.sin(2 * Math.PI * pm) * 2.2 * Math.exp(-t * 5);
    pc += f / RATE;
    const x = Math.sin(2 * Math.PI * pc + mod) * Math.exp(-t * 3) * Math.min(1, t / 0.002) * 0.16 * v;
    add(s + i, x * 0.8, x);
    if (echo) { const e = s + i + Math.round(0.75 * BEAT * RATE); add(e, x * 0.3, x * 0.12); }
    sendRev(s + i, x * 0.35);
  }
}
function sub808(b, m, len = 0.6, v = 1, from = 0) {
  const s = at(b); let ph = 0;
  for (let i = 0; i < (len + 0.08) * RATE; i++) {
    const t = i / RATE;
    const note = m + from * Math.exp(-t * 18);
    ph += (hz(note) + 30 * Math.exp(-t * 45)) / RATE;
    const env = Math.min(1, t / 0.002) * Math.exp(-t * 1.3) * (t < len ? 1 : Math.exp(-(t - len) * 50));
    const x = Math.tanh(Math.sin(2 * Math.PI * ph) * 2.4) * env * 0.42 * v;
    add(s + i, x);
  }
}
function lead(b, m, len = 0.25, v = 1) {
  const s = at(b), f = filter(); f.set("lp", 3200, 0.8);
  let ph = 0;
  for (let i = 0; i < (len + 0.12) * RATE; i++) {
    const t = i / RATE;
    const vib = t > 0.12 ? Math.sin(t * 2 * Math.PI * 5.5) * 0.12 : 0;
    ph += hz(m + vib) / RATE;
    const tri = 1 - 4 * Math.abs(ph - Math.floor(ph + 0.5));
    const sq = ph % 1 < 0.5 ? 1 : -1;
    const env = Math.min(1, t / 0.006) * (t < len ? 1 : Math.exp(-(t - len) * 22));
    const x = f.run(tri * 0.8 + sq * 0.2) * env * 0.12 * v;
    add(s + i, x * 0.9, x); sendRev(s + i, x * 0.45);
    const e = s + i + Math.round(0.75 * BEAT * RATE); add(e, x * 0.12, x * 0.28);
  }
}
function stab(b, notes, len = 0.32, v = 1, cut0 = 5200, cut1 = 1700, rev = 0.3) {
  const s = at(b), fl = filter(), fr = filter();
  const voices = notes.flatMap((m) => [-11, -4, 4, 11].map((c, k) => ({ f: hz(m) * Math.pow(2, c / 1200), ph: (noise() + 1) / 2, pan: k % 2 ? 0.75 : 0.25 })));
  for (let i = 0; i < (len + 0.25) * RATE; i++) {
    const t = i / RATE;
    if (i % 32 === 0) { const c = cut1 + (cut0 - cut1) * Math.exp(-t * 5); fl.set("lp", c, 0.9); fr.set("lp", c * 1.03, 0.9); }
    let l = 0, r = 0;
    for (const o of voices) { o.ph += o.f / RATE; const x = saw(o.ph); l += x * (1 - o.pan); r += x * o.pan; }
    const env = Math.min(1, t / 0.004) * (t < len ? Math.exp(-t * 2.2) : Math.exp(-len * 2.2) * Math.exp(-(t - len) * 18));
    const g = (0.12 * v * env) / Math.sqrt(notes.length);
    const xl = fl.run(l) * g, xr = fr.run(r) * g, p = pump[s + i] ?? 1;
    add(s + i, xl * p, xr * p); sendRev(s + i, (xl + xr) * rev * 0.5);
  }
}
function pad(b, beats, notes, v = 1, cut = 1400, attack = 0.25) {
  const s = at(b), len = beats * BEAT, fl = filter(), fr = filter();
  fl.set("lp", cut, 0.6); fr.set("lp", cut, 0.6);
  const voices = notes.flatMap((m) => [-12, -4, 4, 12].map((c, k) => ({ f: hz(m) * Math.pow(2, c / 1200), ph: (noise() + 1) / 2, pan: k % 2 ? 0.8 : 0.2 })));
  for (let i = 0; i < (len + 1.2) * RATE; i++) {
    const t = i / RATE;
    let l = 0, r = 0;
    for (const o of voices) { o.ph += o.f / RATE; const x = saw(o.ph); l += x * (1 - o.pan); r += x * o.pan; }
    const env = Math.min(1, t / attack) * (t < len ? 1 : Math.exp(-(t - len) * 3));
    const g = (0.06 * v * env) / Math.sqrt(notes.length), p = pump[s + i] ?? 1;
    const xl = fl.run(l) * g * p, xr = fr.run(r) * g * p;
    add(s + i, xl, xr); sendRev(s + i, (xl + xr) * 0.4);
  }
}
function bass(b, m, len = 0.22, v = 1) {
  const s = at(b), f = filter();
  let ph = 0, ph2 = 0;
  for (let i = 0; i < (len + 0.05) * RATE; i++) {
    const t = i / RATE;
    if (i % 32 === 0) f.set("lp", 260 + 900 * Math.exp(-t * 14), 1.1);
    ph += hz(m) / RATE; ph2 += hz(m) / 2 / RATE;
    const env = Math.min(1, t / 0.003) * (t < len ? 1 : Math.exp(-(t - len) * 60));
    add(s + i, (f.run(saw(ph)) * 0.7 + Math.sin(2 * Math.PI * ph2) * 0.45) * env * 0.28 * v * (pump[s + i] ?? 1));
  }
}
function reese(b, m, len, v = 1) {
  const s = at(b), f = filter();
  let a = 0, c = 0, d = 0;
  for (let i = 0; i < (len + 0.03) * RATE; i++) {
    const t = i / RATE;
    if (i % 32 === 0) f.set("lp", 520 + 380 * Math.sin(t * 2 * Math.PI * 1.7), 1.3);
    a += (hz(m) * 1.007) / RATE; c += (hz(m) * 0.993) / RATE; d += hz(m - 12) / RATE;
    const env = Math.min(1, t / 0.005) * (t < len ? 1 : Math.exp(-(t - len) * 70));
    const x = (f.run(saw(a) + saw(c)) * 0.5 + Math.sin(2 * Math.PI * d) * 0.6) * env * 0.3 * v * (pump[s + i] ?? 1);
    add(s + i, x);
  }
}
function pluck(b, m, v = 1) {
  const s = at(b); let ph = 0;
  for (let i = 0; i < 0.3 * RATE; i++) {
    const t = i / RATE; ph += hz(m) / RATE;
    const tri = 1 - 4 * Math.abs(ph - Math.floor(ph + 0.5)), sq = ph % 1 < 0.5 ? 1 : -1;
    const x = (tri * 0.75 + sq * 0.25) * Math.exp(-t * 16) * 0.15 * v;
    add(s + i, x * 0.7, x);
    const e = s + i + Math.round(0.75 * BEAT * RATE); add(e, x * 0.3, x * 0.14);
    sendRev(s + i, x * 0.3);
  }
}
function riser(b0, beats, v = 1) {
  const s = at(b0), len = beats * BEAT, f = filter(); let ph = 0;
  for (let i = 0; i < len * RATE; i++) {
    const t = i / RATE, k = t / len;
    if (i % 32 === 0) f.set("bp", 300 * Math.pow(30, k), 1.6);
    ph += (110 * Math.pow(8, k)) / RATE;
    const x = (f.run(noise()) * 0.6 + Math.sin(2 * Math.PI * ph) * 0.12) * k * k * 0.9 * v;
    add(s + i, x * (1 - 0.3 * Math.sin(t * 9)), x * (1 + 0.3 * Math.sin(t * 9))); sendRev(s + i, x * 0.3);
  }
}
function impact(b, v = 1) {
  const s = at(b), lf = filter(), hf = filter(); lf.set("lp", 180, 0.8); hf.set("hp", 5000, 0.7);
  let ph = 0;
  for (let i = 0; i < 2.4 * RATE; i++) {
    const t = i / RATE;
    ph += (40 + 30 * Math.exp(-t * 8)) / RATE;
    const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 2.2) * 0.9, thud = lf.run(noise()) * Math.exp(-t * 9) * 0.8;
    const crash = hf.run(noise()) * Math.exp(-t * 1.6) * 0.18, x = (boom + thud + crash) * v;
    add(s + i, x + crash * 0.3, x - crash * 0.3); sendRev(s + i, crash * 0.6);
  }
}

function swoosh(b0, beats, v = 1) {
  // the rewind: noise falling through a band, left to right
  const s = at(b0), len = beats * BEAT, f = filter();
  for (let i = 0; i < len * RATE; i++) {
    const t = i / RATE, k = t / len;
    if (i % 32 === 0) f.set("bp", 9000 * Math.pow(1 / 30, k), 2.2);
    const x = f.run(noise()) * Math.sin(Math.PI * k) * 0.55 * v;
    add(s + i, x * (1 - k), x * k); sendRev(s + i, x * 0.25);
  }
}

function flip(b, v = 1) {
  // a sheet laid down: paper sliding into place, a soft knock as it lands
  const s = at(b), f = filter(), lf = filter(); lf.set("lp", 220, 0.8);
  for (let i = 0; i < 0.12 * RATE; i++) {
    const t = i / RATE;
    if (i % 32 === 0) f.set("bp", 5200 * Math.exp(-t * 18) + 900, 1.1);
    const slide = f.run(noise()) * Math.exp(-t * 30) * 0.32, knock = lf.run(noise()) * Math.exp(-t * 45) * 0.9;
    const x = (slide + knock) * v;
    add(s + i, x * 0.9, x); sendRev(s + i, slide * v * 0.2);
  }
}

// --- the arrangement ---
const A = [57, 61, 64, 69], Fm = [57, 61, 66, 69], D = [57, 62, 66, 69], E = [56, 59, 64, 68];
const A9 = [57, 61, 64, 69, 71];
const CHORD = { A: [A, 45], Fm: [Fm, 42], D: [D, 38], E: [E, 40] };
const bars = MAP.bars.map((k) => CHORD[k]);

// 1. the words: a hit under each of the first three, a snare fill on the fourth beat
for (const b of [1, 2, 3]) { kick(b, 0.9); clap(b, 0.8, 0.5); stab(b, A, 0.3, 1, 2600, 700, 0.5); }
for (let k = 0; k < 4; k++) snare(4 + k * 0.25, 0.3 + k * 0.1);
// 2. the reveal: a snare roll that thickens, the IV chord opening, a riser into the drop
for (let k = 0; k < 16; k++) snare(5 + k * 0.25, 0.25 + k * 0.03, 0.1);
pad(5, 4, D, 0.8, 1000, 0.3);
riser(5, 4, 0.8);
// 3. the groove under the shots
for (let bar = 0; bar < bars.length; bar++) {
  const b0 = DROP + bar * 4, [ch, root] = bars[bar];
  const last = bar === bars.length - 1;
  for (const p of [0, 1.75, 2.5]) kick(b0 + p, 0.95);
  for (const p of [1, 3]) if (!(last && p === 3)) snare(b0 + p, 1);
  for (const p of [1.75, 3.75]) if (!last) snare(b0 + p, 0.25, 0.05);
  for (let e = 0; e < 16; e++) hat(b0 + e / 4, false, e % 4 === 2 ? 0.9 : e % 2 ? 0.4 : 0.65);
  hat(b0 + 3.5, true, 0.5);
  reese(b0, root, 1.4, 1); reese(b0 + 1.5, root, 0.4, 0.9); reese(b0 + 2.5, root + 12, 0.35, 0.8); reese(b0 + 3, root, 0.9, 0.9);
  for (const p of [0, 0.75, 1.5, 2.5, 3.25]) stab(b0 + p, ch, 0.16, 0.85, 6000, 1800, 0.25);
  // the fast arp from the third bar on
  if (bar >= 2) { const tones = ch.map((m) => m + 12).concat(ch[1] + 24); for (let e = 0; e < 16; e++) pluck(b0 + e / 4, tones[[0, 1, 2, 3, 4, 3, 2, 1][e % 8]], e % 4 === 0 ? 1 : 0.65); }
  // the last bar rolls into the mark
  if (last) for (let k = 0; k < 8; k++) snare(b0 + 2 + k * 0.25, 0.3 + k * 0.09, 0.12);
}
// a hit on each word card in the groove
for (const b of WORDS.filter((b) => b >= DROP)) { impact(b, 0.22); stab(b, bars[Math.floor((b - DROP) / 4)][0], 0.3, 0.7, 4200, 900, 0.5); }
// the rewind under the flick back through the months
if (FLICK) swoosh(FLICK, 1, 1);
for (const b of MAP.lands || []) flip(b, 0.8);
for (const b of MAP.pile || []) flip(b, 0.6);
// 4. the mark: an impact, the full chord, then the name over it ringing out
impact(MARK, 1); kick(MARK, 1);
stab(MARK, A9, 1.3, 1.3, 5000, 1100, 0.7);
pad(MARK, 10, A9, 1, 1700, 0.02); reese(MARK, 45, 1.4, 0.8);
stab(MARK + 2, [61, 64, 69, 73], 0.5, 0.6, 3000, 800, 0.8);
stab(MARK + 4, [64, 69, 71, 76], 0.45, 0.42, 2600, 800, 0.85);
stab(MARK + 6, [57, 61, 64, 69], 0.6, 0.5, 2500, 700, 0.9);

// --- room, master ---
{
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  const alls = [225, 556].map((d) => ({ d, buf: new Float32Array(d), i: 0 }));
  const outL = new Float32Array(N), outR = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    let y = 0;
    for (const c of combs) { const o = c.buf[c.i]; c.buf[c.i] = REV[n] + o * 0.84; c.i = (c.i + 1) % c.d; y += o; }
    y /= 4;
    for (const a of alls) { const o = a.buf[a.i]; const v = y + o * 0.5; a.buf[a.i] = v; y = o - v * 0.5; a.i = (a.i + 1) % a.d; }
    outL[n] = y; if (n + 340 < N) outR[n + 340] = y;
  }
  for (let n = 0; n < N; n++) { L[n] += outL[n] * 0.9; R[n] += outR[n] * 0.9; }
}
let peak = 0;
for (let n = 0; n < N; n++) { L[n] = Math.tanh(L[n] * 1.25); R[n] = Math.tanh(R[n] * 1.25); peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n])); }
const g = 0.89 / peak, fade = 0.6 * RATE;
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8); out.write("fmt ", 12);
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(RATE, 24);
out.writeUInt32LE(RATE * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  const f = n > N - fade ? (N - n) / fade : 1;
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * g * f)) * 32767), 44 + n * 4);
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * g * f)) * 32767), 46 + n * 4);
}
fs.writeFileSync(process.argv[2] || "score.wav", out);
console.log("score", process.argv[3] || "ad", BPM, "bpm", (N / RATE).toFixed(2), "s");
