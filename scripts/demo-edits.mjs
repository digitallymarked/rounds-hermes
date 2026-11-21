// The demo's changed files: what the Murmur session changed, read from Murmur's own public git
// history, one change per file per commit, in the shape the indexer keeps (server/indexer.mjs,
// keepEdits). Murmur is the one demo project whose code is public, so it is the only one with files.
// build-demo.mjs writes this with the rest of the demo; on its own it adds them to demo/ as it is.
//   node scripts/demo-edits.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.join(process.env.HOME, "Developer", "murmur");
const THREAD = "demo-murmur", CWD = "/demo/murmur";
// the commits the demo's Murmur moments and the answers to its notes name
const SHAS = ["45605bd", "4edcba2", "10afd39", "b1a3e01", "fc51490", "a75b0b3", "e6d65f3", "b7617b4", "9185180", "632519e", "f3f9ecb", "4d39f75"];
const CUT = 600; // as the indexer: a very long change keeps its first lines and says how many more

const git = (...a) => execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8", maxBuffer: 64e6 });

export function demoEdits(out) {
  const store = {};
  for (const sha of SHAS) {
    const at = Number(git("log", "-1", "--format=%ct", sha).trim()) * 1000;
    // the generated Xcode project and binary files aren't hand changes
    const diff = git("show", "--format=", "--no-color", "--no-renames", "-U3", sha, "--", ".", ":!*.xcodeproj/*");
    for (const part of diff.split(/^diff --git /m).slice(1)) {
      const file = (part.match(/^\+\+\+ b\/(.+)$/m) || [])[1];
      if (!file || /^Binary files/m.test(part)) continue;
      const hunks = [];
      let h = null;
      for (const l of part.split("\n")) {
        const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) { h = { o: Number(m[1]), n: Number(m[2]), lines: [] }; hunks.push(h); continue; }
        if (h && /^[ +-]/.test(l)) h.lines.push(l);
      }
      let add = 0, del = 0;
      for (const x of hunks) for (const l of x.lines) { if (l[0] === "+") add++; else if (l[0] === "-") del++; }
      if (!add && !del) continue;
      let left = CUT, cut = 0;
      const kept = [];
      for (const x of hunks) {
        const take = x.lines.slice(0, Math.max(0, left));
        cut += x.lines.length - take.length; left -= take.length;
        if (take.length) kept.push({ ...x, lines: take });
      }
      const created = /^new file mode/m.test(part);
      const k = `${CWD}\n${file}`;
      (store[k] ||= []).push({ at, add, del, hunks: kept, ...(cut ? { cut } : {}), ...(created ? { created: true } : {}) });
    }
  }
  for (const list of Object.values(store)) list.sort((a, b) => a.at - b.at);
  fs.mkdirSync(path.join(out, "store", "edits"), { recursive: true });
  const text = JSON.stringify(store);
  fs.writeFileSync(path.join(out, "store", "edits", `${THREAD}.json`), text);
  return { files: Object.keys(store).length, changes: Object.values(store).reduce((n, l) => n + l.length, 0) };
}

// The demo's version: changes when any of its work does, so a copy made before is replaced.
export function demoVersion(out) {
  const h = crypto.createHash("sha1");
  for (const dir of ["posts", "pushes", "store/edits"]) for (const f of fs.readdirSync(path.join(out, dir)).sort()) h.update(f).update(fs.readFileSync(path.join(out, dir, f)));
  h.update(fs.readFileSync(path.join(out, "comments.json")));
  return h.digest("hex").slice(0, 16);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = path.join(ROOT, "demo");
  const { files, changes } = demoEdits(out);
  fs.writeFileSync(path.join(out, "version"), demoVersion(out));
  console.log(`demo/store/edits: ${files} files, ${changes} changes`);
}
