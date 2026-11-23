// Is a Hermes session in the middle of a turn? Asked from outside Hermes, read-only.
//
// Authoritative signal: Hermes keeps a durable per-conversation "turn lease" in state.db, table
// `session_turn_leases` (conversation_id, holder, acquired_at, expires_at). Every turn that runs
// the load-history -> run -> flush region (Desktop, CLI resume, gateway) takes it first and
// releases it at the end; a refresher renews it every 60 s while the turn lives (TTL 300 s).
// Sources in the installed Hermes (v0.23.3):
//   gateway/turn_lease.py / agent/turn_facade_lease.py  (LEASE_TTL_SECONDS = 300, refresh_tick)
//   persistence/sqlite/authority/coordination.py:261-300 (try_acquire / refresh / release)
//   persistence/sqlite/conversation/_store/compression.py:620 (key = lineage root: the session
//     reached by walking parent_session_id while the parent ended by "compression")
//   process_identity.py:145 (a "pid=<n>" holder whose pid is gone is reclaimable)
// So: busy  <=>  an unexpired lease row on the session or one of its compression ancestors whose
// holder process (pid=<n> in `holder`) is not provably dead.
//
// The lease may sit in the profile's state.db or in the default ~/.hermes/state.db (the host
// gateway owns turns for every profile), so both are read. Never written, never locked
// (readOnly connection; WAL readers do not block the writer).
//
// Fallback, only when the table does not exist (older Hermes): a conservative heuristic on the
// messages table: busy if the newest message is under 30 s old, or the newest message is a user
// or tool row (a turn that has not answered yet) under 120 s old. Documented in docs/hermes.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const hermesHome = () => process.env.ROUNDS_HERMES_HOME || path.join(os.homedir(), ".hermes");

/** state.db files that can hold this session's rows or its lease, profile first. */
export function dbPaths(profile) {
  const home = hermesHome();
  const own = profile && profile !== "default" ? path.join(home, "profiles", profile, "state.db") : path.join(home, "state.db");
  return [...new Set([own, path.join(home, "state.db")])].filter((f) => fs.existsSync(f));
}

let sqlite; // node:sqlite when this node has it; the sqlite3 CLI otherwise
async function driver() {
  if (sqlite === undefined) {
    try {
      const w = process.emitWarning; process.emitWarning = () => {}; // quiet the "experimental" notice
      try { sqlite = (await import("node:sqlite")).DatabaseSync; } finally { process.emitWarning = w; }
    } catch { sqlite = null; }
  }
  return sqlite;
}

/** Run read-only SQL with ? params; rows as objects. Throws on failure. */
async function query(file, sql, params = []) {
  const D = await driver();
  if (D) {
    const db = new D(file, { readOnly: true });
    try { db.exec("PRAGMA busy_timeout = 1500"); return db.prepare(sql).all(...params); } finally { db.close(); }
  }
  // CLI fallback: inline the params as SQL literals (ids and numbers only)
  let i = 0;
  const inlined = sql.replace(/\?/g, () => { const v = params[i++]; return typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`; });
  const out = execFileSync("sqlite3", ["-readonly", "-json", file, inlined], { encoding: "utf8", timeout: 5000 });
  return out.trim() ? JSON.parse(out) : [];
}

const pidDead = (holder) => {
  const m = /(?:^|:)pid=(\d+)(?::|$)/.exec(holder || "");
  if (!m) return false;                       // unstructured holder: wait for the TTL, like Hermes
  try { process.kill(Number(m[1]), 0); return false; } catch (e) { return e.code === "ESRCH"; }
};

/**
 * { busy, signal, reason, holder?, expires_at? }. `busy:false` also when the session is unknown
 * (hermes will say "Session not found" itself). A database that exists but cannot be read is
 * reported busy ("unreadable"), because guessing idle is the unsafe direction.
 */
export async function sessionBusy({ session, profile, now = Date.now }) {
  const t = now() / 1000;
  const files = dbPaths(profile);
  if (!files.length) return { busy: false, signal: "none", reason: "no Hermes state.db found" };
  try {
    // the session and its compression ancestors: the lease is keyed by the lineage root
    let ids = [session];
    let known = false, hasLeaseTable = false;
    for (const f of files) {
      const rows = await query(f,
        `WITH RECURSIVE chain(id, parent, n) AS (
           SELECT id, parent_session_id, 0 FROM sessions WHERE id = ?
           UNION ALL SELECT s.id, s.parent_session_id, n + 1 FROM sessions s JOIN chain c ON s.id = c.parent WHERE n < 64)
         SELECT id FROM chain`, [session]);
      if (rows.length) known = true;
      ids = [...new Set([...ids, ...rows.map((r) => r.id)])];
    }
    for (const f of files) {
      const tables = await query(f, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session_turn_leases'");
      if (!tables.length) continue;
      hasLeaseTable = true;
      const marks = ids.map(() => "?").join(",");
      const leases = await query(f, `SELECT holder, acquired_at, expires_at FROM session_turn_leases WHERE conversation_id IN (${marks}) AND expires_at > ?`, [...ids, t]);
      for (const l of leases) {
        if (pidDead(l.holder)) continue;      // died without releasing: Hermes reclaims it too
        return { busy: true, signal: "turn-lease", reason: `a turn has been running on this session since ${new Date(l.acquired_at * 1000).toISOString()}`, holder: l.holder, acquired_at: l.acquired_at, expires_at: l.expires_at };
      }
    }
    if (hasLeaseTable || !known) return { busy: false, signal: hasLeaseTable ? "turn-lease" : "none", reason: known ? "no live turn lease" : "session not in state.db" };
    // no lease table: heuristic on the newest message
    for (const f of files) {
      const [m] = await query(f, "SELECT role, timestamp FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1", [session]);
      if (!m) continue;
      const age = t - m.timestamp;
      if (age < 30) return { busy: true, signal: "recent-message", reason: `a message was written ${Math.round(age)} s ago` };
      if ((m.role === "user" || m.role === "tool") && age < 120) return { busy: true, signal: "unanswered-message", reason: `the last message is a ${m.role} row from ${Math.round(age)} s ago with no reply yet` };
    }
    return { busy: false, signal: "heuristic", reason: "no recent activity" };
  } catch (e) {
    return { busy: true, signal: "unreadable", reason: `could not read the Hermes state database (${String(e.message).split("\n")[0].slice(0, 120)})` };
  }
}
