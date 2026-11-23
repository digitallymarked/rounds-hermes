// Topic filing must never reach for the `claude` CLI unless the config says so.
import fs from "node:fs";
const { fileTopics } = await import("../../server/topics.mjs");
const index = { threads: [], projects: { p: "P" }, sets: [{ id: "a1", project: "p", at: Date.now(), caption: "x", shots: [], thread: null }] };
let said = "";
try { await fileTopics(index); said = "no error"; } catch (e) { said = e.message; }
console.log(said, "| claude ran:", fs.existsSync(process.env.CLAUDE_MARKER));
