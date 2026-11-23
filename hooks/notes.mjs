#!/usr/bin/env node
// UserPromptSubmit hook (Claude Code): when you type in a session that has new notes on its work,
// they come into the conversation with your message, so the session sees them without any relay.
// The rules (whose note it is, delivered once) live in server/notes.mjs, shared with the Hermes
// hook and relay. Hermes sessions use hooks/hermes.mjs instead.
import fs from "node:fs";
import { updateNotice } from "../server/updates.mjs";
import { world, waitingNotes, sessionIds, targetOf, fallbackContext, writeSent, dropInbox } from "../server/notes.mjs";

// A new Rounds is said once, to the person, beside whatever notes this prompt brings to Claude.
const notice = updateNotice();
const done = (context) => {
  const out = { ...(notice && { systemMessage: notice }), ...(context && { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } }) };
  if (!notice && !context) process.exit(0);
  process.stdout.write(JSON.stringify(out), () => process.exit(0));
  return new Promise(() => {}); // nothing after this runs
};

let input = {};
try { input = JSON.parse(fs.readFileSync(0, "utf8") || "{}"); } catch {}
const session = input.session_id || "";

const w = world();
const waiting = waitingNotes(w);
if (!waiting.length) await done();
const mine = sessionIds(w, session);
const notes = waiting.filter((c) => mine.has(targetOf(w, c)));
if (!notes.length) await done();

for (const c of notes) {
  writeSent(c.id, { delivery: "hook", session, at: Date.now() });
  dropInbox(c.id);
}
await done(fallbackContext(w, notes));
