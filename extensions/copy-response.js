import { execFileSync } from "node:child_process";

import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, SelectList, Text, visibleWidth } from "@mariozechner/pi-tui";

import { applyPatch, getPatchStatus, restorePatch } from "../lib/patch-pi-copy.js";

const CLIPBOARD_COMMAND_TIMEOUT_MS = 5000;
const LABEL_PREVIEW_LIMIT = 70;

const extractTextBlocks = (content) => {
  if (typeof content === "string") {
    return content.trim().length > 0 ? [content] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) {
      parts.push(block.text);
    }
  }
  return parts;
};

const getLatestAssistantResponse = (entries) => {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || !entry.message || entry.message.role !== "assistant") continue;

    const textBlocks = extractTextBlocks(entry.message.content);
    if (textBlocks.length === 0) continue;

    const fullText = textBlocks.join("\n\n");
    if (fullText.trim().length === 0) continue;

    return { fullText };
  }

  return undefined;
};

const countLines = (text) => (text.length === 0 ? 1 : text.split("\n").length);

const truncate = (text, limit) => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1))}…`;
};

const previewText = (text, limit = LABEL_PREVIEW_LIMIT) => {
  const firstNonEmpty = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return truncate(firstNonEmpty ?? "(empty)", limit);
};

const sanitizeLang = (lang) => {
  if (!lang) return undefined;
  const clean = lang.replace(/[^a-zA-Z0-9_+.-]/g, "").trim();
  return clean.length > 0 ? clean : undefined;
};

const extractCodeBlocks = (text) => {
  const lines = text.split("\n");
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(`{3,})(.*)$/);
    if (!open) continue;

    const fence = open[1];
    const info = open[2].trim();
    const lang = sanitizeLang(info.split(/\s+/)[0]);
    const codeLines = [];
    let closed = false;

    for (i = i + 1; i < lines.length; i++) {
      if (lines[i].startsWith(fence)) {
        closed = true;
        break;
      }
      codeLines.push(lines[i]);
    }

    if (closed) {
      blocks.push({ lang, code: codeLines.join("\n") });
    }
  }

  return blocks;
};

const buildTargets = (response) => {
  const fullText = response.fullText;
  const targets = [
    {
      id: "full",
      label: "Full response",
      description: `${fullText.length} chars, ${countLines(fullText)} lines`,
      text: fullText,
    },
  ];

  const codeBlocks = extractCodeBlocks(fullText);
  for (let i = 0; i < codeBlocks.length; i++) {
    const block = codeBlocks[i];
    targets.push({
      id: `code-${i + 1}`,
      label: `Code block ${i + 1}`,
      description: `${block.lang ?? "plain text"} • ${countLines(block.code)} lines • ${previewText(block.code)}`,
      text: block.code,
    });
  }

  return targets;
};

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

const selectCopyTarget = async (ctx, targets) => {
  const items = targets.map((target) => ({
    value: target.id,
    label: target.label,
    description: target.description,
  }));
  const targetsById = new Map(targets.map((target) => [target.id, target]));

  return ctx.ui.custom((tui, theme, _kb, done) => {
    let currentTarget = targets[0];
    const border = new DynamicBorder((s) => theme.fg("border", s));
    const selectList = new SelectList(items, Math.min(items.length, 10), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    }, {
      minPrimaryColumnWidth: 12,
      maxPrimaryColumnWidth: 32,
    });

    const initialSelection = selectList.getSelectedItem();
    if (initialSelection) {
      currentTarget = targetsById.get(initialSelection.value) ?? currentTarget;
    }

    const padLine = (line, width) => line + " ".repeat(Math.max(0, width - visibleWidth(line)));
    const clipLines = (lines, maxLines) => {
      if (lines.length <= maxLines) return lines;
      const visibleLines = lines.slice(0, Math.max(1, maxLines - 1));
      const hiddenCount = lines.length - visibleLines.length;
      visibleLines.push(theme.fg("dim", `… ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`));
      return visibleLines;
    };
    const renderPreview = (width) => {
      const preview = new Text(currentTarget.text, 1, 0);
      const maxLines = Math.max(8, (tui.terminal?.rows ?? 24) - 10);
      return clipLines(preview.render(width), maxLines);
    };

    selectList.onSelectionChange = (item) => {
      currentTarget = targetsById.get(item.value) ?? currentTarget;
      tui.requestRender();
    };
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);

    return {
      render: (width) => {
        const lines = [];
        lines.push(...border.render(width));
        lines.push(...new Text(theme.fg("accent", theme.bold("Select content to copy")), 1, 0).render(width));
        lines.push(...new Text(theme.fg("dim", "Preview shows the exact clipboard contents (wrapped for display)."), 1, 0).render(width));

        if (width >= 96) {
          const gutter = theme.fg("border", " │ ");
          const gutterWidth = visibleWidth(gutter);
          const listWidth = Math.max(28, Math.min(40, Math.floor((width - gutterWidth) * 0.34)));
          const previewWidth = Math.max(24, width - gutterWidth - listWidth);
          lines.push(
            padLine(theme.fg("accent", theme.bold("Choices")), listWidth) +
              gutter +
              padLine(theme.fg("accent", theme.bold(`Preview — ${currentTarget.label}`)), previewWidth),
          );
          const listLines = selectList.render(listWidth);
          const previewLines = renderPreview(previewWidth);
          const bodyHeight = Math.max(listLines.length, previewLines.length);
          for (let i = 0; i < bodyHeight; i++) {
            lines.push(
              padLine(listLines[i] ?? "", listWidth) + gutter + padLine(previewLines[i] ?? "", previewWidth),
            );
          }
        } else {
          lines.push(...new Text(theme.fg("accent", theme.bold("Choices")), 1, 0).render(width));
          lines.push(...selectList.render(width));
          lines.push(...border.render(width));
          lines.push(...new Text(theme.fg("accent", theme.bold(`Preview — ${currentTarget.label}`)), 1, 0).render(width));
          lines.push(...renderPreview(width));
        }

        lines.push(...new Text(theme.fg("dim", "  ↑/↓ to change preview · Enter to copy · Esc to cancel"), 0, 0).render(width));
        lines.push(...border.render(width));
        return lines;
      },
      invalidate: () => {
        border.invalidate();
        selectList.invalidate();
      },
      handleInput: (data) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
};

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
    description: "Copy the latest assistant response, or pick a code block to copy",
    handler: async (_args, ctx) => {
      await copyAssistantResponse(ctx);
    },
  });

  pi.registerCommand("copy-response-status", {
    description: "Show whether Pi's built-in /copy is using the enhanced picker",
    handler: async (_args, ctx) => {
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
    },
  });

  pi.registerCommand("copy-response-apply", {
    description: "Make Pi's built-in /copy use the same picker and live preview",
    handler: async (_args, ctx) => {
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
    },
  });

  pi.registerCommand("copy-response-restore", {
    description: "Restore Pi's original built-in /copy command",
    handler: async (_args, ctx) => {
      try {
        const result = restorePatch();
        ctx.ui.notify(`Original /copy restored. Restart Pi to use it.\nRestored from: ${result.backupPath}`, "success");
      } catch (error) {
        ctx.ui.notify(`Failed to restore /copy: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
