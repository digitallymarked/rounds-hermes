// Builds demo/: real work from Kris's public projects, as the canvas would have caught it. Screens
// were captured from each project's own git history (each commit built and shot as it was), or
// are the screenshots the project kept itself; captions are the commits that made them; notes are
// what Kris said in the session, answered by the commit that followed.
//
// Runs on Kris's machine only: it reads his repos and the captures in CAPTURES.
//   CAPTURES=<folder of shots/<project>/<sha>-<name>.png> node scripts/build-demo.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { demoEdits, demoVersion } from "./demo-edits.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "demo");
const CAP = process.env.CAPTURES;
if (!CAP) throw new Error("CAPTURES is the folder the captures were saved in");
const DEV = path.join(process.env.HOME, "Developer");

// ---- the projects ---------------------------------------------------------------------------
const PROJECTS = {
  krisos: { name: "krispuckett.com", repo: `${DEV}/krisos-pages`, cwd: "/demo/krispuckett.com" },
  road: { name: "The Road", repo: `${DEV}/shadowfax-road`, cwd: "/demo/the-road" },
  letour: { name: "Le Tour", repo: `${DEV}/letour-web`, cwd: "/demo/le-tour" },
  stoked: { name: "Stoked Dad", repo: `${DEV}/stoked-dad`, cwd: "/demo/stoked-dad" },
  murmur: { name: "Murmur", repo: `${DEV}/murmur`, cwd: "/demo/murmur" },
  praxis: { name: "Praxis", repo: `${DEV}/praxis-clear`, cwd: "/demo/heypraxis.app" },
};
// The sessions the work came from, by the names they had (two are labels: their real titles were
// a first message about something else).
const SESSIONS = {
  ocean: { id: "demo-ocean-portfolio", title: "Ocean portfolio updates" },
  stoked: { id: "demo-stoked-dad", title: "Ocean portfolio updates" },
  sea: { id: "demo-portfolio-site", title: "Portfolio site updates" },
  top20: { id: "demo-top20", title: "Top20 design polish" },
  road: { id: "demo-web-game", title: "Shadowfax web game" },
  letour: { id: "demo-le-tour", title: "Le Tour web" },
  murmur: { id: "demo-murmur", title: "Murmur" },
};

// ---- helpers ----------------------------------------------------------------------------------
const git = (project, ...a) => execFileSync("git", ["-C", PROJECTS[project].repo, ...a], { encoding: "utf8" }).trim();
const when = (project, sha) => Number(git(project, "log", "-1", "--format=%ct", sha)) * 1000;
const plain = (s) => s.replace(/\s*—\s*/g, ", ").replace(/\s*\(#\d+\)$/, "");
const commit = (project, sha) => { const [h, ...s] = git(project, "log", "-1", "--format=%h%x09%s", sha).split("\t"); return { sha: h, subject: plain(s.join("\t")) }; };
// a commit's subject as the session's own words: "Fix: the fold lines melt" -> "The fold lines melt."
const said = (project, sha) => { const s = commit(project, sha).subject.replace(/^(Add|Fix|Change|Remove|Update):\s*/i, ""); return s[0].toUpperCase() + s.slice(1).replace(/[.]?$/, "."); };
const sha16 = (b) => crypto.createHash("sha1").update(b).digest("hex").slice(0, 16);

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ["posts", "pushes", "store/img"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });

// A screen into the store: as a JPEG at its own size, named for what it is.
const kept = new Map();
function screen(file, name) {
  if (kept.has(file)) return kept.get(file);
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  const tmp = path.join(OUT, "tmp.jpg");
  const dims = (f) => { const o = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", f], { encoding: "utf8" }); return [Number(o.match(/pixelWidth: (\d+)/)[1]), Number(o.match(/pixelHeight: (\d+)/)[1])]; };
  const [W, H] = dims(file);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", file, "--out", tmp], { stdio: "ignore" });
  // a heavy photographic frame (a WebGL garden, a sky) steps down to 2160 wide, where its own
  // softness hides the difference; nothing is ever enlarged
  if (fs.statSync(tmp).size > 400e3 && Math.max(W, H) > 2160) execFileSync("sips", ["-Z", "2160", "-s", "format", "jpeg", "-s", "formatOptions", "76", file, "--out", tmp], { stdio: "ignore" });
  // pixel art and flat screens stay PNG when that is smaller, and sharper
  const png = file.endsWith(".png") && fs.statSync(file).size <= fs.statSync(tmp).size;
  const buf = fs.readFileSync(png ? file : tmp);
  const [w, h] = png ? [W, H] : dims(tmp);
  const ext = png ? "png" : "jpg";
  fs.rmSync(tmp);
  const hash = sha16(buf);
  fs.writeFileSync(path.join(OUT, "store/img", `${hash}.${ext}`), buf);
  const meta = { hash, ext, w, h, name: name || path.basename(file, path.extname(file)) };
  fs.writeFileSync(path.join(OUT, "store/img", `${hash}.json`), JSON.stringify(meta));
  kept.set(file, meta);
  return meta;
}
const cap = (project, shot) => screen(path.join(CAP, project, `${shot}.png`), shot.replace(/^[0-9a-f]{7}-/, ""));
const repoFile = (project, file) => screen(path.join(PROJECTS[project].repo, file), path.basename(file, ".png"));
const lab = (file) => screen(path.join(CAP, "murmur", file), file.replace(/^\d+-|\.png$/g, ""));

const posts = [];
// one moment: screens a session showed, a change with its commits and its befores
function post(project, { topic, at, caption, shots, before, commits, session, kind }) {
  const p = {
    id: sha16(`${project}${topic}${at}${caption}`), kind: kind || (commits ? "change" : "screens"),
    caption, topic, cwd: PROJECTS[project].cwd, at, shots,
    ...(before ? { before } : {}),
    ...(commits ? { range: commits.length > 1 ? `${commits[commits.length - 1]}..${commits[0]}` : commits[0], commits: commits.map((c) => commit(project, c)) } : {}),
    ...(session ? { session: SESSIONS[session].id, sessionTitle: SESSIONS[session].title } : {}),
  };
  posts.push(p);
  fs.writeFileSync(path.join(OUT, "posts", `${p.id}.json`), JSON.stringify(p, null, 1));
  return p;
}
// a push recorded without screens
function push(project, shas, summary) {
  const commits = shas.map((s) => commit(project, s));
  const at = when(project, shas[0]);
  const id = sha16(`${project}${shas.join()}`);
  fs.writeFileSync(path.join(OUT, "pushes", `${id}.json`), JSON.stringify({ id, repo: PROJECTS[project].cwd, branch: "main", range: `${shas[shas.length - 1]}..${shas[0]}`, commits, files: [], at, summary }, null, 1));
}
// a note he left, where he left it, and the session's answer
const notes = [];
function note(shot, x, y, text, at, session, reply) {
  notes.push({
    id: sha16(`${shot.hash}${text}`).slice(0, 8), page: `shot-${shot.hash}`, hash: shot.hash, x, y, text, at,
    thread: SESSIONS[session].id, state: "sent", route: "hook", threadTitle: SESSIONS[session].title, reply,
  });
}
const T = (s) => new Date(s).getTime(); // a local time, for what has no commit of its own

// ---- krispuckett.com ------------------------------------------------------------------------
{
  const k = "krisos";
  post(k, { topic: "Eras", at: when(k, "3dba91b"), session: "ocean", caption: "The site now runs in eras: 1984, Aqua, Leopard and iOS 7, each a whole shell of its own.",
    shots: ["3dba91b-era-1984", "3dba91b-era-2001", "3dba91b-era-2007", "3dba91b-era-2013"].map((s) => cap(k, s)), commits: ["3dba91b", "a651f6e", "0ba8239"] });
  const glassBefore = cap(k, "58b2cf0-glass");
  post(k, { topic: "Liquid Glass", at: when(k, "58b2cf0"), session: "ocean", caption: "Sea 2 is the default ocean now. Windows are still the old flat panels.", shots: [glassBefore] });
  note(glassBefore, 0.5, 0.2, "Clear adaptive glass like the new macOS 27", T("2026-09-10T15:53"), "ocean", { text: said(k, "5d167dc"), at: when(k, "5d167dc") });
  post(k, { topic: "Liquid Glass", at: when(k, "5d167dc"), session: "ocean", caption: "Liquid Glass for the modern era: clear glass with a bright rim and a lens edge, drawn in the ocean's own light.",
    shots: [cap(k, "5d167dc-glass")], before: [glassBefore], commits: ["aa8347f", "5d167dc"] });
  post(k, { topic: "Liquid Glass", at: when(k, "9d3bb6c"), session: "ocean", caption: "A window behind another now recedes, with a progressive blur and a dim.",
    shots: [cap(k, "9d3bb6c-glass")], before: [cap(k, "5d167dc-glass")], commits: ["9d3bb6c"] });

  post(k, { topic: "Magnificent garden", at: when(k, "994651e"), caption: "The Magnificent garden, a walk you scroll through.",
    shots: ["994651e-garden", "994651e-garden-path", "994651e-garden-valley"].map((s) => cap(k, s)), commits: ["994651e"] });
  post(k, { topic: "Magnificent garden", at: when(k, "73ae468"), caption: "Terraced planting and a river valley beside the trail.",
    shots: ["73ae468-garden-path", "73ae468-garden-valley"].map((s) => cap(k, s)), before: ["994651e-garden-path", "994651e-garden-valley"].map((s) => cap(k, s)), commits: ["73ae468"] });

  post(k, { topic: "Homepage", at: when(k, "c172e13"), session: "ocean", caption: "The desktop as it stands: notes open, the dock back to its approved lift.", shots: [cap(k, "c172e13-home"), cap(k, "c172e13-home-phone")], commits: ["c172e13", "2d84c1e"] });
  // Left out: the screens that show the site's profile card (the 2ecbc6c homepage, both sizes, and
  // the sea at dusk on a phone).

  post(k, { topic: "Sky and sea", at: when(k, "d92b7c1"), session: "sea", caption: "A scattered-light sky, clouds, and a faster, truer sea.", shots: [cap(k, "d92b7c1-sea-noon"), cap(k, "d92b7c1-sea-sunset")], commits: ["d92b7c1"] });
  const duskBroken = cap(k, "b639435-sea-dusk");
  post(k, { topic: "Sky and sea", at: when(k, "b639435"), session: "sea", caption: "Grab the sea to look around. A day and night slider, the clock moves the sun, and a moon over the water.",
    shots: [cap(k, "b639435-sea-noon"), duskBroken], commits: ["b639435"] });
  note(duskBroken, 0.45, 0.6, "strange artifacts when I scroll through time on sunrise and sunset.", T("2026-11-04T10:12"), "sea", { text: said(k, "c3c7987"), at: when(k, "c3c7987") });
  const duskPurple = cap(k, "c3c7987-sea-dusk");
  post(k, { topic: "Sky and sea", at: when(k, "c3c7987"), session: "sea", caption: "Twilight no longer goes black or stripes the sea, and the sun sets where it should.",
    shots: [duskPurple, cap(k, "c3c7987-sea-sunset")], before: [duskBroken, cap(k, "b639435-sea-sunset")], commits: ["c3c7987"] });
  note(duskPurple, 0.42, 0.3, "strange banding on sky and the sunset feels way too purple/fuchsia?", T("2026-11-04T12:36"), "sea", { text: said(k, "9537a91"), at: when(k, "9537a91") });
  post(k, { topic: "Sky and sea", at: when(k, "9537a91"), session: "sea", caption: "The twilight sky without its bands, and a sunset that isn't fuchsia.",
    shots: [cap(k, "9537a91-sea-dusk"), cap(k, "9537a91-sea-sunset")], before: [duskPurple, cap(k, "c3c7987-sea-sunset")], commits: ["9537a91"] });

  post(k, { topic: "Top 20", at: when(k, "02022d5"), caption: "The interactive CD collection, published at /top20.", shots: [cap(k, "02022d5-top20")], commits: ["02022d5"] });
  post(k, { topic: "Top 20", at: when(k, "ba2c640"), session: "top20", caption: "Make your own Top 20: a simpler creator, and spines lettered so they travel.",
    shots: [cap(k, "ba2c640-top20-create"), cap(k, "ba2c640-top20-phone")], commits: ["ba2c640", "09bcee7"] });
  const createOld = cap(k, "8dc5cc2-top20-create");
  post(k, { topic: "Top 20", at: when(k, "8dc5cc2"), session: "top20", caption: "Spine images export in the original jewel-case format.", shots: [createOld], commits: ["8dc5cc2", "74ec068", "664c5d5"] });
  note(createOld, 0.17, 0.155, "I'm more worried about very quick fixes to the actual design elements of the top20/create page. I don't love the overall ui.", T("2026-11-15T22:13"), "top20", { text: said(k, "e23b711"), at: when(k, "e23b711") });
  note(createOld, 0.42, 0.245, "make the input bar 1/2 the width.", T("2026-11-15T22:20"), "top20", { text: said(k, "e23b711"), at: when(k, "e23b711") });
  post(k, { topic: "Top 20", at: when(k, "e23b711"), session: "top20", caption: "Sharper covers and a redesigned create page.", shots: [cap(k, "e23b711-top20-create")], before: [createOld], commits: ["e23b711"] });
  const listed = cap(k, "22c5b0b-top20-create");
  post(k, { topic: "Top 20", at: when(k, "22c5b0b"), session: "top20", caption: "The create page, rebuilt as a numbered list.", shots: [listed], before: [cap(k, "e23b711-top20-create")], commits: ["22c5b0b", "5986fce"] });
  note(listed, 0.81, 0.62, "I don't think we need this background at all. like the albums shine here.", T("2026-11-16T15:52"), "top20", { text: said(k, "b206a4b"), at: when(k, "b206a4b") });
  note(listed, 0.81, 0.835, "get rid of the black horizontal line under albums too please", T("2026-11-16T15:52:30"), "top20", { text: said(k, "b206a4b"), at: when(k, "b206a4b") });
  post(k, { topic: "Top 20", at: when(k, "b206a4b"), session: "top20", caption: "Sharper spines, and a create page that lets the albums shine.", shots: [cap(k, "b206a4b-top20-create")], before: [listed], commits: ["b206a4b"] });

  push(k, ["a78dc9d"], "Apple Music token signing, fixed");
  push(k, ["5afe888"], "The Terminal app and its chat route, removed");
  push(k, ["1cc0a29"], "A glass knob and a daylight rail on the day and night slider");
}

// ---- The Road -----------------------------------------------------------------------------
{
  const r = "road";
  const play = cap(r, "d5aef2f-play");
  post(r, { topic: "World 1", at: when(r, "d5aef2f"), session: "road", caption: "Shadowfax's Road for the web: World 1, the Shire, playable.", shots: [cap(r, "d5aef2f-title"), play], commits: ["d5aef2f"] });
  note(play, 0.42, 0.62, "Feels good needs more polish and refinement. Needs to feel pixel perfect and the running motion should be incredible.", T("2026-11-18T12:32"), "road", { text: said(r, "7a7fb2e"), at: when(r, "7a7fb2e") });
  const w1 = ["1-pits", "2-raised-ground", "3-ledges", "4-beacon", "5-leap", "6-skid"].map((f) => repoFile(r, `review/${f}.png`));
  post(r, { topic: "World 1", at: when(r, "7a7fb2e"), session: "road", caption: "Shadowfax holds still on screen and the ground is real earth. The pits, the ledges, the beacon, a leap and a skid.", shots: w1, commits: ["7a7fb2e"] });
  note(w1[4], 0.5, 0.45, "on 1-3 the big jump after the first nazgul feels pretty hard", T("2026-11-18T13:18"), "road", { text: said(r, "451dc87"), at: when(r, "451dc87") });
  const w2 = ["7-w2-chain", "7-w2-dropping", "7-w2-slab"].map((f) => repoFile(r, `review/${f}.png`));
  post(r, { topic: "Weathertop", at: when(r, "451dc87"), session: "road", caption: "Weathertop, World 2, with crumbling stone. The big leap in 1-3 has a runway now.", shots: w2, commits: ["451dc87", "6fc9351"] });
  note(w2[0], 0.55, 0.5, "those big jumps on any level like on weather top 2-3 are hard to get right.", T("2026-11-18T13:25"), "road", { text: said(r, "bd0dbd1"), at: when(r, "bd0dbd1") });
  note(w2[2], 0.5, 0.3, "music on weathertop is awful.", T("2026-11-18T14:06"), "road", { text: said(r, "7cf4bc0"), at: when(r, "7cf4bc0") });
  const rohan = repoFile(r, "review/8-rohan-arrows.png");
  post(r, { topic: "Rohan and the Pelennor", at: when(r, "f6cf991"), session: "road", caption: "Rohan, the Pelennor and the Witch-king, then dawn, and the road goes round again.",
    shots: [rohan, ...["9-pelennor-stone", "10-witch-king", "11-dawn"].map((f) => repoFile(r, `review/${f}.png`))], commits: ["f6cf991"] });
  note(rohan, 0.35, 0.62, "Rohan is so hard with the arrows and the color between Shadowfax and the field feels off", T("2026-11-18T14:14"), "road", { text: said(r, "2686928"), at: when(r, "2686928") });
  post(r, { topic: "Rohan and the Pelennor", at: when(r, "2686928"), session: "road", caption: "Rohan's arrows give warning now, and Shadowfax stays white in its sun.",
    shots: ["12-rohan-horse", "13-rohan-arrows"].map((f) => repoFile(r, `review/${f}.png`)), commits: ["2686928"] });
  push(r, ["f629e8a", "e7aa81c", "e2e7df1"].reverse(), "A leaderboard, signed with three initials");
  post(r, { topic: "On a phone", at: when(r, "cb91f86"), session: "road", caption: "The touch pad, in the iOS Road's Game Boy style, clear of the play.", shots: [cap(r, "cb91f86-phone")], commits: ["cb91f86"] });
  post(r, { topic: "On a phone", at: when(r, "88a8822"), session: "road", caption: "Sky behind Safari's bars, clear glass, bigger keys, and pills that say what they do.",
    shots: [cap(r, "88a8822-phone")], before: [cap(r, "cb91f86-phone")], commits: ["88a8822", "395fc7e", "e877a4d"] });
  post(r, { topic: "Launch", at: when(r, "1d32335"), session: "road", caption: "The link preview: a leap in the Shire.", shots: [repoFile(r, "review/og-image.png")], commits: ["1d32335"] });
  post(r, { topic: "World 1", at: when(r, "0b79ac4"), session: "road", caption: "Bilbo and Frodo, Gandalf the Grey and the White, Aragorn, Legolas and Gimli on the road.",
    shots: [cap(r, "0b79ac4-title"), cap(r, "0b79ac4-play")], before: [cap(r, "d5aef2f-title"), play], commits: ["0b79ac4"] });
}

// ---- Le Tour --------------------------------------------------------------------------------
{
  const l = "letour";
  const first = cap(l, "9876646-stage");
  post(l, { topic: "Stage gallery", at: when(l, "9876646"), session: "letour", caption: "Le Tour 2026: all 21 stages as liquid-metal routes, in a gallery.", shots: [cap(l, "9876646-home"), first, cap(l, "9876646-phone")], commits: ["9876646"] });
  note(first, 0.5, 0.45, "not at all there yet. Still has a bunch of weird issues with the border, the background. the line isn't smooth. the text is hard to read weird flashing on the screen. Shader needs to be far more liquid and advanced.", T("2026-07-03T12:28"), "letour", { text: said(l, "1c16ca6"), at: when(l, "1c16ca6") });
  const tuned = cap(l, "c409ec7-stage");
  post(l, { topic: "Stage gallery", at: when(l, "c409ec7"), session: "letour", caption: "Kris's tuned defaults, a saturation dial, and true black.", shots: [cap(l, "c409ec7-home"), tuned], before: [cap(l, "9876646-home"), first], commits: ["c409ec7", "ad3f119", "1ecd0b0", "1c16ca6"] });
  note(tuned, 0.5, 0.55, "cant have hard lines. It's a flowing smooth mesh gradient, liquidy, beautiful, not this.", T("2026-07-03T13:58"), "letour", { text: said(l, "ac6ed96"), at: when(l, "ac6ed96") });
  const mesh = cap(l, "ac6ed96-stage");
  post(l, { topic: "Stage gallery", at: when(l, "ac6ed96"), session: "letour", caption: "The tint is a mesh gradient now.", shots: [mesh], before: [tuned], commits: ["ac6ed96"] });
  note(mesh, 0.45, 0.5, "brother look at those fold lines. how can we fix that.", T("2026-07-03T14:04"), "letour", { text: said(l, "7365eb2"), at: when(l, "7365eb2") });
  const traced = cap(l, "b996fdf-stage");
  post(l, { topic: "Stage gallery", at: when(l, "b996fdf"), session: "letour", caption: "The route traces itself on load, with a calmer line and names you can read.", shots: [traced, cap(l, "b996fdf-home")], before: [mesh, cap(l, "c409ec7-home")], commits: ["b996fdf", "7365eb2"] });
  note(traced, 0.72, 0.6, "the finish needs a bead too on all of them", T("2026-07-03T14:20"), "letour", { text: said(l, "801fe24"), at: when(l, "801fe24") });
  post(l, { topic: "Stage gallery", at: when(l, "801fe24"), session: "letour", caption: "A bead at the finish of every stage.", shots: [cap(l, "801fe24-stage")], before: [traced], commits: ["801fe24"] });
  post(l, { topic: "The race", at: when(l, "96bb3c2"), session: "letour", caption: "The race: stage winners, standings, and a living maillot jaune.", shots: [cap(l, "96bb3c2-home"), cap(l, "96bb3c2-phone")], commits: ["96bb3c2"] });
  push(l, ["8dd0370", "2c95039", "ade0afb", "65d1192", "a5fd0fa"], "Standings, jerseys and stage winners update themselves from the live race");
  post(l, { topic: "The race", at: when(l, "8274066"), session: "letour", caption: "A shareable standings card, and a pass on contrast and focus.", shots: [cap(l, "8274066-home"), cap(l, "8274066-phone")], before: [cap(l, "96bb3c2-home"), cap(l, "96bb3c2-phone")], commits: ["8274066"] });
}

// ---- Stoked Dad -----------------------------------------------------------------------------
{
  const s = "stoked";
  const first = cap(s, "0fea8ac-index");
  post(s, { topic: "Dispatch library", at: when(s, "0fea8ac"), session: "stoked", caption: "The Stoked Dad library: eight dispatches from 2023, an index and a page for each.", shots: [first, cap(s, "0fea8ac-dispatch"), cap(s, "0fea8ac-phone")], commits: ["0fea8ac"] });
  note(first, 0.17, 0.33, "Better but more color. I dig the fusion with the images and space. Alignment feels all jacked up even if it's Swiss style.", T("2026-09-20T14:15"), "stoked", { text: said(s, "e13a79e"), at: when(s, "e13a79e") });
  const grid = cap(s, "e13a79e-index");
  post(s, { topic: "Dispatch library", at: when(s, "e13a79e"), session: "stoked", caption: "Grid discipline, a plate of color for each dispatch, and a slot for its photo.", shots: [grid, cap(s, "e13a79e-dispatch")], before: [first, cap(s, "0fea8ac-dispatch")], commits: ["e13a79e"] });
  note(grid, 0.3, 0.5, "alignment still feels so freaking weird. Color choices are strange I guess.", T("2026-09-20T14:35"), "stoked", { text: said(s, "2ee8f7c"), at: when(s, "2ee8f7c") });
  const plates = cap(s, "2ee8f7c-dispatch");
  post(s, { topic: "Dispatch library", at: when(s, "2ee8f7c"), session: "stoked", caption: "A two-edge grid on columns 1 and 3, a single amber accent, dark plates, a capped width.", shots: [cap(s, "2ee8f7c-index"), plates, cap(s, "2ee8f7c-phone")], before: [grid, cap(s, "e13a79e-dispatch"), cap(s, "e13a79e-phone")], commits: ["2ee8f7c", "1ffdff1"] });
  note(plates, 0.22, 0.89, "Getting closer, still working on images. this is weird layout to me especially the \"Yo\" section", T("2026-09-20T14:40"), "stoked", { text: said(s, "6143a07"), at: when(s, "6143a07") });
  post(s, { topic: "Dispatch library", at: when(s, "3a9dead"), session: "stoked", caption: "Photographs on the plates, for the index and all eight dispatches.", shots: [cap(s, "3a9dead-index"), cap(s, "3a9dead-dispatch"), cap(s, "3a9dead-phone")], before: [cap(s, "2ee8f7c-index"), plates, cap(s, "2ee8f7c-phone")], commits: ["3a9dead", "9058700", "6143a07"] });
  post(s, { topic: "Dispatch library", at: when(s, "6449b17"), session: "stoked", caption: "A motion pass: view transitions, entrances that wait for the fonts, image fades, hover and focus.", shots: [cap(s, "6449b17-index"), cap(s, "6449b17-dispatch")], commits: ["6449b17", "89600fe"] });
}

// ---- Murmur ---------------------------------------------------------------------------------
{
  const m = "murmur";
  const light = lab("06-studio-light.png");
  post(m, { topic: "Lab", at: when(m, "45605bd"), session: "murmur", caption: "The Murmur Lab: a gallery of thinking indicators, a studio for each, and an export card.",
    shots: ["01-gallery.png", "02-gallery-signal.png", "03-studio-eddy.png", "04-studio-panel.png", "05-export-card.png"].map(lab).concat(light), commits: ["45605bd"] });
  note(light, 0.5, 0.25, "Let's make the colors of them initially easier to see. Add more playful dynamics. the state machine needs varied states like idle should be slow, thinking should have more motion and color.", T("2026-08-28T16:25"), "murmur", { text: said(m, "4edcba2"), at: when(m, "4edcba2") });
  post(m, { topic: "Lab", at: when(m, "10afd39"), session: "murmur", caption: "A pinned studio, a live row of states, Liquid Glass chrome.", shots: ["07-studio-pinned.png", "08-studio-glass-states.png", "09-studio-recolored.png"].map(lab), commits: ["10afd39", "4edcba2"] });
  const perState = lab("10-per-state-editing.png");
  post(m, { topic: "Lab", at: when(m, "fc51490"), session: "murmur", caption: "Every state gets its own dials.", shots: [perState], commits: ["fc51490", "b1a3e01"] });
  note(perState, 0.5, 0.2, "1. colors are too hard to read and parse. 2. Need each shader to be easy to understand. What makes the example I initially gave great is that it has shape and is easy to parse.", T("2026-08-28T17:36"), "murmur", { text: said(m, "a75b0b3"), at: when(m, "a75b0b3") });
  const rig = lab("11-signals-rig.png");
  post(m, { topic: "Signals", at: when(m, "b7617b4"), session: "murmur", caption: "Live signals, level and activity, a listening state, and a rig to try them.", shots: [rig, lab("11-signals-rig-field.png")], commits: ["b7617b4", "e6d65f3"] });
  note(rig, 0.5, 0.18, "Can we redo all of them? They just don't feel high quality yet. All new concepts. We are trying to make a library to share out.", T("2026-08-29T08:00"), "murmur", { text: said(m, "9185180"), at: when(m, "9185180") });
  post(m, { topic: "Glass", at: when(m, "9185180"), session: "murmur", caption: "A glass family, and a gallery with a collection and an archive.", shots: [lab("12-collection.png"), lab("12-collection-archive.png")], commits: ["9185180"] });
  const lightMode = lab("13-light-mode.png");
  post(m, { topic: "Glass", at: when(m, "632519e"), session: "murmur", caption: "Glass Twelve, complete, with a kit for light grounds.", shots: [lightMode], commits: ["632519e"] });
  note(lightMode, 0.5, 0.2, "Okay. Keep adding more options, more advanced options, more cool options. Make this feel legendary.", T("2026-08-29T10:49"), "murmur", { text: said(m, "f3f9ecb"), at: when(m, "f3f9ecb") });
  post(m, { topic: "Glass", at: when(m, "f3f9ecb"), session: "murmur", caption: "Tilt parallax, duotone, an environment, haptics, and tools in the lab.", shots: [lab("14-advanced.png"), lab("14-advanced-tone2.png")], commits: ["f3f9ecb"] });
  push(m, ["e6eb3a5"], "Open source: an MIT license, a short README, and AGENTS.md");
  post(m, { topic: "Open source", at: when(m, "4d39f75"), session: "murmur", caption: "The README's banner and its heroes.", shots: ["readme-collection.png", "readme-droplet.png", "readme-helix.png", "readme-opal.png"].map(lab), commits: ["4d39f75"] });
  push(m, ["84642c4", "fab437f"], "Five new glass heroes: galaxy, lava, horizon, flame, plume");
}

// ---- Praxis ---------------------------------------------------------------------------------
{
  const p = "praxis";
  post(p, { topic: "Landing page", at: when(p, "f6c5936"), caption: "The Praxis site, first pass.", shots: [cap(p, "f6c5936-home"), cap(p, "f6c5936-phone")], commits: ["f6c5936"] });
  post(p, { topic: "Landing page", at: when(p, "0b8a584"), caption: "A clearer site: your iPhone, now your cycling computer.", shots: [cap(p, "0b8a584-home"), cap(p, "0b8a584-phone")], before: [cap(p, "f6c5936-home"), cap(p, "f6c5936-phone")], commits: ["0b8a584", "47b242d"] });
  post(p, { topic: "Praxis Supply", at: when(p, "160cf5a"), caption: "Praxis Supply, a concept store: kit in the app's colors.", shots: [cap(p, "160cf5a-supply")], commits: ["160cf5a", "f63c596"] });
  post(p, { topic: "Landing page", at: when(p, "09afb5c"), caption: "The landing page, rebuilt around the route and the app's real screens.", shots: [cap(p, "09afb5c-home"), cap(p, "09afb5c-phone")], before: [cap(p, "8709c57-home"), cap(p, "8709c57-phone")], commits: ["09afb5c", "1a5388a", "4cf02a4"] });
}

// ---- notes, config, and the stamp the demo shifts from ---------------------------------------
fs.writeFileSync(path.join(OUT, "comments.json"), JSON.stringify(notes, null, 1));
fs.writeFileSync(path.join(OUT, "config.json"), JSON.stringify({
  projects: Object.entries(PROJECTS).map(([key, x]) => ({ key, name: x.name, match: [x.cwd.split("/").pop()] })),
  private: [], folders: false, home: "Home", port: 4795,
}, null, 2));
const newest = Math.max(...posts.map((p) => p.at));
// the newest work lands about an hour before whenever someone opens the demo
fs.writeFileSync(path.join(OUT, "generated"), String(newest + 3600e3));
const edits = demoEdits(OUT);
fs.writeFileSync(path.join(OUT, "version"), demoVersion(OUT));
const bytes = fs.readdirSync(path.join(OUT, "store/img")).filter((f) => !f.endsWith(".json")).reduce((n, f) => n + fs.statSync(path.join(OUT, "store/img", f)).size, 0);
console.log(`demo/: ${posts.length} moments, ${notes.length} notes, ${kept.size} screens, ${edits.files} changed files, ${(bytes / 1e6).toFixed(1)} MB`);
