import { useEffect, useRef } from "react";

export type Cam = { x: number; y: number; z: number };
export const MIN_Z = 0.08;
export const MAX_Z = 2.4;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

// The camera writes straight to the page each frame through `apply`, never through React
// state, so a glide costs one transform, not a render of every card. Gestures move it with
// the hand. A glide is a critically damped spring (Apple's response 0.4, no overshoot): it
// leaves from whatever speed the camera already has, so it never starts with a jolt, and a
// new glide mid-flight bends the path rather than stopping it. A throw, after a drag, coasts
// the way a scroll view decelerates, from exactly the speed the hand let go at. Both run on
// elapsed time, so the feel holds at any frame rate. Zoom moves in log space so it reads even.
const RESPONSE = 0.4;
const W = (2 * Math.PI) / RESPONSE;
const STEP = 1 / 240;

export function useCamera(apply: (c: Cam, settled: boolean) => void) {
  const target = useRef<Cam>({ x: 0, y: 0, z: 0.3 });
  const cur = useRef<Cam>({ ...target.current });
  // speed: px/s across, log-zoom/s
  const vel = useRef({ x: 0, y: 0, z: 0 });
  // a throw's coast, in seconds; 0 for a spring glide
  const coast = useRef(0);
  const raf = useRef(0);
  const last = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  const tick = (now: number) => {
    let dt = Math.min(0.05, (now - (last.current || now)) / 1000 || 1 / 60);
    last.current = now;
    const t = target.current, v = vel.current;
    let x = cur.current.x, y = cur.current.y, lz = Math.log(cur.current.z);
    const tx = t.x, ty = t.y, tz = Math.log(t.z);
    while (dt > 1e-6) {
      const h = Math.min(STEP, dt);
      dt -= h;
      if (coast.current) {
        const k = Math.exp(-h / coast.current);
        const nx = tx + (x - tx) * k, ny = ty + (y - ty) * k, nz = tz + (lz - tz) * k;
        v.x = (nx - x) / h; v.y = (ny - y) / h; v.z = (nz - lz) / h;
        x = nx; y = ny; lz = nz;
      } else {
        v.x += (-W * W * (x - tx) - 2 * W * v.x) * h; x += v.x * h;
        v.y += (-W * W * (y - ty) - 2 * W * v.y) * h; y += v.y * h;
        v.z += (-W * W * (lz - tz) - 2 * W * v.z) * h; lz += v.z * h;
      }
    }
    const done = Math.abs(x - tx) < 0.3 && Math.abs(y - ty) < 0.3 && Math.abs(lz - tz) < 0.0008
      && Math.abs(v.x) < 30 && Math.abs(v.y) < 30 && Math.abs(v.z) < 0.03;
    if (done) { vel.current = { x: 0, y: 0, z: 0 }; coast.current = 0; }
    cur.current = done ? { ...t } : { x, y, z: Math.exp(lz) };
    applyRef.current(cur.current, done);
    raf.current = done ? 0 : requestAnimationFrame(tick);
  };
  const kick = () => {
    if (raf.current) return;
    last.current = 0;
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => { cancelAnimationFrame(raf.current); raf.current = 0; }, []);

  return {
    /** Move now, with the hand. */
    jump(next: Cam) {
      next = { ...next, z: clampZ(next.z) };
      target.current = next; cur.current = next;
      vel.current = { x: 0, y: 0, z: 0 }; coast.current = 0;
      cancelAnimationFrame(raf.current); raf.current = 0;
      applyRef.current(next, true);
    },
    /** Glide there, on a spring, from whatever speed the camera has now. */
    glide(next: Cam) {
      target.current = { ...next, z: clampZ(next.z) };
      coast.current = 0;
      kick();
    },
    /** Coast to a rest point from a drag let go: `seconds` is how quickly it slows. */
    throw(next: Cam, seconds: number) {
      target.current = { ...next, z: clampZ(next.z) };
      coast.current = seconds;
      kick();
    },
    get target() { return target.current; },
    get now() { return cur.current; },
  };
}

export function fit(rect: { x: number; y: number; w: number; h: number }, vw: number, vh: number, pad = 120): Cam {
  const z = clampZ(Math.min((vw - pad * 2) / rect.w, (vh - pad * 2) / rect.h));
  return { z, x: vw / 2 - (rect.x + rect.w / 2) * z, y: vh / 2 - (rect.y + rect.h / 2) * z };
}
