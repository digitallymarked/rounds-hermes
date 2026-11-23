// `rounds hermes ...` and `rounds relay ...`: wiring Rounds into Hermes. Nothing here edits a
// Hermes config file: it prints the snippets (and a launchd plist) for you to apply, or applies
// them only where you ask (`launchd install`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const LABEL = "dev.rounds.hermes-relay";
const plistPath = () => path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);

export function snippets(root, { dataDir } = {}) {
  const node = process.execPath;
  const env = dataDir ? `\n    env:\n      ROUNDS_HOME: ${dataDir}` : "";
  const hook = `${node} ${path.join(root, "hooks", "hermes.mjs")}`;
  const hookEnv = dataDir ? `ROUNDS_HOME=${dataDir} ` : "";
  return `# --- config.yaml (every profile whose sessions should post to Rounds) ---
mcp_servers:
  rounds:
    command: ${node}
    args:
      - ${path.join(root, "bin", "rounds.mjs")}
      - mcp
    enabled: true${env}
hooks:
  post_tool_call:
    - matcher: (mcp_+)?rounds_+rounds_(post|change)
      command: ${hookEnv}${hook}
      timeout: 10
  pre_llm_call:
    - command: ${hookEnv}${hook}
      timeout: 10
`;
}

export function plist(root, { dataDir } = {}) {
  const log = path.join(dataDir || path.join(os.homedir(), ".rounds"), "relay.log");
  const envs = { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", ...(dataDir ? { ROUNDS_HOME: dataDir } : {}) };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(root, "bin", "rounds.mjs")}</string><string>relay</string></array>
  <key>EnvironmentVariables</key><dict>${Object.entries(envs).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join("")}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
}

export function launchd(action, root, opts = {}) {
  const f = plistPath();
  const uid = process.getuid();
  if (action === "install") {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, plist(root, opts));
    try { execFileSync("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { stdio: "ignore" }); } catch {}
    execFileSync("launchctl", ["bootstrap", `gui/${uid}`, f], { stdio: "inherit" });
    return `Installed and started ${LABEL} (${f}). It restarts at login and if it stops.`;
  }
  if (action === "remove") {
    try { execFileSync("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { stdio: "ignore" }); } catch {}
    fs.rmSync(f, { force: true });
    return `Removed ${LABEL}.`;
  }
  if (action === "print") return plist(root, opts);
  throw new Error("rounds relay launchd <install|remove|print>");
}
