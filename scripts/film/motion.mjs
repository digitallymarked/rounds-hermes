// Every transition on the canvas, one clip each, for judging motion: the real demo canvas at 60
// fps, each frame exactly 1/60 s after the last (frame.mjs), the whole window, no camera moves.
// Run against a demo server of its own (it lands posts and leaves a note):
//   FILM_URL=http://localhost:4810 FILM_HOME=<that server's demo folder> node scripts/film/motion.mjs <out dir> [clip names]
import path from "node:path";
import { openCanvas } from "./frame.mjs";
import { holdBack, land, heldNote, reply, LANDS, FIX } from "./stage.mjs";

const URL = process.env.FILM_URL || "http://localhost:4810";
const HOME = process.env.FILM_HOME;
const [OUT] = process.argv.slice(2);
const only = process.argv.slice(3);
const W = 1440, H = 900;

await holdBack(HOME, URL);
land(HOME, Date.now() - 600e3, FIX); // the fix is there from the start: the pair to compare
const note = heldNote(HOME);
const { browser, page, film } = await openCanvas({ url: `${URL}/`, width: W, height: H, scale: 2 });

let k = 0;
async function take(name, n, fn = async () => {}) {
  const num = String(++k).padStart(2, "0");
  const on = !only.length || only.includes(name);
  film.cam = { x: 0, y: 0, w: W };
  if (on) film.start(path.join(OUT, `${num}-${name}.mp4`), W, H);
  const shoot = on;
  // counted here: a take not being filmed still runs, and the film counts only what it keeps
  let ticks = 0;
  const tick = film.tick.bind(film);
  film.tick = (o) => { ticks++; return tick(o); };
  try { await fn(shoot); while (ticks < n) await film.tick({ shoot }); } finally { film.tick = tick; }
  if (on) console.log(num, name, await film.stop());
}
const off = (n) => film.wait(n, { shoot: false });
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
const zoom = () => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".origin-top-left.will-change-transform")).transform).a);
async function goTo(get, z, at = { x: W / 2, y: H / 2 }) {
  await page.keyboard.press("0");
  await off(50);
  const r = await get();
  await film.place(r.cx, r.cy);
  await film.pinch(z / (await zoom()), 24, (t) => t);
  await off(6);
  const after = await get();
  await film.pan(after.cx, after.cy, at.x, at.y, 12);
  await off(60);
}
const roadTop = async () => { const r = await textRect("The Road"); return { ...r, cy: r.cy + r.h * 3 }; };
// a steady hand: n frames of motion along an eased path, pointer held down the whole way
async function drag(from, to, n, ease = (t) => t, shoot = true) {
  await film.place(from.x, from.y);
  await page.mouse.down();
  await film.tick({ shoot });
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    await film.place(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await film.tick({ shoot });
  }
  await page.mouse.up();
}
const inOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---- the canvas -------------------------------------------------------------------------
await page.reload({ waitUntil: "load" });
await take("first-view", 90);

await off(40);
await film.pointer(true);
{
  const r = await textRect("The Road");
  await film.place(r.cx, r.cy + 120);
  await take("pinch-in", 60, () => film.pinch(2.6, 22));
  await take("fit-all", 60, () => page.keyboard.press("0"));
}
await take("pan-space-drag", 60, async (shoot) => {
  await page.keyboard.down(" ");
  await drag({ x: 900, y: 500 }, { x: 500, y: 440 }, 9, (t) => t, shoot);
  await page.keyboard.up(" ");
});
await page.keyboard.press("0");
await off(60);

// ---- a screen ---------------------------------------------------------------------------
const T20 = byHash("748b844aa29dbab6");
await goTo(() => rect(T20), 0.42, { x: W * 0.34, y: H * 0.58 });
{
  const t = await rect(T20);
  await film.place(t.cx, t.cy);
  await take("screen-open", 60, () => film.click(2));
  await off(20);
  await take("screen-next", 70, () => page.keyboard.press("ArrowRight"));
  await take("screen-back", 70, () => page.keyboard.press("ArrowLeft"));
  await take("screen-close", 50, () => page.keyboard.press("Escape"));
  await off(30);
  // opened, and closed again before it lands
  await take("screen-turnaround", 60, async (shoot) => {
    await film.click(2);
    await film.wait(10, { shoot });
    await page.keyboard.press("Escape");
  });
  await off(40);
}

// ---- before and after ----------------------------------------------------------------------
await goTo(() => rect(byHash("ab0657546ad996c9")), 0.42, { x: W * 0.42, y: H * 0.5 });
{
  const pair = await rect(byHash("ab0657546ad996c9"));
  await film.place(pair.cx, pair.cy);
  await film.click(4);
  await off(60);
  const handle = await rect('[aria-valuetext^="Before shown"]');
  const box = await stageBox();
  await take("compare-drag", 80, (shoot) => drag({ x: handle.cx, y: handle.cy }, { x: box.x + box.w * 0.72, y: handle.cy + 20 }, 36, inOut, shoot));
  await take("compare-drag-back", 50, (shoot) => drag({ x: box.x + box.w * 0.72, y: handle.cy + 20 }, { x: box.x + 6, y: handle.cy + 10 }, 14, (t) => t, shoot));
  await take("compare-space", 80, async (shoot) => {
    await page.keyboard.down(" ");
    await film.wait(40, { shoot });
    await page.keyboard.up(" ");
  });
  await page.keyboard.press("Escape");
  await off(40);
}

// ---- a note ----------------------------------------------------------------------------
await goTo(roadTop, 0.42, { x: W * 0.42, y: H * 0.42 });
{
  const rohan = await rect(byHash("e11a04d093b56d46"));
  if (rohan.cy > H * 0.8 || rohan.cy < 0) await film.pan(rohan.cx, rohan.cy, rohan.cx, H * 0.5, 10);
  const r2 = await rect(byHash("e11a04d093b56d46"));
  await film.place(r2.cx, r2.cy);
  await film.click(4);
  await off(60);
  await page.keyboard.press("c");
  await off(4);
  const box = await stageBox();
  const at = { x: box.x + note.x * box.w, y: box.y + note.y * box.h };
  await film.place(at.x + 70, at.y + 50);
  await take("note-pin", 50, async () => { await film.move(at.x, at.y, 7); await film.click(4); });
  for (const ch of note.text) { await page.keyboard.type(ch); await film.tick({ shoot: false }); }
  await take("note-send", 50, () => page.keyboard.press("Enter"));
  await film.move(at.x + 70, at.y + 90, 8);
  const pin = await rect('[aria-label^="Note 1"]');
  await film.move(pin.cx + 3, pin.cy + 3, 10);
  await film.pollIn(8);
  const id = await page.evaluate(() => fetch("/api/comments").then((r) => r.json())).then((all) => all.filter((c) => c.page === "shot-e11a04d093b56d46").pop().id);
  await reply(HOME, id, note.reply.text);
  await take("note-answer", 70);
  await page.keyboard.press("Escape");
  await off(40);
}

// ---- new work lands ----------------------------------------------------------------------
await goTo(roadTop, 0.42, { x: W * 0.42, y: H * 0.42 });
await film.pointer(false);
await film.afterStamp();
land(HOME, await page.evaluate(() => Date.now()), LANDS);
await film.pollIn(6);
await take("new-work-lands", 170);

// ---- one session, and its files --------------------------------------------------------------
await page.keyboard.press("0");
await off(60);
await take("search-open", 40, () => page.keyboard.press("/"));
await page.keyboard.type("Murmur");
await off(20);
await take("session-only", 100, () => page.keyboard.press("Enter"));
await off(30);
await goTo(() => rect("[data-sheet]"), 1.3);
{
  const row = await page.evaluate(() => {
    const b = [...document.querySelectorAll("[data-sheet] button")].find((x) => /^README\.md,/.test(x.getAttribute("aria-label") || "")) || document.querySelector("[data-sheet] button");
    const r = b.getBoundingClientRect(); return { cx: r.x + r.width * 0.3, cy: r.y + r.height / 2 };
  });
  await film.pointer(true);
  await film.place(row.cx, row.cy);
  await take("file-open", 90, () => film.click(3));
  await off(20);
  await take("file-close", 60, () => page.keyboard.press("Escape"));
  await off(20);
  await film.pointer(false);
  await take("session-all", 90, () => page.keyboard.press("Escape"));
}

// ---- the timeline ------------------------------------------------------------------------
await page.reload({ waitUntil: "load" });
await film.settle(150);
await take("timeline-open", 80, () => page.keyboard.press("t"));
await take("day-back", 70, () => page.keyboard.press("ArrowLeft"));
await take("day-forward", 70, () => page.keyboard.press("ArrowRight"));
{
  const rail = await rect('[role="slider"][aria-label="Day"]');
  await film.pointer(true);
  // a quick drag down the rail, let go while moving: it carries on and lands on a day
  await take("rail-flick", 90, (shoot) => drag({ x: rail.cx, y: H * 0.35 }, { x: rail.cx, y: H * 0.35 + 140 }, 8, (t) => t, shoot));
  await film.place(rail.cx, H * 0.45);
  // two fingers down the rail, steady, then still
  await take("rail-scroll", 90, async (shoot) => {
    for (let i = 0; i < 36; i++) { await film.wheel(-8); await film.tick({ shoot }); }
  });
  // up past today, and let go
  await page.keyboard.press("ArrowRight"); await off(10);
  for (let i = 0; i < 40; i++) { await page.keyboard.press("ArrowRight"); await off(2); }
  await off(60);
  await take("rail-past-today", 70, (shoot) => drag({ x: rail.cx, y: H * 0.5 }, { x: rail.cx, y: H * 0.5 - 160 }, 16, inOut, shoot));
}
await film.pointer(false);
await take("timeline-close", 80, () => page.keyboard.press("Escape"));

// a group's title in the timeline: the canvas narrows to that session
await page.reload({ waitUntil: "load" });
await film.settle(150);
await page.keyboard.press("t");
await off(70);
{
  const title = await page.evaluate(() => {
    const a = [...document.querySelectorAll(".will-change-transform a, .will-change-transform button")].find((e) => e.textContent.trim().startsWith("Rohan and the Pelennor"));
    const t = a.querySelector("span").getBoundingClientRect();
    return { cx: t.x + t.width * 0.45, cy: t.y + t.height / 2 };
  });
  await film.pointer(true);
  await film.place(title.cx, title.cy);
  await take("timeline-group-tap", 100, () => film.click(3));
}

await browser.close();
