import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = path.resolve(".");
const piCliPath = path.resolve("node_modules/@mariozechner/pi-coding-agent/dist/cli.js");
const fixturePath = path.resolve("test/fixtures/interactive-mode.js");

const runPiCommand = (cwd, env, prompt) =>
  spawnSync(
    process.execPath,
    [
      piCliPath,
      "--provider",
      "anthropic",
      "--model",
      "sonnet",
      "--api-key",
      "test",
      "--no-session",
      "--offline",
      "-p",
      prompt,
    ],
    {
      cwd,
      env,
      encoding: "utf8",
    },
  );

test("runtime integration: package registers /copy-response and apply/restore work through Pi", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-response-runtime-"));
  const agentDir = path.join(tmpDir, "agent");
  const targetPath = path.join(tmpDir, "interactive-mode.js");
  const originalText = fs.readFileSync(fixturePath, "utf8");
  fs.writeFileSync(targetPath, originalText);

  const env = {
    ...process.env,
    HOME: tmpDir,
    PI_CODING_AGENT_DIR: agentDir,
    PI_COPY_RESPONSE_TARGET: targetPath,
    PI_OFFLINE: "1",
  };

  t.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const install = spawnSync(process.execPath, [piCliPath, "install", packageRoot], {
    cwd: tmpDir,
    env,
    encoding: "utf8",
  });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const rlMod = await import("../node_modules/@mariozechner/pi-coding-agent/dist/core/resource-loader.js");
  const settingsMod = await import("../node_modules/@mariozechner/pi-coding-agent/dist/core/settings-manager.js");
  const { DefaultResourceLoader } = rlMod;
  const { SettingsManager } = settingsMod;

  const settings = SettingsManager.create(tmpDir, agentDir);
  await settings.reload();
  const loader = new DefaultResourceLoader({ agentDir, cwd: tmpDir, settingsManager: settings });
  await loader.reload();
  const commandNames = loader.getExtensions().extensions.flatMap((extension) => [...extension.commands.keys()]);
  assert.deepEqual(commandNames, ["copy-response"]);

  const applyRun = runPiCommand(tmpDir, env, "/copy-response apply");
  assert.equal(applyRun.status, 0, applyRun.stderr || applyRun.stdout);
  const patchedText = fs.readFileSync(targetPath, "utf8");
  assert.match(patchedText, /Preview shows the exact clipboard contents/);

  const restoreRun = runPiCommand(tmpDir, env, "/copy-response restore");
  assert.equal(restoreRun.status, 0, restoreRun.stderr || restoreRun.stdout);
  const restoredText = fs.readFileSync(targetPath, "utf8");
  assert.equal(restoredText, originalText);
});
