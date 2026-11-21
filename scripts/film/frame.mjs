// The filming rig: opens the canvas in headless Chrome with a fake clock, and steps it one frame
// at a time. Shots (shots.mjs) script the pointer and keys frame by frame; each frame is piped
// straight into ffmpeg, so nothing is dropped and every frame is 1/60 s after the last.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const DT = 1000 / 60;

export async function openCanvas({ url, width, height, scale = 2 }) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--use-angle=metal", "--enable-gpu-rasterization", "--hide-scrollbars"] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await context.clock.install({ time: Date.now() });
  await context.addInitScript({ path: path.join(HERE, "rig.js") });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(url, { waitUntil: "networkidle" });
  await context.clock.pauseAt(Date.now() + 500);
  const film = new Film(page, cdp, context.clock, width, height, scale);
  // the canvas asks the server what's new every 3 s of its own time: the film counts the asks
  page.on("request", (r) => { if (r.url().includes("/api/stamp")) film.stamps++; });
  return { browser, page, film };
}

export class Film {
  constructor(page, cdp, clock, width, height, scale) {
    Object.assign(this, { page, cdp, clock, width, height, scale, cam: { x: 0, y: 0, w: width }, camMove: null, out: null, frames: 0, stamps: 0, seenStamps: 0, sinceStamp: 0, mouse: { x: width / 2, y: height / 2 } });
  }
  // one frame of time: timers and animation frames, then every transition, then the picture
  async tick({ shoot = true } = {}) {
    await this.clock.runFor(DT);
    await this.page.evaluate((dt) => window.__filmStep(dt), DT);
    // let fetches, image decodes and React's commits land before the picture
    await new Promise((r) => setTimeout(r, 12));
    // frames since the canvas last asked the server for news (it asks every 180)
    if (this.stamps !== this.seenStamps) { this.seenStamps = this.stamps; this.sinceStamp = 0; } else this.sinceStamp++;
    this.stepCam();
    if (shoot && this.out) {
      const clip = this.clip();
      // a capture through the camera leaves Chrome reading wheel distances at one pixel to one
      this.cropped = !!clip.clip;
      const { data } = await this.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, ...clip });
      const buf = Buffer.from(data, "base64");
      if (!this.out.stdin.write(buf)) await new Promise((r) => this.out.stdin.once("drain", r));
      this.frames++;
    }
  }
  // The camera: a window onto the page, its width in CSS pixels, captured at the full size, so a
  // push in renders the page sharper rather than enlarging pixels.
  clip() {
    const { x, y, w } = this.cam;
    // the whole window too goes through a clip: asked without one, Chrome hands back one pixel per point
    return { clip: { x, y, width: w, height: (w * this.height) / this.width, scale: (this.scale * this.width) / w } };
  }
  // ease the camera to frame a box (cx, cy at the centre, w wide), over n frames
  camTo(cx, cy, w, n = 60, ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)) {
    const h = (w * this.height) / this.width;
    const to = { x: Math.min(Math.max(0, cx - w / 2), this.width - w), y: Math.min(Math.max(0, cy - h / 2), this.height - h), w };
    this.camMove = { from: { ...this.cam }, to, n, i: 0, ease };
  }
  camHome(n = 60, ease) { this.camTo(this.width / 2, this.height / 2, this.width, n, ease); }
  stepCam() {
    const m = this.camMove;
    if (!m) return;
    m.i++;
    const t = m.ease(Math.min(1, m.i / m.n));
    // the width eases in log space so the zoom reads even; the centre travels with it
    const w = Math.exp(Math.log(m.from.w) + (Math.log(m.to.w) - Math.log(m.from.w)) * t);
    const H = this.height / this.width;
    const c0 = { x: m.from.x + m.from.w / 2, y: m.from.y + (m.from.w * H) / 2 }, c1 = { x: m.to.x + m.to.w / 2, y: m.to.y + (m.to.w * H) / 2 };
    const cx = c0.x + (c1.x - c0.x) * t, cy = c0.y + (c1.y - c0.y) * t;
    this.cam = { x: Math.min(Math.max(0, cx - w / 2), this.width - w), y: Math.min(Math.max(0, cy - (w * H) / 2), this.height - w * H), w };
    if (m.i >= m.n) this.camMove = null;
  }
  async wait(n, opts) { for (let i = 0; i < n; i++) await this.tick(opts); }
  // warm up without filming: let the canvas settle
  async settle(n = 60) { await this.wait(n, { shoot: false }); }

  // the pointer glides to a point, easing in and out, over n frames
  async move(x, y, n = 40, ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)) {
    const a = { ...this.mouse };
    // a gentle arc, the way a hand moves a pointer
    const bend = Math.min(80, Math.hypot(x - a.x, y - a.y) * 0.12);
    const nx = -(y - a.y), ny = x - a.x, len = Math.hypot(nx, ny) || 1;
    for (let i = 1; i <= n; i++) {
      const t = ease(i / n), arc = Math.sin(Math.PI * t) * bend;
      const px = a.x + (x - a.x) * t + (nx / len) * arc, py = a.y + (y - a.y) * t + (ny / len) * arc;
      await this.page.mouse.move(px, py);
      this.mouse = { x: px, y: py };
      await this.tick();
    }
  }
  // run on unseen until the canvas has just asked for news; the next ask is 180 frames away
  async afterStamp() {
    const n = this.stamps;
    while (this.stamps === n) await this.tick({ shoot: false });
    await new Promise((r) => setTimeout(r, 150));
  }
  // run on unseen until the next ask for news is n frames away
  async pollIn(n) {
    while ((180 - this.sinceStamp + 180) % 180 !== n % 180) await this.tick({ shoot: false });
  }
  // a pinch on the trackpad, about the pointer: the canvas zooms by f over n frames
  async pinch(f, n, ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)) {
    const total = -Math.log(f) / 0.012;
    let done = 0;
    await this.page.keyboard.down("Control");
    for (let i = 1; i <= n; i++) {
      const want = total * ease(i / n), dy = want - done;
      done = want;
      // the page sees wheel distances divided by the pixel density
      await this.wheel(dy);
      await this.tick();
    }
    await this.page.keyboard.up("Control");
  }
  // a scroll of dy CSS pixels, as the page will see it
  wheel(dy, dx = 0) { const k = this.cropped ? 1 : this.scale; return this.page.mouse.wheel(dx * k, dy * k); }
  // a two-finger pan that brings a point on screen to another, eased over n frames
  async pan(fromX, fromY, toX, toY, n = 1, shoot = false) {
    let sx = 0, sy = 0;
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
    for (let i = 1; i <= n; i++) {
      const gx = (fromX - toX) * ease(i / n), gy = (fromY - toY) * ease(i / n);
      await this.wheel(gy - sy, gx - sx);
      sx = gx; sy = gy;
      await this.tick({ shoot });
    }
  }
  pointer(show) { return this.page.evaluate((v) => { window.__filmPointer.off = !v; window.__filmPointer.update(); }, show); }
  // the camera framing a rect (CSS pixels) with a margin, at the window's proportions
  frame(r, margin = 1.15) {
    const w = Math.min(this.width, Math.max(r.w * margin, (r.h * margin * this.width) / this.height));
    const h = (w * this.height) / this.width;
    return { x: Math.min(Math.max(0, r.x + r.w / 2 - w / 2), this.width - w), y: Math.min(Math.max(0, r.y + r.h / 2 - h / 2), this.height - h), w };
  }
  rect(selector) {
    return this.page.evaluate((sel) => { const e = typeof sel === "string" ? document.querySelector(sel) : null; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }, selector);
  }
  async place(x, y) { await this.page.mouse.move(x, y); this.mouse = { x, y }; }
  async click(hold = 5) {
    await this.page.mouse.down();
    await this.wait(hold);
    await this.page.mouse.up();
    await this.tick();
  }
  async type(text, every = 3) {
    for (const ch of text) { await this.page.keyboard.type(ch); await this.wait(every); }
  }
  async key(k, after = 1) { await this.page.keyboard.press(k); await this.wait(after); }

  start(file, outW, outH) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.frames = 0;
    this.out = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "png", "-framerate", "60", "-i", "-",
      "-vf", `scale=${outW}:${outH}:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", "10", "-pix_fmt", "yuv420p", "-r", "60", file], { stdio: ["pipe", "inherit", "inherit"] });
    return this;
  }
  async stop() {
    const p = this.out; this.out = null;
    p.stdin.end();
    await new Promise((r) => p.on("close", r));
    return this.frames;
  }
  async still(file) {
    // at the page's own density: asked without a clip, Chrome hands back one pixel per point
    const { data } = await this.cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: this.width, height: this.height, scale: this.scale } });
    // and after a capture through a clip, Chrome reads wheel distances at one pixel to one
    this.cropped = true;
    fs.writeFileSync(file, Buffer.from(data, "base64"));
  }
}
