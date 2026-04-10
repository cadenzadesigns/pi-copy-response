import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyPatch, getPatchStatus, restorePatch } from "../lib/patch-pi-copy.js";

const fixturePath = path.resolve("test/fixtures/interactive-mode.js");

test("applyPatch and restorePatch work against a temporary interactive-mode.js", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-response-patch-"));
  const targetPath = path.join(tmpDir, "interactive-mode.js");
  const originalText = fs.readFileSync(fixturePath, "utf8");
  fs.writeFileSync(targetPath, originalText);

  const previousTarget = process.env.PI_COPY_RESPONSE_TARGET;
  process.env.PI_COPY_RESPONSE_TARGET = targetPath;

  t.after(() => {
    if (previousTarget === undefined) delete process.env.PI_COPY_RESPONSE_TARGET;
    else process.env.PI_COPY_RESPONSE_TARGET = previousTarget;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const initialStatus = getPatchStatus();
  assert.equal(initialStatus.status, "stock");
  assert.equal(initialStatus.backupExists, false);

  const applyResult = applyPatch();
  assert.equal(applyResult.alreadyPatched, false);

  const patchedText = fs.readFileSync(targetPath, "utf8");
  assert.match(patchedText, /Preview shows the exact clipboard contents/);
  assert.match(patchedText, /SelectList/);
  assert.match(patchedText, /getSelectListTheme/);

  const patchedStatus = getPatchStatus();
  assert.equal(patchedStatus.status, "patched");
  assert.equal(patchedStatus.backupExists, true);

  const restoreResult = restorePatch();
  assert.equal(restoreResult.restored, true);
  const restoredText = fs.readFileSync(targetPath, "utf8");
  assert.equal(restoredText, originalText);
});
