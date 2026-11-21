// A file a session changed, opened from its sheet on the canvas: the sheet grows into a page that
// holds every change the session made to that file, first to last, each with its lines. The
// session's other files are a step away with the arrows.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadEdits, when, type Edit } from "./data";
import { fileDir, fileName, type FilesSheet } from "./Cluster";
import { Btn, type Rect } from "./Stage";
import { Glyph } from "./glyphs";
import { reducedMotion } from "./look";
import { closeEase, openPath } from "./motion";

export type FileOpening = { sheet: FilesSheet; i: number; from: Rect };

const pageRect = (): Rect => {
  const w = Math.min(1040, innerWidth - 2 * 64), h = innerHeight - 40 - 112;
  return { x: Math.round((innerWidth - w) / 2), y: 40, w, h };
};
const lines = (n: number) => String(n); // no thousands comma: in mono it takes a whole cell
const MINUS = "−";

export function FileStage({ opening, onSession, onClosing, onClose }: {
  opening: FileOpening; onSession: (id: string) => void; onClosing?: () => void; onClose: () => void;
}) {
  const { sheet } = opening;
  const [i, setI] = useState(opening.i);
  const row = sheet.rows[i];
  const repos = new Set(sheet.rows.map((r) => r.repo)).size;
  const [edits, setEdits] = useState<Edit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [rect, setRect] = useState(pageRect);
  const [closing, setClosing] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [was] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    dialog.current?.focus({ preventScroll: true });
    return () => { requestAnimationFrame(() => { if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true }); }); };
  }, []);
  useEffect(() => { const r = () => setRect(pageRect()); addEventListener("resize", r); return () => removeEventListener("resize", r); }, []);

  useEffect(() => {
    let on = true;
    setEdits(null); setFailed(false);
    loadEdits(sheet.thread, row.repo, row.file).then((e) => { if (on) { setEdits(e); body.current?.scrollTo({ top: 0 }); } }, () => on && setFailed(true));
    return () => { on = false; };
  }, [i]);

  // The sheet grows into the page. The card stretches as it grows, so the page inside it is
  // held at its own size against the stretch: the words never distort, and the growing card
  // uncovers them from its corner. Both move by the same points in time, so they stay in step.
  const grow = useRef<Animation[]>([]);
  const inner = useRef<HTMLDivElement>(null);
  type Pose = { dx: number; dy: number; sx: number; sy: number };
  const poseOf = (r: Rect): Pose => ({ dx: r.x - rect.x, dy: r.y - rect.y, sx: r.w / rect.w, sy: r.h / rect.h });
  const fly = (a: Pose, b: Pose, path: (u: number) => number, duration: number, ra: number, rb: number, fill: FillMode = "none") => {
    const N = 30, lerp = (x: number, y: number, p: number) => x + (y - x) * p;
    const frames: Keyframe[] = [], words: Keyframe[] = [];
    for (let k = 0; k <= N; k++) {
      const p = path(k / N), sx = lerp(a.sx, b.sx, p), sy = lerp(a.sy, b.sy, p), r = lerp(ra, rb, p);
      frames.push({ offset: k / N, transform: `translate(${lerp(a.dx, b.dx, p)}px, ${lerp(a.dy, b.dy, p)}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px` });
      words.push({ offset: k / N, transform: `scale(${1 / sx}, ${1 / sy})` });
    }
    return [box.current!.animate(frames, { duration, easing: "linear", fill }), inner.current!.animate(words, { duration, easing: "linear", fill })];
  };
  useLayoutEffect(() => {
    const as = reducedMotion()
      ? [box.current!.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" })]
      : fly(poseOf(opening.from), { dx: 0, dy: 0, sx: 1, sy: 1 }, openPath, 560, 10, 14);
    grow.current = as;
    return () => as.forEach((a) => a.cancel());
  }, []);

  // Back into the sheet, wherever it lies on the canvas now, from wherever the card is.
  const close = (then?: () => void) => {
    if (closing) return;
    setClosing(true);
    onClosing?.();
    const el = document.querySelector(`[data-sheet="${sheet.key}"]`) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    const to = r ? { x: r.left, y: r.top, w: r.width, h: r.height } : opening.from;
    const m = new DOMMatrix(getComputedStyle(box.current!).transform);
    const back = closeEase(grow.current[0] || null);
    grow.current.forEach((a) => a.cancel());
    const as = reducedMotion()
      ? [box.current!.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "ease-in", fill: "forwards" })]
      : fly({ dx: m.e, dy: m.f, sx: m.a, sy: m.d }, poseOf(to), back.path, back.duration, 14, 10, "forwards");
    as[0].onfinish = () => { onClose(); then?.(); };
  };
  const step = (d: number) => { const j = Math.max(0, Math.min(sheet.rows.length - 1, i + d)); if (j !== i && !closing) setI(j); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [i, closing]);

  return (
    <div ref={dialog} role="dialog" aria-modal="true" aria-label={`${row.file}, ${sheet.title}`} tabIndex={-1} className="outline-none">
      <div className="fixed inset-0" onClick={() => close()} />

      <div
        ref={box}
        className="fixed overflow-hidden bg-[#fbfbfa]"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: 14, transformOrigin: "0 0", boxShadow: "var(--shadow-stage), inset 0 0 0 0.5px rgba(21,24,29,0.12)" }}
      >
        <div ref={inner} className="flex flex-col" style={{ width: rect.w, height: rect.h, transformOrigin: "0 0" }}>
        <div className="shrink-0 px-8 pb-4 pt-6" style={{ animation: closing ? "wb-fade-out 110ms ease-in 300ms both" : "wb-fade-in 220ms var(--ease-out) 40ms both", boxShadow: "inset 0 -0.5px 0 rgba(21,24,29,0.12)" }}>
          <div className="flex items-baseline gap-3">
            <span className="min-w-0 truncate text-[20px] font-[600] tracking-[-0.02em] text-[var(--ink)]">{fileName(row.file)}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--quiet)]">{fileDir(row, repos)}</span>
            {!!row.add && <span className="type-mono shrink-0 text-[13px] text-[var(--muted)]">+{lines(row.add)}</span>}
            {!!row.del && <span className="type-mono shrink-0 text-[13px] text-[var(--quiet)]">{MINUS}{lines(row.del)}</span>}
          </div>
          {!!row.also.length && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[var(--muted)]">
              <span className="text-[var(--quiet)]">Also changed by</span>
              {row.also.map((a) => (
                <button key={a.id} type="button" className="flex min-w-0 items-center gap-1.5 transition-colors duration-150 hover:text-[var(--ink)]" onClick={() => close(() => onSession(a.id))}>
                  <Glyph name="comment" size={13} className="shrink-0" />
                  <span className="max-w-[320px] truncate">{a.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={body} className="min-h-0 flex-1 overflow-auto px-8 pb-10 pt-2" style={{ animation: closing ? "wb-fade-out 110ms ease-in 300ms both" : "wb-fade-in 220ms var(--ease-out) 60ms both" }}>
          {failed && <p className="pt-6 text-[14px] text-[var(--muted)]">These changes couldn't be read.</p>}
          {edits?.map((e, k) => <Change key={`${i}-${k}`} e={e} />)}
        </div>
        </div>
      </div>

      <div
        className="glass fixed bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full p-1.5"
        style={{ animation: closing ? "wb-down 300ms var(--ease-out) both" : "wb-up 520ms var(--ease-fly) 160ms both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 pl-4 pr-3">
          <span className="type-card max-w-[340px] truncate">{sheet.title}</span>
          <span className="type-mono text-[var(--muted)]">{sheet.rows.length > 1 ? `${i + 1} of ${sheet.rows.length}` : when(row.last)}</span>
        </div>
        {sheet.rows.length > 1 && (
          <>
            <Btn onClick={() => step(-1)} label="Previous file" disabled={i === 0}><span style={{ opacity: i === 0 ? 0.3 : 1 }}><Glyph name="back" /></span></Btn>
            <Btn onClick={() => step(1)} label="Next file" disabled={i === sheet.rows.length - 1}><span style={{ opacity: i === sheet.rows.length - 1 ? 0.3 : 1 }}><Glyph name="next" /></span></Btn>
          </>
        )}
        <Btn onClick={() => close()} label="Close"><Glyph name="close" /></Btn>
        <style>{`@keyframes wb-up { from { opacity: 0; transform: translateY(16px) } } @keyframes wb-down { to { opacity: 0; transform: translateY(12px) } } @keyframes wb-fade-in { from { opacity: 0 } } @keyframes wb-fade-out { to { opacity: 0 } }`}</style>
      </div>
    </div>
  );
}

// One change: when it came and what it did, then its lines. Added lines sit on a wash of the
// accent, lines taken out are set back; each line carries its number in the file. A new file is
// all new: its lines stand plain, as the file.
function Change({ e }: { e: Edit }) {
  const d = new Date(e.at);
  const at = `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return (
    <section className="pt-6">
      <div className="mb-2 flex items-baseline gap-3 text-[13px]">
        <span className="font-[560] text-[var(--ink)]">{e.created ? "New file" : at}</span>
        {e.created && <span className="text-[var(--quiet)]">{at}</span>}
        {!e.created && !!e.add && <span className="type-mono text-[var(--muted)]">+{lines(e.add)}</span>}
        {!e.created && !!e.del && <span className="type-mono text-[var(--quiet)]">{MINUS}{lines(e.del)}</span>}
        {e.created && <span className="type-mono text-[var(--muted)]">{lines(e.add)} lines</span>}
      </div>
      <div className="overflow-x-auto rounded-[8px] py-1.5" style={{ background: "rgba(28,25,20,0.025)", boxShadow: "inset 0 0 0 0.5px rgba(28,25,20,0.08)" }}>
        <div className="min-w-max">
          {e.hunks.map((h, k) => {
            let o = h.o, n = h.n;
            return (
              <div key={k} style={k ? { marginTop: 6, paddingTop: 6, boxShadow: "inset 0 0.5px 0 rgba(28,25,20,0.08)" } : undefined}>
                {h.lines.map((l, j) => {
                  const mark = e.created ? " " : l[0], text = l.slice(1);
                  const num = e.created ? n++ : mark === "-" ? (h.o ? o++ : "") : mark === "+" ? (h.n ? n++ : "") : (h.n ? (o++, n++) : "");
                  return (
                    <div
                      key={j}
                      className="flex font-[family-name:var(--font-mono)] text-[12px] leading-[19px]"
                      style={{ fontVariantLigatures: "none", background: mark === "+" ? "var(--honey-wash)" : mark === "-" ? "rgba(28,25,20,0.05)" : "transparent", color: mark === "-" ? "var(--muted)" : "var(--ink)" }}
                    >
                      <span className="w-12 shrink-0 select-none pr-3 text-right text-[var(--quiet)]">{num}</span>
                      <span className="w-4 shrink-0 select-none text-[var(--quiet)]">{mark === " " ? "" : mark === "-" ? MINUS : mark}</span>
                      <span className="whitespace-pre pr-6">{text || " "}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!!e.cut && <div className="px-16 pt-1.5 text-[12px] text-[var(--quiet)]">{lines(e.cut)} more lines</div>}
        </div>
      </div>
    </section>
  );
}
