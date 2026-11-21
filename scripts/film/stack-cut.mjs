// The film of what's new in 1.1, cut as a stack. It opens on a pile of real screens from every
// project landing on the beat, then each shot and each line of words arrives as a sheet laid on
// top of the last, the earlier ones stepping back behind it the way the timeline stacks the days.
// At the end the top three sheets fold down into the three discs of the mark. Drawn a frame at a
// time in Chrome over the takes (ad.mjs), on the score (score.mjs, the "updates" map).
//   node scripts/film/stack-cut.mjs <desktop|phone> <takes dir> <paper.mp4> <score.wav> <out.mp4>
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const [view = "desktop", SRC, PAPER, SCORE, OUT] = process.argv.slice(2);
const [W, H] = view === "desktop" ? [1920, 1080] : [1080, 1350];
const B = 25; // frames in a beat, at 144 bpm
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const TMP = path.join(SRC, `stack-${view}`);

// what lands, beat by beat: the pile, a take, or words ("t:"); the end folds the stack into the mark
const SEQ = [
  ["chaos", 4], ["reveal", 4], ["t:What’s new in 1.1", 2],
  ["t:Focus one session.", 1], ["tap", 1], ["focused", 2],
  ["t:Its whole history.", 1], ["history", 3],
  ["t:Go back", 1], ["stack", 1], ["t:to any day.", 1], ["days", 2],
  ["t:Find any session.", 1], ["find", 1], ["alone", 2],
  ["t:See every change.", 1], ["sheet", 1], ["page", 3],
  ["t:Desktop to phone.", 1], ["open", 1], ["morph", 2],
  ["end", 12],
];
// the pile: real screens from every project in the demo, one on each eighth, then each sixteenth
const CHAOS = ["4c3de4eba4ef6380", "87ecbe55f4c5acd6", "42d0f56a29b28937", "c090c3510b86a43d", "fdcb3621cf44c4c0",
  "dc6a2f56a7f072f7", "518fce83205c313f", "a29cbbc3a2052734", "ffeab081a867a1dc", "e60ca2f669302fc7"];
const LANDS = [0, 12, 25, 37, 50, 62, 75, 81, 87, 93];

// the sheet, and how each one behind it steps back: up a little and a little narrower
const G = view === "desktop"
  ? { x: 64, y: 84, w: 1792, h: 1008, r: 26, step: 18, shrink: 0.035, words: 232, m: 140, name: 190, sub: 64, npx: 40 }
  : { x: 36, y: 100, w: 1008, h: 1260, r: 24, step: 16, shrink: 0.035, words: 160, m: 128, name: 160, sub: 54, npx: 36 };
const LAND = 9; // frames a sheet takes to land

const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const easeInOut = (t) => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const mix = (a, b, k) => a + (b - a) * k;
let seed = 20;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

// ---- the takes' frames, at the sheet's size --------------------------------------------------------
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const segs = [];
let at = 0;
for (const [name, beats] of SEQ) {
  const n = beats * B, s = { name, n, start: at, words: name.startsWith("t:") ? name.slice(2) : null };
  if (!s.words && name !== "chaos" && name !== "end") {
    const dir = path.join(TMP, name);
    fs.mkdirSync(dir);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(SRC, `${view}-ad-${name}.mp4`), "-frames:v", String(n), "-vf", `scale=${G.w}:${G.h}:flags=lanczos`, "-q:v", "2", path.join(dir, "%04d.jpg")]);
    s.frames = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).length;
    s.frame = (k) => pathToFileURL(path.join(dir, `${String(Math.min(k, s.frames - 1) + 1).padStart(4, "0")}.jpg`)).href;
  }
  segs.push(s);
  at += n;
}
const TOTAL = at;
const paper = path.join(TMP, "paper.png");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", "1", "-i", PAPER, "-frames:v", "1", "-vf", `scale=${W}:${H}`, paper]);
const store = path.join(ROOT, "demo/store/img");
const chaos = CHAOS.map((h, k) => {
  const m = JSON.parse(fs.readFileSync(path.join(store, `${h}.json`), "utf8"));
  return { src: pathToFileURL(path.join(store, `${h}.${m.ext}`)).href, aspect: m.w / m.h, at: LANDS[k] };
});

// ---- where everything sits ---------------------------------------------------------------------------
// a sheet `d` deep in the stack (d can be fractional while it steps back)
const slot = (d) => { const s = 1 - d * G.shrink, w = G.w * s, h = G.h * s; return { x: G.x + (G.w - w) / 2, y: G.y - d * G.step, w, h, r: G.r * s, rot: 0 }; };
// the pile: loose spots around the middle, each screen its own size and a little turned
const SPOTS = view === "desktop"
  ? [[0.3, 0.36], [0.68, 0.32], [0.5, 0.6], [0.25, 0.66], [0.75, 0.64], [0.42, 0.3], [0.6, 0.48], [0.36, 0.52], [0.7, 0.5], [0.48, 0.42]]
  : [[0.4, 0.28], [0.6, 0.62], [0.45, 0.5], [0.62, 0.3], [0.36, 0.7], [0.55, 0.42], [0.42, 0.36], [0.6, 0.55], [0.48, 0.64], [0.5, 0.46]];
for (const [k, c] of chaos.entries()) {
  const portrait = c.aspect < 1;
  const w = view === "desktop" ? (portrait ? H * (0.58 + rnd() * 0.12) * c.aspect : W * (0.3 + rnd() * 0.1)) : (portrait ? H * (0.42 + rnd() * 0.1) * c.aspect : W * (0.62 + rnd() * 0.14));
  const h = w / c.aspect;
  c.pose = { x: SPOTS[k][0] * W - w / 2, y: SPOTS[k][1] * H - h / 2, w, h, r: 14, rot: (rnd() - 0.5) * 8 };
}

// ---- the page ----------------------------------------------------------------------------------------
const mark = fs.readFileSync(path.join(ROOT, "docs/rounds-mark.svg"), "utf8");
const mono = `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, "public/fonts/GeistMono-Variable.woff2")).toString("base64")}`;
const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Geist Mono"; src: url(${mono}) format("woff2"); font-weight: 100 900; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: url(${pathToFileURL(paper).href}) center / cover; -webkit-font-smoothing: antialiased; }
  .it { position: absolute; overflow: hidden; background: #fbfbfa; box-shadow: 0 1px 2px rgba(21,24,29,0.07), 0 14px 44px rgba(21,24,29,0.12), inset 0 0 0 1px rgba(21,24,29,0.05); transform-origin: center; }
  .it img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .it .w { position: absolute; inset: 0; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; font-weight: 600; letter-spacing: -0.045em; color: rgba(21,24,29,0.9); white-space: nowrap; line-height: 1; }
  .it .p { position: absolute; inset: 0; opacity: 0; background: #f5f4f0; }
  .it .c { position: absolute; inset: 0; opacity: 0; }
  .lock { position: absolute; inset: 0; display: grid; place-items: center; }
  .lock > div { display: grid; justify-items: center; }
  .lock .mk svg { width: 100%; height: 100%; display: block; }
  .lw { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; font-weight: 600; letter-spacing: -0.045em; color: rgba(21,24,29,0.9); line-height: 1; white-space: nowrap; }
  .quiet { color: #9aa2ad; }
  .npx { font-family: "Geist Mono", ui-monospace, monospace; color: #5d6570; letter-spacing: 0; }
</style>
<div class="lock" style="opacity:0"><div id="lk">
  <div class="mk" style="width:${G.m}px;height:${G.m}px;margin-bottom:${G.m * 0.26}px">${mark}</div>
  <div class="lw name" style="font-size:${G.name}px">Rounds</div>
  <div class="lw sub quiet" style="font-size:${G.sub}px;letter-spacing:-0.03em;margin-top:${G.sub * 0.42}px">For Claude Code.</div>
  <div class="npx" style="font-size:${G.npx}px;margin-top:${G.npx * 1.25}px">npx github:krispuckett/rounds</div>
</div></div>`;
const page_ = path.join(TMP, "stack.html");
fs.writeFileSync(page_, html);

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(page_).href);
await page.evaluate(() => document.fonts.ready);
// the mark's three discs, where the lockup puts them
const mk = await page.evaluate(() => { const r = document.querySelector(".mk").getBoundingClientRect(); return { x: r.x, y: r.y, s: r.width / 64 }; });
const disc = (cy, r) => ({ x: mk.x + (32 - r) * mk.s, y: mk.y + (cy - r) * mk.s, w: 2 * r * mk.s, h: 2 * r * mk.s, r: r * mk.s, rot: 0 });
const DISCS = [{ ...disc(42, 20), color: "#3f6fe0" }, { ...disc(30.5, 19), color: "#15181d" }, { ...disc(20, 18), color: "#8d96a3" }];
// words as big as one line can be on a sheet
const fit = await page.evaluate(({ texts, size, max }) => {
  const out = {}, e = document.createElement("span");
  e.className = "lw"; e.style.fontSize = `${size}px`; e.style.position = "absolute"; document.body.append(e);
  for (const t of texts) { e.textContent = t; out[t] = size * Math.min(1, max / e.getBoundingClientRect().width); }
  e.remove(); return out;
}, { texts: segs.filter((s) => s.words).map((s) => s.words), size: G.words, max: G.w * 0.84 });

// ---- frame by frame ------------------------------------------------------------------------------------
const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", "60", "-c:v", "png", "-i", "-", "-i", SCORE,
  "-map", "0:v", "-map", "1:a", "-af", "equalizer=f=70:t=q:w=0.9:g=-4,equalizer=f=2800:t=q:w=0.8:g=5,equalizer=f=9000:t=q:w=1:g=-2,alimiter=limit=0.89:level=false",
  "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "60", "-c:a", "aac", "-b:a", "256k", "-shortest", "-movflags", "+faststart", OUT], { stdio: ["pipe", "inherit", "inherit"] });
const cdp = await page.context().newCDPSession(page);

const endSeg = segs[segs.length - 1];
const FOLD0 = endSeg.start - 8, FOLD1 = endSeg.start + 6; // the fold lands just after the impact

for (let f = 0; f < TOTAL; f++) {
  const items = []; // { key, pose, z, img?, words?, color?, colorMix, opacity, bright }
  const i = segs.findIndex((s) => f >= s.start && f < s.start + s.n);
  const t = f - segs[i].start;
  if (i === 0) {
    // the pile
    for (const [k, c] of chaos.entries()) {
      if (f < c.at) continue;
      const p = easeOut((f - c.at) / 5), s = mix(1.18, 1, p);
      const q = c.pose, w = q.w * s, h = q.h * s;
      items.push({ key: `c${k}`, pose: { x: q.x + (q.w - w) / 2, y: q.y + (q.h - h) / 2 + mix(-26, 0, p), w, h, r: q.r, rot: q.rot }, z: 10 + k, img: c.src, opacity: Math.min(1, (f - c.at + 1) / 3) });
    }
  } else {
    // the stack: the sheet landing now, and the ones it pushes back
    const end = i === segs.length - 1;
    const p = end ? 1 : easeOut(t / LAND);
    const lastI = end ? i - 1 : i; // during the end, nothing new lands
    const depth = (j) => (end ? lastI - j : j === i ? 0 : i - 1 - j + p);
    for (let j = Math.max(1, lastI - 4); j <= lastI; j++) {
      const s = segs[j], d = depth(j);
      if (d > 3.7) continue;
      let pose = slot(d);
      if (j === i && !end) pose = { ...pose, y: pose.y + (1 - p) * H * 0.92 };
      const k = j === i ? t : s.n - 1;
      items.push({ key: `s${j}`, pose, z: 100 + j, img: s.frame ? s.frame(k) : null, words: s.words, wordsAt: s.words ? k / s.n : 0, opacity: d > 3 ? 1 - (d - 3) / 0.7 : 1, tint: 0.9 * Math.min(1, d) });
    }
    // the pile settles into the stack behind the first sheet: its last three screens step into
    // place as sheets the shots then push back, the rest fall away
    const k2 = i === 1 ? easeInOut(t / 12) : 1;
    for (const [k, c] of chaos.entries()) {
      const back = chaos.length - 1 - k; // 0 for the last to land
      if (back > 2) {
        if (i === 1 && t < 12) items.push({ key: `c${k}`, pose: { ...c.pose, y: c.pose.y + k2 * 40 }, z: 10 + k, img: c.src, opacity: 1 - k2 });
        continue;
      }
      const d = (end ? lastI - 1 : i - 1 + p) + back;
      if (d > 3.7) continue;
      const to = slot(d);
      const pose = { x: mix(c.pose.x, to.x, k2), y: mix(c.pose.y, to.y, k2), w: mix(c.pose.w, to.w, k2), h: mix(c.pose.h, to.h, k2), r: mix(c.pose.r, to.r, k2), rot: mix(c.pose.rot, 0, k2) };
      items.push({ key: `c${k}`, pose, z: 50 + k, img: c.src, opacity: d > 3 ? 1 - (d - 3) / 0.7 : 1, tint: 0.9 * Math.min(1, d) * k2 });
    }
  }
  // the fold: the top three sheets become the mark's discs, front to back
  let lockOpacity = 0, lockT = f - endSeg.start;
  if (f >= FOLD0) {
    const k = easeInOut((f - FOLD0) / (FOLD1 - FOLD0)), cm = easeInOut((f - FOLD0) / (FOLD1 - FOLD0 - 4));
    const top = segs.length - 2; // the last sheet
    const keep = [];
    for (const it of items) {
      const j = Number(it.key.slice(1)), d = it.key[0] === "s" ? top - j : 9;
      if (d > 2) continue;
      const D = DISCS[d], from = slot(d);
      it.pose = { x: mix(from.x, D.x, k), y: mix(from.y, D.y, k), w: mix(from.w, D.w, k), h: mix(from.h, D.h, k), r: mix(from.r, D.r, Math.min(1, k * 1.4)), rot: 0 };
      it.color = D.color; it.colorMix = cm; it.tint = (it.tint || 0) * (1 - cm);
      it.opacity = f > FOLD1 + 2 ? Math.max(0, 1 - (f - FOLD1 - 2) / 4) : 1;
      if (it.opacity > 0) keep.push(it);
    }
    items.length = 0; items.push(...keep);
    lockOpacity = f > FOLD1 ? Math.min(1, (f - FOLD1) / 4) : 0;
  }
  await page.evaluate(({ items, fit, lockOpacity, lockT, B, G }) => {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.key);
      let e = document.getElementById(it.key);
      if (!e) {
        e = document.createElement("div"); e.id = it.key; e.className = "it";
        if (it.img) { const m = document.createElement("img"); e.append(m); }
        if (it.words) { const w = document.createElement("div"); w.className = "w"; const s = document.createElement("span"); s.textContent = it.words; w.append(s); e.append(w); }
        const pp = document.createElement("div"); pp.className = "p"; e.append(pp);
        const c = document.createElement("div"); c.className = "c"; e.append(c);
        document.body.append(e);
      }
      const p = it.pose;
      Object.assign(e.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, height: `${p.h}px`, borderRadius: `${p.r}px`, transform: `rotate(${p.rot}deg)`, zIndex: String(it.z), opacity: String(it.opacity ?? 1) });
      e.querySelector(".p").style.opacity = String(it.tint || 0);
      const img = e.querySelector("img");
      if (img && it.img && img.getAttribute("src") !== it.img) img.setAttribute("src", it.img);
      const w = e.querySelector(".w span");
      if (w) { const s = p.w / G.w; w.style.fontSize = `${fit[it.words] * s}px`; w.style.display = "inline-block"; w.style.transform = `scale(${1 + 0.03 * it.wordsAt})`; }
      const c = e.querySelector(".c");
      c.style.background = it.color || "transparent"; c.style.opacity = String(it.colorMix || 0);
    }
    for (const e of [...document.querySelectorAll(".it")]) if (!seen.has(e.id)) e.remove();
    // the lockup: the mark in place of the discs, then the name, what it's for, how to get it
    const lock = document.querySelector(".lock");
    lock.style.opacity = lockOpacity > 0 ? "1" : "0";
    if (lockOpacity > 0) {
      const ease = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
      document.querySelector(".mk").style.opacity = String(lockOpacity);
      const rise = (el, at) => { const t = ease((lockT - at) / 16); el.style.opacity = String(Math.min(1, Math.max(0, (lockT - at) / 10))); el.style.transform = `translateY(${18 * (1 - t)}px)`; el.style.filter = `blur(${6 * (1 - t) * (1 - t)}px)`; };
      rise(document.querySelector(".name"), 2 * B); rise(document.querySelector(".sub"), 4 * B); rise(document.querySelector(".npx"), 6 * B);
    }
    return Promise.all([...document.querySelectorAll(".it img")].map((m) => (m.complete && m.naturalWidth ? null : m.decode().catch(() => null))));
  }, { items, fit, lockOpacity, lockT, B, G });
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  if (!ff.stdin.write(Buffer.from(data, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % 100 === 0) process.stdout.write(`${f}/${TOTAL} `);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
await browser.close();
console.log(`\n${view} ${(TOTAL / 60).toFixed(2)} s ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
