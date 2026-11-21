// The ad's footage: short takes of the real demo canvas, each exactly a beat or two long (a beat
// is 25 frames at 144 bpm), with the camera close on what happens. The cut (ad-cut.py) lays them
// on the beat between the words.
//   FILM_HOME=<the film server's demo folder> node scripts/film/ad.mjs <desktop|phone> <out dir> [take names]
import path from "node:path";
import { openCanvas } from "./frame.mjs";
import { holdBack, land, heldNote, reply, FIX } from "./stage.mjs";

const URL = process.env.FILM_URL || "http://localhost:4805";
const HOME = process.env.FILM_HOME;
const [view = "desktop", OUT] = process.argv.slice(2);
const only = process.argv.slice(4);
const VIEWS = {
  desktop: { width: 1440, height: 810, scale: 2, out: [1920, 1080] },
  phone: { width: 864, height: 1080, scale: 2.5, out: [1080, 1350] },
};
const V = VIEWS[view];
const B = 25; // frames in a beat

await holdBack(HOME, URL);
const note = heldNote(HOME);
const { browser, page, film } = await openCanvas({ url: `${URL}/`, width: V.width, height: V.height, scale: V.scale });

const rect = (sel) => film.rect(sel);
const byHash = (h) => `[data-key$="-${h}"]`;
const textRect = (t) => page.evaluate((t) => {
  const e = [...document.querySelectorAll(".will-change-transform div, .will-change-transform span")].find((x) => x.childElementCount === 0 && x.textContent === t);
  const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
}, t);
const stageBox = () => page.evaluate(() => {
  const e = [...document.querySelectorAll("div")].find((d) => d.style.boxShadow === "var(--shadow-stage)");
  const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
// the canvas's zoom, read off the world's own transform (the dock no longer shows a percent)
const zoom = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".origin-top-left.will-change-transform")).transform).a);
// off camera: everything in view first, then in on a thing (get() finds it) to a zoom, brought
// to a place on screen, and the screens given time to load sharp
async function goTo(get, z, at = { x: V.width / 2, y: V.height / 2 }) {
  await page.keyboard.press("0");
  await film.wait(50, { shoot: false });
  const r = await get();
  await film.place(r.cx, r.cy);
  await film.pinch(z / (await zoom()), 24, (t) => t);
  await film.wait(6, { shoot: false });
  const after = await get();
  await film.pan(after.cx, after.cy, at.x, at.y, 12);
  await film.wait(40, { shoot: false });
}
const roadTop = async () => { const r = await textRect("The Road"); return { ...r, cy: r.cy + r.h * 3 }; };

// a take: exactly n frames, the camera where it's put
const takes = [];
async function take(name, n, fn) {
  const filming = !only.length || only.includes(name);
  if (filming) film.start(path.join(OUT, `${view}-ad-${name}.mp4`), ...V.out);
  const start = film.frames;
  await fn();
  while (film.frames - start < n && filming) await film.tick();
  if (!filming) { /* nothing */ }
  if (filming) { const f = await film.stop(); takes.push([name, f]); console.log(view, name, f); }
  film.camMove = null;
  film.cam = { x: 0, y: 0, w: V.width };
}
// ticks inside a take: filmed only when the take is
const tick = () => film.tick();
// the camera keeps moving through a take: a slow push to k of its width, centred where it is
const push = (k, n) => { const c = film.cam, H = (c.w * V.height) / V.width; film.camTo(c.x + c.w / 2, c.y + H / 2, c.w * k, n, (t) => t); };

await film.settle(90);
await film.afterStamp();
await film.pointer(false);

// F0, four beats: from close on Shadowfax under the volcano to the whole canvas. The canvas loads
// the screens around what's in view each time it comes to rest, so it rests once halfway out,
// where every screen is in reach and loads sharp, then goes in and starts back out without
// stopping: the whole canvas is all there when it shows. (Rested close in, screens far from
// the start never load.)
{
  // The Road, far from the site's profile card, which is
  // too small to read by the time it comes into frame
  const START = byHash("a29cbbc3a2052734");
  await page.keyboard.press("0");
  await film.wait(50, { shoot: false });
  await film.place(V.width / 2, V.height / 2);
  // first, where the start sits in the whole canvas as the end shows it: far out, the project
  // names and their activity strips grow, so it's measured there, everything that's drawn
  await film.pinch(0.17 / (await zoom()), 12, (t) => t);
  await film.wait(4, { shoot: false });
  const d = await page.evaluate((sel) => {
    const rs = [...document.querySelectorAll(".origin-top-left.will-change-transform *")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    const s = document.querySelector(sel).getBoundingClientRect();
    return { x: s.x + s.width / 2 - (Math.min(...rs.map((r) => r.left)) + Math.max(...rs.map((r) => r.right))) / 2, y: s.y + s.height / 2 - (Math.min(...rs.map((r) => r.top)) + Math.max(...rs.map((r) => r.bottom))) / 2 };
  }, START);
  await film.pinch(0.55 / (await zoom()), 20, (t) => t);
  for (let i = 0; i < 400; i++) {
    await film.tick({ shoot: false });
    if (i > 40 && (await page.evaluate(() => [...document.querySelectorAll("[data-key] img")].every((m) => m.complete && m.naturalWidth > 0 && m.style.opacity === "1")))) break;
  }
  console.log(view, "screens loaded before the reveal:", await page.evaluate(() => document.querySelectorAll("[data-key] img").length), "of", await page.evaluate(() => document.querySelectorAll("[data-key]").length));
  // bring it to the middle (it can sit off screen halfway out), then in about it
  await film.place(V.width / 2, V.height / 2);
  const s0 = await rect(START);
  await film.pan(s0.cx, s0.cy, V.width / 2, V.height / 2, 10);
  const c0 = await rect(START);
  await film.place(c0.cx, c0.cy);
  await film.pinch((view === "phone" ? 1.3 : 1.1) / (await zoom()), 20, (t) => t);
  const s1 = await rect(START);
  await film.pan(s1.cx, s1.cy, V.width / 2, V.height / 2, 10);
  // the zoom out turns about the one point that ends with the start where it was measured and
  // so the whole canvas centred (about the start itself, the canvas ended far to one side)
  const k = 0.17 / (await zoom());
  await film.place(V.width / 2 + d.x / (1 - k), V.height * 0.47 + d.y / (1 - k));
  // from the last scroll to the first of the pinch out is under the canvas's 180 ms rest
  await take("reveal", 4 * B, async () => {
    await film.wait(6);
    await film.pinch(0.17 / (await zoom()), 4 * B - 12, (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2));
  });
}

// F1, a beat: the newest Road post lands, lit
{
  await goTo(roadTop, view === "phone" ? 0.5 : 0.42, { x: V.width * 0.42, y: V.height * 0.42 });
  await film.afterStamp();
  land(HOME, (await page.evaluate(() => Date.now())) - 2000);
  await film.pollIn(5);
  const r = await textRect("The Road");
  film.cam = film.frame({ x: r.x - 20, y: r.y - 10, w: r.w * 3.4, h: r.h * 6.5 }, 1.05);
  push(0.93, B);
  await take("lands", B, async () => {});
}

// F2 to F4, a beat each: the work up close, the camera drifting
// keepRight: the frame stops just past the screen's right edge, so the neighbour there stays out
async function drift(name, hash, z, dx = 0.08, keepRight = false) {
  await goTo(() => rect(byHash(hash)), z);
  const s = await rect(byHash(hash));
  const a = film.frame({ x: s.x, y: s.y, w: s.w, h: s.h }, 1.25);
  if (keepRight) a.x = s.x + s.w * 1.02 - a.w;
  film.cam = a;
  film.camTo(a.x + a.w / 2 + a.w * dx, a.y + a.w * (V.height / V.width) / 2, a.w * 0.93, B, (t) => t);
  await take(name, B, async () => {});
}
// the sunset's right-hand neighbour is the site's profile card, with its words: kept out of frame
await drift("sky", "c090c3510b86a43d", 0.9, -0.06, true);
await drift("dawn", "1debfdc9003ef0a5", 0.9, -0.08);
await drift("night", "21205856b3f603cb", 0.9);

// F5, a beat: the Top 20 creator flies open; F6, two beats: a step to its phone screen, the
// desktop folding into the phone
{
  const T20 = byHash("748b844aa29dbab6");
  await goTo(() => rect(T20), view === "phone" ? 0.5 : 0.42, { x: V.width * 0.34, y: V.height * 0.58 });
  const t = await rect(T20);
  await film.place(t.cx + 60, t.cy + 40);
  await film.pointer(true);
  await film.place(t.cx, t.cy);
  await film.click(2);
  await film.wait(2, { shoot: false });
  await film.pointer(false);
  await take("open", B, async () => {});
  await film.wait(30, { shoot: false });
  film.cam = { x: 0, y: 0, w: V.width };
  push(0.95, 2 * B);
  await take("morph", 2 * B, async () => {
    await film.wait(5);
    await page.keyboard.press("ArrowRight");
    await tick();
  });
  await page.keyboard.press("Escape");
  await film.wait(40, { shoot: false });
}

// F7, a beat: a pin drops on Shadowfax; F8, two beats: the note's last words, and it's sent
let pinAt;
{
  await goTo(roadTop, view === "phone" ? 0.5 : 0.42, { x: V.width * 0.42, y: V.height * 0.42 });
  await film.pointer(true);
  const rohan = await rect(byHash("e11a04d093b56d46"));
  if (rohan.cy > V.height * 0.8 || rohan.cy < 0) await film.pan(rohan.cx, rohan.cy, rohan.cx, V.height * 0.5, 10);
  const r2 = await rect(byHash("e11a04d093b56d46"));
  await film.place(r2.cx, r2.cy);
  await film.click(4);
  await film.wait(60, { shoot: false });
  await page.keyboard.press("c");
  await film.wait(4, { shoot: false });
  const box = await stageBox();
  pinAt = { x: box.x + note.x * box.w, y: box.y + note.y * box.h };
  await film.place(pinAt.x + 70, pinAt.y + 50);
  film.cam = film.frame({ x: pinAt.x - 140, y: pinAt.y - 110, w: 520, h: 230 }, 1.0);
  push(0.94, B);
  await take("pin", B, async () => {
    await film.move(pinAt.x, pinAt.y, 7);
    await film.click(4);
  });
  // the first words written off camera, the last on it
  const cut = note.text.length - 40;
  for (const ch of note.text.slice(0, cut)) { await page.keyboard.type(ch); await film.tick({ shoot: false }); }
  await film.place(pinAt.x - 26, pinAt.y + 58);
  film.cam = film.frame({ x: pinAt.x - 60, y: pinAt.y - 70, w: 460, h: 160 }, 1.0);
  push(0.95, 2 * B);
  await take("note", 2 * B, async () => {
    for (const ch of note.text.slice(cut)) { await page.keyboard.type(ch); await tick(); }
    await film.wait(5);
    await page.keyboard.press("Enter");
    await tick();
  });
}

// F9, a beat: the answer comes back on the pin
{
  await film.move(pinAt.x + 70, pinAt.y + 90, 8, undefined);
  const pin = await rect('[aria-label^="Note 1"]');
  await film.move(pin.cx + 3, pin.cy + 3, 10);
  await film.pollIn(8);
  const id = await page.evaluate(() => fetch("/api/comments").then((r) => r.json())).then((all) => all.filter((c) => c.page === "shot-e11a04d093b56d46").pop().id);
  await reply(HOME, id, note.reply.text);
  film.cam = film.frame({ x: pin.x - 40, y: pin.y - 40, w: 420, h: 220 }, 1.0);
  push(0.94, B);
  await take("answer", B, async () => {});
}

// F10, two beats: the fix lands on the canvas off camera and opens, Shadowfax white
{
  await page.keyboard.press("Escape");
  await film.wait(40, { shoot: false });
  await goTo(roadTop, view === "phone" ? 0.5 : 0.42, { x: V.width * 0.42, y: V.height * 0.42 });
  await film.afterStamp();
  land(HOME, await page.evaluate(() => Date.now()), FIX);
  await film.pollIn(5);
  const r = await textRect("The Road");
  await film.wait(B + 60, { shoot: false });
  const pair = await rect(byHash("778cf7acce459ada"));
  await film.place(pair.cx, pair.cy);
  await film.click(4);
  await film.wait(50, { shoot: false });
  await film.pointer(false);
  const box = await stageBox();
  const a = film.frame({ x: box.x, y: box.y, w: box.w, h: box.h }, 1.03);
  film.cam = a;
  // lean toward the after
  film.camTo(box.x + box.w * 0.74, box.y + box.h * 0.6, box.w * 0.62, 2 * B - 4);
  await take("pair", 2 * B, async () => {});
  await page.keyboard.press("Escape");
  await film.wait(40, { shoot: false });
}

// F11, a beat: a search for Murmur; F12, two beats: the canvas holds only that session
{
  await page.keyboard.press("0");
  await film.wait(60, { shoot: false });
  await film.pointer(false);
  await page.keyboard.press("/");
  await film.wait(30, { shoot: false });
  await page.keyboard.type("Mu");
  await film.wait(12, { shoot: false });
  const box = await rect('[role="dialog"][aria-label="Search"]');
  film.cam = film.frame(box, 1.12);
  push(0.95, B);
  await take("find", B, async () => {
    await film.wait(3);
    for (const ch of "rmur") { await page.keyboard.type(ch); await film.wait(3); }
  });
  film.cam = { x: 0, y: 0, w: V.width };
  push(0.96, 2 * B);
  await take("alone", 2 * B, async () => {
    await page.keyboard.press("Enter");
    await tick();
  });
}

// F13, a beat: in close on its files sheet, a file tapped; F14, two beats: the sheet grows into
// the page of every change the session made to it
{
  await film.wait(40, { shoot: false });
  await goTo(() => rect("[data-sheet]"), view === "phone" ? 1.5 : 1.3, { x: V.width * 0.5, y: V.height * 0.5 });
  const sheet = await rect("[data-sheet]");
  const row = await page.evaluate(() => {
    const b = [...document.querySelectorAll("[data-sheet] button")].find((x) => /^README\.md,/.test(x.getAttribute("aria-label") || ""));
    const r = b.getBoundingClientRect(); return { cx: r.x + r.width * 0.3, cy: r.y + r.height / 2 };
  });
  await film.place(sheet.x + sheet.w * 0.75, sheet.y + sheet.h * 0.95);
  await film.pointer(true);
  await film.wait(10, { shoot: false });
  film.cam = film.frame(sheet, 1.2);
  push(0.95, B);
  // the press is on camera; it lets go after the cut, so the sheet grows in the next shot
  await take("sheet", B, async () => {
    await film.move(row.cx, row.cy, 18);
    await film.wait(3);
    await page.mouse.down();
  });
  await page.mouse.up();
  await film.tick({ shoot: false });
  await film.pointer(false);
  // in partway through the grow: the page is blank until it has its size, then the lines come in
  await film.wait(14, { shoot: false });
  film.cam = { x: 0, y: 0, w: V.width };
  // three beats: the ad uses the first two
  push(0.94, 3 * B);
  await take("page", 3 * B, async () => {});
  await film.wait(30, { shoot: false });
  await page.keyboard.press("Escape");
  await film.wait(40, { shoot: false });
  // and everyone's work back
  await page.keyboard.press("Escape");
  await film.wait(60, { shoot: false });
}

// F15, a beat: the canvas becomes today's sheet, the days before stacked behind it; F16, two
// beats: back a day on each beat; F17, a beat: a flick back through the months; F18, two beats:
// July, the Tour's whole day
{
  // the canvas as anyone opening it sees it: with the camera not yet moved, each earlier day is
  // fitted to the window (moved, the project in the middle holds its place and size instead)
  await page.reload({ waitUntil: "load" });
  await film.settle(150);
  await film.pointer(false);
  await take("stack", B, async () => {
    await page.keyboard.press("t");
    await tick();
  });
  await film.wait(30, { shoot: false });
  await take("days", 2 * B, async () => {
    await page.keyboard.press("ArrowLeft");
    await film.wait(B);
    await page.keyboard.press("ArrowLeft");
    await tick();
  });
  await film.wait(30, { shoot: false });
  const rail = await rect('[role="slider"][aria-label="Day"]');
  await film.place(rail.cx, V.height * 0.42);
  await film.tick({ shoot: false });
  const days = await page.evaluate((target) => {
    const shown = document.querySelector('[role="slider"][aria-label="Day"]').getAttribute("aria-valuetext").split(" ").slice(1).join(" ");
    return Math.round((new Date(`${shown} ${new Date().getFullYear()} 12:00`) - new Date(`${target} 12:00`)) / 864e5);
  }, process.env.FILM_JULY || "2026-07-05");
  console.log(view, "flick back", days, "days");
  await take("flick", B, async () => {
    const N = B - 2, px = days * 14, w = Array.from({ length: N }, (_, i) => Math.pow(1 - i / N, 1.6)), sum = w.reduce((a, b) => a + b, 0);
    let sent = 0, acc = 0;
    for (let i = 0; i < N; i++) { acc += w[i]; const goal = Math.round((acc / sum) * px); await film.wheel(-(goal - sent)); sent = goal; await tick(); }
  });
  // the day settles and its screens load sharp
  await film.wait(70, { shoot: false });
  console.log(view, "july is", await page.evaluate(() => document.querySelector('[role="slider"][aria-label="Day"]').getAttribute("aria-valuetext")));
  film.cam = { x: 0, y: 0, w: V.width };
  push(0.9, 2 * B);
  await take("july", 2 * B, async () => {});
}

// For the film of what's new in 1.1. F19, a beat: in the timeline, today's sheet, a group's title
// tapped; F20, two beats: the canvas narrows to that one session, landing on the group; F21,
// three beats: down through the session's whole history, newest first
{
  // a fresh canvas again: the timeline's sheet fitted to the window
  await page.reload({ waitUntil: "load" });
  await film.settle(150);
  await film.pointer(false);
  await page.keyboard.press("t");
  await film.wait(60, { shoot: false });
  const title = await page.evaluate(() => {
    const a = [...document.querySelectorAll(".will-change-transform a, .will-change-transform button")].find((e) => e.textContent.trim().startsWith("Rohan and the Pelennor"));
    const t = a.querySelector("span").getBoundingClientRect();
    return { x: t.x, y: t.y, w: t.width, h: t.height, cx: t.x + t.width * 0.45, cy: t.y + t.height / 2 };
  });
  const road = await textRect("The Road");
  await film.place(title.cx + 160, title.cy + 120);
  await film.pointer(true);
  await film.wait(10, { shoot: false });
  // close on The Road's column: its name, the title and the screens under it
  film.cam = film.frame({ x: road.x - 30, y: road.y - 20, w: Math.max(title.w * 2.2, road.w * 2.6), h: (title.y - road.y) + title.h * 9 }, 1.05);
  push(0.95, B);
  await take("tap", B, async () => {
    await film.move(title.cx, title.cy, 18);
    await film.wait(3);
    await page.mouse.down();
  });
  await page.mouse.up();
  await film.tick({ shoot: false });
  await film.pointer(false);
  await film.wait(4, { shoot: false });
  film.cam = { x: 0, y: 0, w: V.width };
  push(0.96, 2 * B);
  await take("focused", 2 * B, async () => {});
  await film.wait(20, { shoot: false });
  await film.place(V.width * 0.5, V.height * 0.5);
  await take("history", 3 * B, async () => {
    // a steady scroll down the session, easing in and out
    const N = 3 * B - 4, px = view === "phone" ? 1500 : 1250, e = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    let sent = 0;
    for (let i = 1; i <= N; i++) { const goal = Math.round(px * e(i / N)); await film.wheel(goal - sent); sent = goal; await tick(); }
  });
}

await browser.close();
