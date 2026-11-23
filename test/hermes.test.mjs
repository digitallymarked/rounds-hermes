// Rounds for Hermes: hook binding, relay delivery, failure, restart, fallback. Real processes, a
// throwaway ROUNDS_HOME per test, and a fake `hermes` CLI. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { sessionBusy } from "../server/busy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAKE = path.join(ROOT, "test/fixtures/fake-hermes.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = f(); if (v) return v; await sleep(50); } return null; };

function sandbox(mode = "ok") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-test-"));
  for (const d of ["posts", "inbox", "sent"]) fs.mkdirSync(path.join(home, d), { recursive: true });
  const log = path.join(home, "fake-hermes.log");
  const hh = path.join(home, "hermes-home");   // a stand-in ~/.hermes: profiles/engineer/state.db
  const env = { ...process.env, ROUNDS_HERMES_HOME: hh, ROUNDS_BUSY_RECHECK_MS: "250", ROUNDS_HOME: home, ROUNDS_HERMES_BIN: FAKE, FAKE_HERMES_LOG: log, FAKE_HERMES_MODE: mode };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const j = (f, v) => fs.writeFileSync(path.join(home, f), JSON.stringify(v));
  const rj = (f) => { try { return JSON.parse(fs.readFileSync(path.join(home, f), "utf8")); } catch { return null; } };
  const relay = () => { const p = spawn(process.execPath, [path.join(ROOT, "bin/rounds.mjs"), "relay"], { env, stdio: "ignore" }); return p; };
  const hook = (payload) => spawnSync(process.execPath, [path.join(ROOT, "hooks/hermes.mjs")], { env, input: JSON.stringify(payload), encoding: "utf8" });
  // a post made by a Hermes session, with one pinned note on a page
  const post = { id: "aaaaaaaaaaaaaaaa", kind: "page", caption: "Trial setup check: test page", topic: "Test", cwd: "/tmp", at: Date.now(), shots: [], page: { key: "k1", hash: "bbbbbbbbbbbbbbbb", path: "/tmp/p.html", title: "Test page" } };
  j("posts/aaaaaaaaaaaaaaaa.json", post);
  const note = { id: "n0te0001", page: "post-k1", hash: "bbbbbbbbbbbbbbbb", x: 100.4, y: 200.6, text: "make it blue", at: Date.now(), thread: null, state: "queued", route: "relay", pageTitle: "Test page", pageUrl: "", version: 1, versions: 1, snapshot: path.join(home, "store/bbbbbbbbbbbbbbbb.html") };
  j("comments.json", [note]);
  const ends = () => (fs.existsSync(log + ".end") ? fs.readFileSync(log + ".end", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { home, env, calls, ends, hh, j, rj, relay, hook, post, note };
}
const pin = (s, extra = {}) => s.j(`inbox/${s.note.id}.json`, { ...s.note, ...extra });
const bind = (s, session = "local-sess-1", profile = "engineer") => s.hook({
  hook_event_name: "post_tool_call", tool_name: "mcp__rounds__rounds_post", session_id: session, profile,
  extra: { result: `{"result":"Posted the page \\"Test page\\" to Rounds as post ${s.post.id}, under Studio."}` },
});
// Hermes' session_turn_leases table, as Hermes writes it (persistence/sqlite/_schema_ddl.py:377)
function state(s, profile = "engineer") {
  const f = path.join(s.hh, "profiles", profile, "state.db");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const db = new DatabaseSync(f);
  db.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, parent_session_id TEXT, end_reason TEXT);
           CREATE TABLE IF NOT EXISTS session_turn_leases (conversation_id TEXT PRIMARY KEY, holder TEXT NOT NULL, acquired_at REAL NOT NULL, expires_at REAL NOT NULL);`);
  const sql = (q, ...a) => db.prepare(q).run(...a);
  return {
    session: (id, parent = null) => sql("INSERT OR REPLACE INTO sessions (id, parent_session_id, end_reason) VALUES (?, ?, NULL)", id, parent),
    lease: (id, { pid = process.pid, ttl = 300 } = {}) => sql("INSERT OR REPLACE INTO session_turn_leases VALUES (?, ?, ?, ?)", id, `pid=${pid}:turn=${id}:platform=desktop`, Date.now() / 1000 - 5, Date.now() / 1000 + ttl),
    release: (id) => sql("DELETE FROM session_turn_leases WHERE conversation_id = ?", id),
    close: () => db.close(),
  };
}
const pin2 = (s, id, extra = {}) => s.j(`inbox/${id}.json`, { ...s.note, id, text: `note ${id}`, ...extra });
const stop = (p) => { try { p.kill("SIGTERM"); } catch {} };

test("post_tool_call binds the post to the Hermes session and profile", () => {
  const s = sandbox();
  bind(s);
  const p = s.rj("posts/aaaaaaaaaaaaaaaa.json");
  assert.equal(p.session, "local-sess-1");
  assert.equal(p.profile, "engineer");
  assert.equal(p.agent, "hermes");
  // an unrelated tool changes nothing
  const r = s.hook({ hook_event_name: "post_tool_call", tool_name: "terminal", session_id: "other", profile: "x", extra: { result: `post ${s.post.id}` } });
  assert.equal(r.status, 0);
  assert.equal(s.rj("posts/aaaaaaaaaaaaaaaa.json").session, "local-sess-1");
});

test("relay: a pinned note reaches the bound session at once, once, and the inbox empties", async () => {
  const s = sandbox();
  bind(s);
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin(s);
    const sent = await until(() => s.rj("sent/n0te0001.json")?.delivery === "delivered" && s.rj("sent/n0te0001.json"));
    assert.ok(sent, "sent file says delivered");
    assert.equal(sent.session, "local-sess-1");
    assert.equal(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")), false, "inbox file removed");
    const [call, ...more] = s.calls();
    assert.equal(more.length, 0, "one turn, not two");
    assert.deepEqual(call.args.slice(0, 5), ["-p", "engineer", "chat", "--resume", "local-sess-1"]);
    const msg = call.args[call.args.indexOf("-q") + 1];
    assert.match(msg, /^The user commented on "Test page" in Rounds: make it blue/);
    assert.match(msg, /Version 1 of 1, pinned at x 100, y 201 on the page at 1280px wide\./);
    assert.match(msg, /rounds_reply and that id/);
    await sleep(1500);
    assert.equal(s.calls().length, 1, "still one after a while");
  } finally { stop(relay); }
});

test("relay: a screen pin uses the screen message", async () => {
  const s = sandbox();
  s.j("posts/aaaaaaaaaaaaaaaa.json", { ...s.post, session: "local-sess-1", profile: "engineer", page: undefined, shots: [{ hash: "cccccccccccccccc", ext: "png", w: 800, h: 600, name: "a.png" }] });
  s.j("comments.json", [{ ...s.note, hash: "cccccccccccccccc", page: "shot-1" }]);
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin(s, { kind: "screen", hash: "cccccccccccccccc", caption: "the card", image: "/img/c.png", px: 10, py: 20, w: 800, h: 600 });
    assert.ok(await until(() => s.rj("sent/n0te0001.json")?.delivery === "delivered"));
    const msg = s.calls()[0].args.at(-1);
    assert.match(msg, /^The user commented on a screen you showed them in Rounds: make it blue/);
    assert.match(msg, /The screen: \/img\/c\.png \(800x600\), pinned at x 10, y 20/);
    assert.match(msg, /You showed it with: "the card"/);
  } finally { stop(relay); }
});

test("relay: an unknown session fails visibly, and the note stays in the inbox", async () => {
  const s = sandbox("missing");
  bind(s, "local-gone");
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin(s);
    const sent = await until(() => s.rj("sent/n0te0001.json")?.delivery === "failed" && s.rj("sent/n0te0001.json"));
    assert.ok(sent);
    assert.match(sent.reason, /Session not found/);
    assert.equal(sent.permanent, true);
    assert.equal(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")), true, "note kept");
    await sleep(1500);
    assert.equal(s.calls().length, 1, "a permanent failure is not retried in a loop");
  } finally { stop(relay); }
});

test("relay: a note on work no Hermes session made fails visibly", async () => {
  const s = sandbox();               // post never bound
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin(s);
    const sent = await until(() => s.rj("sent/n0te0001.json")?.delivery === "failed" && s.rj("sent/n0te0001.json"));
    assert.ok(sent);
    assert.match(sent.reason, /no session is tied/);
    assert.equal(s.calls().length, 0);
    assert.ok(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")));
  } finally { stop(relay); }
});

test("restart: a delivered note is never sent again", async () => {
  const s = sandbox();
  bind(s);
  let relay = s.relay();
  await until(() => s.rj("relay.json"));
  pin(s);
  assert.ok(await until(() => s.rj("sent/n0te0001.json")?.delivery === "delivered"));
  stop(relay);
  await sleep(500);
  pin(s);                              // the same file comes back (e.g. restored)
  relay = s.relay();
  try {
    await sleep(2000);
    assert.equal(s.calls().length, 1);
    assert.equal(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")), false, "stale inbox file cleared");
  } finally { stop(relay); }
});

test("restart: a relay killed mid-delivery does not send it again, and says so", async () => {
  const s = sandbox("slow");
  bind(s);
  let relay = s.relay();
  await until(() => s.rj("relay.json"));
  pin(s);
  assert.ok(await until(() => s.calls().length === 1), "turn started");
  relay.kill("SIGKILL");               // no chance to clean up
  await sleep(300);
  relay = s.relay();
  try {
    const sent = await until(() => s.rj("sent/n0te0001.json")?.delivery === "failed" && s.rj("sent/n0te0001.json"));
    assert.ok(sent, "marked failed");
    assert.match(sent.reason, /not sent again/);
    await sleep(1000);
    assert.equal(s.calls().length, 1, "not re-sent");
    assert.ok(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")));
    // and the explicit retry works
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin/rounds.mjs"), "relay", "retry", "n0te0001"], { env: s.env, encoding: "utf8" });
    assert.match(r.stdout, /will be sent again/);
    assert.ok(await until(() => s.calls().length === 2, 8000), "retried once");
  } finally { stop(relay); }
});

test("fallback hook: leaves a note the relay is carrying alone, delivers a failed one once", () => {
  const s = sandbox();
  bind(s);
  pin(s);
  const ask = () => s.hook({ hook_event_name: "pre_llm_call", session_id: "local-sess-1", profile: "engineer", extra: {} });
  // queued just now: the relay's own turn runs this hook, and must not see the note again
  s.j("sent/n0te0001.json", { delivery: "queued", at: Date.now(), pid: process.pid });
  assert.equal(ask().stdout, "");
  // another session never gets it
  s.j("sent/n0te0001.json", { delivery: "failed", at: Date.now(), reason: "x" });
  assert.equal(s.hook({ hook_event_name: "pre_llm_call", session_id: "someone-else", extra: {} }).stdout, "");
  // the bound session does, once
  const first = JSON.parse(ask().stdout);
  assert.match(first.context, /Note n0te0001: "make it blue"/);
  assert.equal(s.rj("sent/n0te0001.json").delivery, "hook");
  assert.equal(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")), false);
  assert.equal(ask().stdout, "");
});

test("the claude topic sorter never runs by default", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-test-"));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-bin-"));
  const marker = path.join(bin, "claude-ran");
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\ntouch "${marker}"\necho '{}'\n`, { mode: 0o755 });
  const hh = path.join(home, "hermes-home");   // a stand-in ~/.hermes: profiles/engineer/state.db
  const env = { ...process.env, ROUNDS_HERMES_HOME: hh, ROUNDS_BUSY_RECHECK_MS: "250", ROUNDS_HOME: home, PATH: `${bin}:${process.env.PATH}`, CLAUDE_MARKER: marker };
  delete env.ROUNDS_CLAUDE_TOPICS;
  const r = spawnSync(process.execPath, [path.join(ROOT, "test/fixtures/topics-probe.mjs")], { env, encoding: "utf8" });
  assert.match(r.stdout, /sorter is off/);
  assert.match(r.stdout, /claude ran: false/);
});

test("busy: a session mid-turn is detected from its turn lease, compression ancestors included, and a dead holder is not", async () => {
  const s = sandbox();
  process.env.ROUNDS_HERMES_HOME = s.hh;
  const db = state(s);
  const ask = (session = "sess-tip") => sessionBusy({ session, profile: "engineer" });
  db.session("sess-root"); db.session("sess-tip", "sess-root");
  assert.equal((await ask()).busy, false, "no lease");
  db.lease("sess-root");                                   // Hermes keys the lease by the lineage root
  const b = await ask();
  assert.equal(b.busy, true, JSON.stringify(b));
  assert.equal(b.signal, "turn-lease");
  db.release("sess-root");
  db.lease("sess-tip", { ttl: -1 });                       // expired
  assert.equal((await ask()).busy, false, "expired lease");
  db.lease("sess-tip", { pid: 2 ** 22 + 12345 });          // holder process is gone
  assert.equal((await ask()).busy, false, "dead holder");
  assert.equal((await sessionBusy({ session: "sess-tip", profile: "nobody" })).busy, false, "no state.db for the profile: left to hermes to answer");
  db.close();
  delete process.env.ROUNDS_HERMES_HOME;
});

test("busy: a session mid-turn gets no note; it shows 'waiting', then the note goes once the turn ends", async () => {
  const s = sandbox();
  bind(s);
  const db = state(s); db.session("local-sess-1"); db.lease("local-sess-1");
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin(s);
    const w = await until(() => s.rj("sent/n0te0001.json")?.delivery === "waiting" && s.rj("sent/n0te0001.json"));
    assert.ok(w, "visible as waiting");
    assert.equal(w.signal, "turn-lease");
    assert.match(w.reason, /a turn has been running/);
    await sleep(1500);                                      // several re-checks, no attempt used, nothing sent
    assert.equal(s.calls().length, 0, "not sent into a busy session");
    assert.equal(s.rj("sent/n0te0001.json").delivery, "waiting");
    assert.equal(s.rj("sent/n0te0001.json").attempts, 0);
    assert.ok(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")), "note kept");
    db.release("local-sess-1");                             // the turn ends
    const sent = await until(() => s.rj("sent/n0te0001.json")?.delivery === "delivered" && s.rj("sent/n0te0001.json"));
    assert.ok(sent, "delivered as soon as idle");
    assert.equal(s.calls().length, 1);
    assert.equal(fs.existsSync(path.join(s.home, "inbox/n0te0001.json")), false);
  } finally { stop(relay); db.close(); }
});

test("busy: two notes for one session never overlap, and go in the order they were pinned", async () => {
  const s = sandbox("slow");                                // each turn takes 3 s
  bind(s);
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin2(s, "n0te0001");
    await sleep(60);
    pin2(s, "n0te0002");
    assert.ok(await until(() => s.calls().length === 1), "the first is out");
    assert.ok(await until(() => s.rj("sent/n0te0002.json")?.delivery === "waiting"), "the second one waits");
    assert.match(s.rj("sent/n0te0002.json").reason, /another note for this session/);
    assert.equal(s.calls().length, 1, "only the first is out");
    assert.ok(await until(() => s.rj("sent/n0te0002.json")?.delivery === "delivered", 15000), "then the second goes");
    const [c1, c2] = s.calls(), [e1, e2] = s.ends();
    assert.equal(s.calls().length, 2);
    assert.match(c1.args.at(-1), /note n0te0001/);
    assert.match(c2.args.at(-1), /note n0te0002/);
    assert.ok(e1.at <= c2.at, `turn 1 ended (${e1.at}) before turn 2 began (${c2.at})`);
    assert.equal(s.ends().length, 2);
    assert.ok(e2);
  } finally { stop(relay); }
});

test("busy: a relay restarted while a note waits neither loses it nor sends it twice", async () => {
  const s = sandbox();
  bind(s);
  const db = state(s); db.session("local-sess-1"); db.lease("local-sess-1");
  let relay = s.relay();
  await until(() => s.rj("relay.json"));
  pin(s);
  assert.ok(await until(() => s.rj("sent/n0te0001.json")?.delivery === "waiting"));
  const since = s.rj("sent/n0te0001.json").since;
  relay.kill("SIGKILL");
  await sleep(300);
  relay = s.relay();
  try {
    await sleep(1500);
    const w = s.rj("sent/n0te0001.json");
    assert.equal(w.delivery, "waiting", "still waiting, not failed 'in case it arrived': nothing was sent");
    assert.equal(w.since, since, "the wait keeps its start across the restart");
    assert.equal(s.calls().length, 0);
    db.release("local-sess-1");
    assert.ok(await until(() => s.rj("sent/n0te0001.json")?.delivery === "delivered"));
    stop(relay);
    await sleep(300);
    relay = s.relay();                                      // and once more after delivery
    await sleep(1500);
    assert.equal(s.calls().length, 1, "exactly one delivery over two restarts");
  } finally { stop(relay); db.close(); }
});

test("busy: a session busy past the ceiling fails visibly, without burning attempts, and can be retried", async () => {
  const s = sandbox();
  bind(s);
  const db = state(s); db.session("local-sess-1"); db.lease("local-sess-1");
  s.env.ROUNDS_BUSY_MAX_MS = "1200";
  const relay = s.relay();
  try {
    await until(() => s.rj("relay.json"));
    pin(s);
    const f = await until(() => s.rj("sent/n0te0001.json")?.delivery === "failed" && s.rj("sent/n0te0001.json"));
    assert.ok(f, "failed after the ceiling");
    assert.match(f.reason, /gave up after .* minutes of waiting.*rounds relay retry n0te0001/);
    assert.equal(f.attempts, 0);
    assert.equal(f.permanent, true, "no retry loop on its own");
    assert.equal(s.calls().length, 0);
    db.release("local-sess-1");
    const r = spawnSync(process.execPath, [path.join(ROOT, "bin/rounds.mjs"), "relay", "retry", "n0te0001"], { env: s.env, encoding: "utf8" });
    assert.match(r.stdout, /will be sent again/);
    assert.ok(await until(() => s.rj("sent/n0te0001.json")?.delivery === "delivered"), "delivered after the explicit retry");
  } finally { stop(relay); db.close(); }
});
