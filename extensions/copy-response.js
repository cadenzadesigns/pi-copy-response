import { execFileSync } from "node:child_process";

import {
  buildTargets,
  COPY_RESPONSE_SUBCOMMANDS,
  createCopyTargetPickerComponent,
  getCopyResponseUsage,
  getLatestAssistantResponse,
  parseCopyResponseArgs,
} from "../lib/copy-response-core.js";
import { applyPatch, getPatchStatus, restorePatch } from "../lib/patch-pi-copy.js";

const CLIPBOARD_COMMAND_TIMEOUT_MS = 5000;

const canUseOsc52Clipboard = (ctx) => ctx.hasUI && Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";

const emitOsc52Clipboard = (text, ctx) => {
  if (!canUseOsc52Clipboard(ctx)) return false;
  const encoded = Buffer.from(text, "utf8").toString("base64");
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
};

const runClipboardCommand = (command, args, text) => {
  execFileSync(command, args, {
    input: text,
    stdio: ["pipe", "ignore", "ignore"],
    timeout: CLIPBOARD_COMMAND_TIMEOUT_MS,
  });
  return true;
};

const tryClipboardCommand = (command, args, text) => {
  try {
    return runClipboardCommand(command, args, text);
  } catch {
    return false;
  }
};

const copyToX11Clipboard = (text) =>
  tryClipboardCommand("xclip", ["-selection", "clipboard"], text) ||
  tryClipboardCommand("xsel", ["--clipboard", "--input"], text);

const copyTextToSystemClipboard = (text) => {
  if (process.platform === "darwin") {
    return tryClipboardCommand("pbcopy", [], text);
  }

  if (process.platform === "win32") {
    return tryClipboardCommand("clip", [], text);
  }

  if (process.env.TERMUX_VERSION && tryClipboardCommand("termux-clipboard-set", [], text)) {
    return true;
  }

  if (process.env.WAYLAND_DISPLAY && tryClipboardCommand("wl-copy", [], text)) {
    return true;
  }

  if (process.env.DISPLAY) {
    return copyToX11Clipboard(text);
  }

  return false;
};

const copyTextSafely = (text, ctx) => {
  const usedOsc52 = emitOsc52Clipboard(text, ctx);
  const usedSystemClipboard = copyTextToSystemClipboard(text);

  if (!usedOsc52 && !usedSystemClipboard) {
    throw new Error("No supported clipboard transport is available in this environment.");
  }

  return { usedOsc52, usedSystemClipboard };
};

const notifyCopySuccess = (ctx, copyResult, label) => {
  if (copyResult.usedSystemClipboard) {
    ctx.ui.notify(`Copied ${label} to clipboard.`, "info");
    return;
  }
  ctx.ui.notify(`Sent ${label} via the terminal clipboard (OSC 52).`, "info");
};

const selectCopyTarget = async (ctx, targets) =>
  ctx.ui.custom((tui, theme, _kb, done) => createCopyTargetPickerComponent(tui, theme, targets, done));

const copyAssistantResponse = async (ctx) => {
  const response = getLatestAssistantResponse(ctx.sessionManager.getBranch());
  if (!response) {
    ctx.ui.notify("No assistant response with text found.", "warning");
    return;
  }

  const targets = buildTargets(response);
  const copyNow = async (target) => {
    try {
      const result = copyTextSafely(target.text, ctx);
      notifyCopySuccess(ctx, result, target.id === "full" ? "response" : target.label.toLowerCase());
    } catch (error) {
      ctx.ui.notify(`Failed to copy response: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  if (targets.length === 1 || !ctx.hasUI) {
    await copyNow(targets[0]);
    return;
  }

  const selectedId = await selectCopyTarget(ctx, targets);
  if (!selectedId) {
    ctx.ui.notify("Copy cancelled.", "info");
    return;
  }

  const selected = targets.find((target) => target.id === selectedId);
  if (!selected) {
    ctx.ui.notify("Copy target not found.", "error");
    return;
  }

  await copyNow(selected);
};

export default function copyResponseExtension(pi) {
  pi.registerCommand("copy-response", {
    description: "Copy the latest assistant response, or manage the optional /copy override",
    getArgumentCompletions: (prefix) => {
      const trimmedPrefix = prefix.trim().toLowerCase();
      const matches = COPY_RESPONSE_SUBCOMMANDS.filter((item) => item.value.startsWith(trimmedPrefix));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const parsed = parseCopyResponseArgs(args);

      if (parsed.action === "copy") {
        await copyAssistantResponse(ctx);
        return;
      }

      if (parsed.action === "status") {
        try {
          const status = getPatchStatus();
          const backup = status.backupExists ? "backup present" : "no backup found";
          ctx.ui.notify(
            [`/copy status: ${status.status}`, backup, `interactive-mode: ${status.interactiveModePath}`].join("\n"),
            status.status === "patched" ? "success" : "info",
          );
        } catch (error) {
          ctx.ui.notify(`Failed to read /copy override status: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return;
      }

      if (parsed.action === "apply") {
        try {
          const result = applyPatch();
          if (result.alreadyPatched) {
            ctx.ui.notify("/copy is already using the enhanced picker. Restart Pi if you still see the old behavior.", "success");
          } else {
            ctx.ui.notify(`Enhanced /copy installed. Restart Pi to use it.\nPatched: ${result.interactiveModePath}`, "success");
          }
        } catch (error) {
          ctx.ui.notify(`Failed to override /copy: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return;
      }

      if (parsed.action === "restore") {
        try {
          const result = restorePatch();
          ctx.ui.notify(`Original /copy restored. Restart Pi to use it.\nRestored from: ${result.backupPath}`, "success");
        } catch (error) {
          ctx.ui.notify(`Failed to restore /copy: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        return;
      }

      ctx.ui.notify(`Unknown subcommand: ${parsed.subcommand}\n\n${getCopyResponseUsage()}`, "warning");
    },
  });
}
