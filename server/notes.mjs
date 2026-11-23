// What a note is, who it belongs to, and what has already been said about it.
// Shared by the Claude hook (hooks/notes.mjs), the Hermes hook (hooks/hermes.mjs) and the Hermes
// relay (server/relay.mjs), so all three agree on one rule: a note is delivered once.
//
// A note's life: the canvas writes it to comments.json and (when it goes by the relay) to inbox/.
// Whoever delivers it writes sent/<id>.json and removes the inbox file:
//   delivery "delivered"  the relay put it in the session (the session ran a turn on it)
//   delivery "hook"       the session's next turn brought it in (the fallback)
//   delivery "waiting"    the session is mid-turn (or another note is going first); nothing was sent yet
//   delivery "queued"     the relay is carrying it right now
//   delivery "failed"     the relay could not deliver it; the inbox file stays
import fs from "node:fs";
import path from "node:path";
import { DATA, POSTS, STORE, loadConfig } from "./config.mjs";

export const INBOX = path.join(DATA, "inbox");
export const SENT = path.join(DATA, "sent");
export const RELAY_STATE = path.join(DATA, "relay.json");

export const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
export const sentOf = (id) => read(path.join(SENT, `${id}.json`), null);

/** Written atomically: a reader (the canvas, a hook) never sees half a file. */
export function writeSent(id, record) {
  fs.mkdirSync(SENT, { recursive: true });
  const f = path.join(SENT, `${id}.json`);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, f);
}
export const dropInbox = (id) => { try { fs.unlinkSync(path.join(INBOX, `${id}.json`)); } catch {} };

/** True while a relay process says it is alive (it touches relay.json every few seconds). */
export function relayAlive(now = Date.now()) {
  const s = read(RELAY_STATE, null);
  if (!s || now - s.at > 15e3) return false;
  try { process.kill(s.pid, 0); return true; } catch { return false; }
}

/** Should the next-turn fallback leave this note alone? */
export function covered(c, now = Date.now()) {
  const s = sentOf(c.id);
  if (s) {
    if (s.delivery === "failed") return false;              // nobody delivered it: the fallback may
    if (s.delivery === "queued") return now - (s.at || 0) < 180e3; // the relay is on it (or died 3 minutes ago)
    if (s.delivery === "waiting") return relayAlive(now);          // the relay is holding it for a busy session; if it died, the fallback may
    return true;                                            // delivered / hook / anything older
  }
  if (c.state === "sent") return true;
  const inbox = path.join(INBOX, `${c.id}.json`);
  if (!fs.existsSync(inbox)) return false;
  // sitting in the inbox of a live Hermes relay: it is about to go
  if (relayAlive(now)) return true;
  // the Claude desktop relay (config "relay": true) writes no heartbeat; its notes are its own for five minutes
  if (loadConfig().relay === true) { try { return now - fs.statSync(inbox).mtimeMs < 5 * 60e3; } catch { return false; } }
  return false;
}

export function world() {
  const comments = read(path.join(DATA, "comments.json"), []);
  const index = read(path.join(DATA, "index.json"), { threads: [], sets: [], pages: [] });
  let posts = [];
  try { posts = fs.readdirSync(POSTS).filter((f) => f.endsWith(".json")).map((f) => read(path.join(POSTS, f), null)).filter(Boolean); } catch {}
  return { comments, index: { threads: [], sets: [], pages: [], ...index }, posts };
}

export const postOf = (w, c) => w.posts.find((p) => (p.shots || []).some((s) => s.hash === c.hash) || (p.page && c.hash === p.page.hash));

/** The session that made the work a note is on: the post's own record (the tool hook writes it),
 *  or what the canvas has since traced it to. Never guessed from the folder. */
export const madeBy = (w, c) => postOf(w, c)?.session
  || (w.index.sets || []).find((x) => x.thread && x.shots.some((s) => s.hash === c.hash))?.thread
  || (w.index.pages || []).find((x) => x.thread && x.versions.some((v) => v.hash === c.hash))?.thread;

export const targetOf = (w, c) => c.thread || madeBy(w, c) || null;

/** The Hermes profile a note's session lives in (recorded at post time), if known. */
export const profileOf = (w, c) => postOf(w, c)?.profile || null;

/** Notes still waiting for a delivery, for the fallback path. */
export function waitingNotes(w, now = Date.now()) {
  return w.comments.filter((c) => !c.reply && !covered(c, now));
}

/** Session ids a note may be addressed to for a session: itself, plus any desktop thread it runs. */
export const sessionIds = (w, session) =>
  new Set([session, ...w.index.threads.filter((t) => (t.clis || []).includes(session)).map((t) => t.id)]);

/** Where on the work the note was pinned, in words an agent can act on. */
export function whereOf(w, c) {
  const p = postOf(w, c);
  const shot = p?.shots?.find((s) => s.hash === c.hash);
  return shot
    ? `on the screen ${path.join(STORE, "img", `${shot.hash}.${shot.ext}`)} (${shot.w}x${shot.h}), pinned at x ${Math.round(c.x * shot.w)}, y ${Math.round(c.y * shot.h)}`
    : `on the page ${path.join(STORE, `${c.hash}.html`)}, pinned at x ${Math.round(c.x)}, y ${Math.round(c.y)} on the page at 1280 wide`;
}

/** The context the fallback adds to a session's next message. */
export function fallbackContext(w, notes) {
  const lines = notes.map((c) => {
    const p = postOf(w, c);
    return `- Note ${c.id}: "${c.text}" ${whereOf(w, c)}${p ? `, from your post "${p.caption}"` : ""}.`;
  });
  return [
    `The user left ${notes.length === 1 ? "a note" : `${notes.length} notes`} on your work in Rounds:`,
    ...lines,
    "Treat each as a request about that screen. Look at it (crop around the pinned point), act on it, then answer with rounds_reply and the note's id.",
  ].join("\n");
}

/**
 * The message the relay sends a session: the shape in relay/RELAY.md, with the note's id and the
 * reply instruction added (a Hermes session has no Rounds skill telling it what to do next).
 * `n` is the inbox JSON.
 */
export function relayMessage(n, { dataDir = DATA } = {}) {
  const tail = `\nNote id: ${n.id}. Act on it, then answer with rounds_reply and that id.`;
  if (n.kind === "screen") {
    return [
      `The user commented on a screen you showed them in Rounds: ${n.text}`,
      "",
      `The screen: ${n.image} (${n.w}x${n.h}), pinned at x ${n.px}, y ${n.py} (crop around that point to see it).`,
      `You showed it with: "${n.caption ?? ""}"`,
    ].join("\n") + tail;
  }
  return [
    `The user commented on "${n.pageTitle ?? ""}" in Rounds: ${n.text}`,
    "",
    `Version ${n.version} of ${n.versions}, pinned at x ${Math.round(n.x)}, y ${Math.round(n.y)} on the page at 1280px wide.`,
    `What he was looking at: ${n.snapshot}`,
    `Rendered: ${path.join(dataDir, "shots", `${n.hash}-full.png`)} (crop around that point to see it)`,
    `Page: ${n.pageUrl ?? ""}`,
  ].join("\n") + tail;
}
