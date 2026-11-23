#!/usr/bin/env node
// A stand-in for the `hermes` CLI, for tests. Records every call, then behaves as FAKE_HERMES_MODE says:
//   ok (default)  exit 0          missing  "Session not found", exit 1        slow  sleep 3s, exit 0
import fs from "node:fs";
fs.appendFileSync(process.env.FAKE_HERMES_LOG, JSON.stringify({ at: Date.now(), args: process.argv.slice(2) }) + "\n");
const mode = process.env.FAKE_HERMES_MODE || "ok";
if (mode === "missing") { console.error("Session not found: " + process.argv[process.argv.indexOf("--resume") + 1]); process.exit(1); }
if (mode === "slow") await new Promise((r) => setTimeout(r, 3000));
console.log("ok");
