// The Hermes relay: carries each note pinned on the canvas to the Hermes session that made the
// work, at once, with no Claude session and no one asking "check Rounds".
//
//   inbox/<id>.json  --(this process)-->  `hermes [-p profile] chat --resume <session> -Q -q <message>`
//
// `hermes chat --resume` runs one turn in the stored session: the note is a user message in that
// very conversation (same session id, rows appended to the profile's state.db), and the agent acts
// on it and answers with rounds_reply. Nothing is needed from the Hermes config but the MCP server.
//
// Contract (same files as the Claude relay in relay/RELAY.md, so the canvas needs nothing new):
//   sent/<id>.json   { delivery: "queued" | "delivered" | "failed", session, profile, at, ... }
//   inbox/<id>.json  removed on success; kept on failure so nothing is lost
//
// Delivered once, even across restarts: a note is claimed by writing sent/<id>.json "queued"
// BEFORE the turn starts. A relay that finds a "queued" claim it did not make, whose owner is gone,
// does not send again (the turn may have run); it marks it failed and says why. `rounds relay retry
// <id>` is the explicit way to send it again.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA, loadConfig } from "./config.mjs";
import { INBOX, RELAY_STATE, read, sentOf, writeSent, dropInbox, relayAlive, world, targetOf, profileOf, relayMessage } from "./notes.mjs";

const POLL_MS = 500;
const BEAT_MS = 5000;
const MAX_ATTEMPTS = 5;
const RETRY_S = [10, 30, 90, 300, 900];
const TURN_TIMEOUT_MS = 10 * 60e3;
const PERMANENT = /session not found|profile .* does not exist|no such file or directory|ENOENT/i;

const log = (...a) => console.log(`[rounds relay ${new Date().toISOString()}]`, ...a);

/** The command the relay runs, as { bin, args }. ROUNDS_HERMES_BIN overrides (tests, odd installs). */
export function hermesCommand({ profile, session, message }) {
  const bin = process.env.ROUNDS_HERMES_BIN || loadConfig().hermes?.bin || "hermes";
  return { bin, args: [...(profile ? ["-p", profile] : []), "chat", "--resume", session, "-Q", "-q", message] };
}

function run({ bin, args }) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const t = setTimeout(() => { p.kill("SIGTERM"); finish({ code: null, out, error: "the turn did not finish in 10 minutes" }); }, TURN_TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", (e) => { clearTimeout(t); finish({ code: null, out, error: `could not run ${bin}: ${e.message}` }); });
    p.on("close", (code) => { clearTimeout(t); finish({ code, out }); });
  });
}

const inflight = new Set();

/** Deliver one inbox file. Resolves to what happened: "delivered" | "failed" | "skipped". */
export async function deliver(id, { now = Date.now } = {}) {
  const file = path.join(INBOX, `${id}.json`);
  const n = read(file, null);
  if (!n || !n.id) return "skipped"; // half-written; the next poll reads it whole
  if (inflight.has(id)) return "skipped";

  const s = sentOf(id);
  if (s) {
    if (s.delivery === "delivered" || s.delivery === "hook") { dropInbox(id); return "skipped"; }
    if (s.delivery === "queued") {
      let ownerLive = false;
      if (s.pid) { try { process.kill(s.pid, 0); ownerLive = s.pid !== process.pid || inflight.has(id); } catch {} }
      if (ownerLive) return "skipped";
      writeSent(id, { ...s, delivery: "failed", permanent: true, at: now(), reason: "the relay stopped while this was being delivered; not sent again in case it arrived. Retry: rounds relay retry " + id });
      log(id, "claimed by a relay that is gone: marked failed, not re-sent");
      return "failed";
    }
    if (s.delivery === "failed") {
      if (s.permanent || (s.attempts || 0) >= MAX_ATTEMPTS || now() < (s.retryAt || 0)) return "skipped";
    }
  }

  const w = world();
  const session = targetOf(w, n);
  const attempts = (s?.attempts || 0) + 1;
  const fail = (reason, permanent = false) => {
    const retryAt = now() + RETRY_S[Math.min(attempts - 1, RETRY_S.length - 1)] * 1000;
    writeSent(id, { delivery: "failed", session: session || null, reason, attempts, permanent, at: now(), ...(permanent ? {} : { retryAt }) });
    log(id, "FAILED:", reason);
    return "failed";
  };
  if (!session) return fail("no session is tied to this work yet (it was not posted from a Hermes session with the Rounds hook)");
  const profile = profileOf(w, n) || process.env.ROUNDS_HERMES_PROFILE || loadConfig().hermes?.profile || null;

  inflight.add(id);
  const began = now();
  writeSent(id, { delivery: "queued", session, profile, at: began, pid: process.pid, attempts });
  log(id, "delivering to", session, profile ? `(profile ${profile})` : "");
  try {
    const r = await inLane(session, () => run(hermesCommand({ profile, session, message: relayMessage(n) })));
    const tail = String(r.out || "").trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300);
    if (r.error) return fail(r.error, PERMANENT.test(r.error));
    if (r.code !== 0 || /session not found/i.test(r.out || "")) return fail(tail || `hermes exited with ${r.code}`, PERMANENT.test(r.out || ""));
    writeSent(id, { delivery: "delivered", session, profile, at: now(), took_ms: now() - began, attempts });
    dropInbox(id);
    log(id, `delivered in ${now() - began} ms`);
    return "delivered";
  } finally { inflight.delete(id); }
}

/** One pass over the inbox, oldest first. */
export async function sweep() {
  let files = [];
  try { files = fs.readdirSync(INBOX).filter((f) => f.endsWith(".json")); } catch { return; }
  files.sort((a, b) => { try { return fs.statSync(path.join(INBOX, a)).mtimeMs - fs.statSync(path.join(INBOX, b)).mtimeMs; } catch { return 0; } });
  // not awaited: a long turn for one session must not hold up a note for another
  for (const f of files) deliver(f.replace(/\.json$/, "")).catch((e) => log(f, "error", e.message));
}

// Two notes for one session go one after the other: a session runs one turn at a time.
const lanes = new Map();
const inLane = (session, fn) => {
  const next = (lanes.get(session) || Promise.resolve()).then(fn, fn);
  lanes.set(session, next);
  next.finally(() => { if (lanes.get(session) === next) lanes.delete(session); });
  return next;
};

export function status() {
  const s = read(RELAY_STATE, null);
  return { alive: relayAlive(), ...(s || {}), inbox: (() => { try { return fs.readdirSync(INBOX).filter((f) => f.endsWith(".json")).length; } catch { return 0; } })() };
}

/** `rounds relay retry <id>`: forget a failed attempt so the running relay sends it again. */
export function retry(id) {
  const s = sentOf(id);
  if (!fs.existsSync(path.join(INBOX, `${id}.json`))) return `note ${id} is not in the inbox (already delivered?)`;
  if (s && s.delivery !== "failed") return `note ${id} is ${s.delivery}; only a failed note can be retried`;
  try { fs.unlinkSync(path.join(DATA, "sent", `${id}.json`)); } catch {}
  return `note ${id} will be sent again within a second if the relay is running`;
}

export async function start() {
  if (relayAlive() && read(RELAY_STATE, {}).pid !== process.pid) {
    log("a relay is already running (pid", read(RELAY_STATE, {}).pid + "); exiting");
    return process.exit(0);
  }
  fs.mkdirSync(INBOX, { recursive: true });
  const beat = () => { try { fs.writeFileSync(RELAY_STATE, JSON.stringify({ pid: process.pid, at: Date.now(), started: startedAt, data: DATA })); } catch {} };
  const startedAt = Date.now();
  beat();
  setInterval(beat, BEAT_MS).unref?.();
  const bye = () => { try { if (read(RELAY_STATE, {}).pid === process.pid) fs.unlinkSync(RELAY_STATE); } catch {} process.exit(0); };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, bye);
  log(`watching ${INBOX} (pid ${process.pid})`);

  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await sweep(); } finally { busy = false; } };
  try { fs.watch(INBOX, () => tick()); } catch {}
  setInterval(tick, POLL_MS);
  await tick();
}
