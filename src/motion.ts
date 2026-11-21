// Easings the viewers share: a spring that can start at a speed, and a close that knows how fast
// the opening it interrupts was going.

// A critically damped spring as an easing: it leaves gently, never overshoots, and settles
// without a long crawl. `response` is Apple's: roughly how long the move takes, in seconds. `v0`
// is the speed it starts at, in progress per second: below zero, it is still going the other way,
// so it slows, turns and comes back.
export function spring(response: number, ms: number, v0 = 0, n = 48) {
  const f = springPath(response, ms, v0);
  const pts = Array.from({ length: n + 1 }, (_, k) => f(k / n).toFixed(4));
  return typeof CSS !== "undefined" && CSS.supports("transition-timing-function", "linear(0, 1)") ? `linear(${pts.join(", ")})` : "cubic-bezier(0.33, 0, 0.2, 1)";
}
// the same spring as progress over time: u from 0 to 1 across `ms`
export function springPath(response: number, ms: number, v0 = 0) {
  const w = (2 * Math.PI) / response;
  const f = (t: number) => 1 - (1 + (w - v0) * t) * Math.exp(-w * t), end = f(ms / 1000);
  return (u: number) => f((ms / 1000) * u) / end;
}

// Where a cubic-bezier easing is at time fraction x, and how fast it is moving there.
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s, dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  const Y = (s: number) => ((ay * s + by) * s + cy) * s, dY = (s: number) => (3 * ay * s + 2 * by) * s + cy;
  return (x: number) => {
    let lo = 0, hi = 1, s = x;
    for (let i = 0; i < 24; i++) {
      const e = X(s) - x;
      if (Math.abs(e) < 1e-6) break;
      if (e > 0) hi = s; else lo = s;
      const d = dX(s);
      s = Math.abs(d) > 1e-6 ? s - e / d : (lo + hi) / 2;
      if (s <= lo || s >= hi) s = (lo + hi) / 2;
    }
    return { p: Y(s), rate: dY(s) / (dX(s) || 1e-6) };
  };
}

export const OPEN = "cubic-bezier(0.3, 0.7, 0.1, 1)";
const open = bezier(0.3, 0.7, 0.1, 1);
const CLOSE = "cubic-bezier(0.4, 0, 0.2, 1)";
const close = bezier(0.4, 0, 0.2, 1);
// the opening and the usual close as progress over time, for keyframes that move more than one
// thing in step
export const openPath = (u: number) => open(u).p;

// How a card goes back to the canvas. At rest: the usual close. Still flying open (closed
// mid-flight), it carries on the way it was going for a moment, then turns and comes back, the
// way a thing in the hand would, instead of stopping dead and starting over.
export function closeEase(opening: Animation | null, openMs = 560): { easing: string; duration: number; path: (u: number) => number } {
  const usual = { easing: CLOSE, duration: 420, path: (u: number) => close(u).p };
  const t = opening && opening.playState !== "finished" && opening.currentTime != null ? Number(opening.currentTime) / openMs : 1;
  if (!(t > 0 && t < 1)) return usual;
  const { p, rate } = open(t);
  if (p < 0.02) return usual;
  // the opening moves the card a fraction p of the way out; going back covers that same p, so
  // its speed in the close's own terms is the opening's, over p, the other way
  const v0 = -(rate / (openMs / 1000)) / p;
  return { easing: spring(0.42, 520, v0), duration: 520, path: springPath(0.42, 520, v0) };
}
