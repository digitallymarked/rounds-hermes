#!/usr/bin/env node
// Hermes shell hook (config.yaml `hooks:`). One entry point for both events:
//
//   post_tool_call  after rounds_post / rounds_change: tie the post to the Hermes session (and
//                   profile) that made it, so a note pinned on it finds its way back. This is
//                   what the relay reads to know where to deliver.
//   pre_llm_call    the FALLBACK for notes: when the relay is not running (or could not deliver),
//                   a note on this session's work comes in with its next message. A note the
//                   relay has delivered, or is carrying right now, is never added here.
//
// Stdin is Hermes' hook payload: { hook_event_name, tool_name, tool_input, session_id, cwd,
// profile, extra: { result, ... } }. Stdout for pre_llm_call is { "context": "..." }.
// Fails open: any error means "nothing to add", never a blocked turn.
import fs from "node:fs";
import path from "node:path";
import { DATA, POSTS } from "../server/config.mjs";
import { world, waitingNotes, sessionIds, targetOf, fallbackContext, writeSent, dropInbox } from "../server/notes.mjs";

let h = {};
try { h = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const event = h.hook_event_name;
const session = String(h.session_id || "");
if (!session) process.exit(0);

try {
  if (event === "post_tool_call") bind();
  else if (event === "pre_llm_call") fallback();
} catch {}
process.exit(0);

function bind() {
  if (!/(rounds|workbench)_(post|change)$/.test(String(h.tool_name || ""))) return;
  let said = h.extra?.result;
  if (said && typeof said !== "string") said = JSON.stringify(said);
  const id = String(said || "").match(/\bpost ([a-f0-9]{16})\b/)?.[1];
  const file = id && path.join(POSTS, `${id}.json`);
  if (!file || !fs.existsSync(file)) return;
  const post = JSON.parse(fs.readFileSync(file, "utf8"));
  post.session = session;
  post.agent = "hermes";
  if (h.profile) post.profile = String(h.profile);
  fs.writeFileSync(file, JSON.stringify(post, null, 1));
  fs.writeFileSync(path.join(DATA, "posted"), String(Date.now()));
}

function fallback() {
  const w = world();
  const waiting = waitingNotes(w);
  if (!waiting.length) return;
  const mine = sessionIds(w, session);
  const notes = waiting.filter((c) => mine.has(targetOf(w, c)));
  if (!notes.length) return;
  const context = fallbackContext(w, notes);
  for (const c of notes) {
    writeSent(c.id, { delivery: "hook", session, at: Date.now() });
    dropInbox(c.id);
  }
  process.stdout.write(JSON.stringify({ context }));
}
