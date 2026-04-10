import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { SelectList, Text, visibleWidth } from "@mariozechner/pi-tui";

export const LABEL_PREVIEW_LIMIT = 70;
export const COPY_RESPONSE_SUBCOMMANDS = [
  {
    value: "apply",
    label: "apply",
    description: "Make built-in /copy use the same picker and live preview",
  },
  {
    value: "restore",
    label: "restore",
    description: "Restore Pi's original built-in /copy command",
  },
  {
    value: "status",
    label: "status",
    description: "Show whether built-in /copy is currently overridden",
  },
];

export const extractTextBlocks = (content) => {
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

export const getLatestAssistantResponse = (entries) => {
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

export const countLines = (text) => (text.length === 0 ? 1 : text.split("\n").length);

export const truncate = (text, limit) => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1))}…`;
};

export const previewText = (text, limit = LABEL_PREVIEW_LIMIT) => {
  const firstNonEmpty = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return truncate(firstNonEmpty ?? "(empty)", limit);
};

export const sanitizeLang = (lang) => {
  if (!lang) return undefined;
  const clean = lang.replace(/[^a-zA-Z0-9_+.-]/g, "").trim();
  return clean.length > 0 ? clean : undefined;
};

export const extractCodeBlocks = (text) => {
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

export const buildTargets = (response) => {
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

export const parseCopyResponseArgs = (args) => {
  const subcommand = args.trim().toLowerCase();
  if (!subcommand) {
    return { action: "copy" };
  }
  if (subcommand === "apply" || subcommand === "restore" || subcommand === "status") {
    return { action: subcommand };
  }
  return { action: "unknown", subcommand };
};

export const getCopyResponseUsage = () =>
  [
    "Usage:",
    "  /copy-response",
    "  /copy-response apply",
    "  /copy-response restore",
    "  /copy-response status",
  ].join("\n");

export const createCopyTargetPickerComponent = (tui, theme, targets, done) => {
  const items = targets.map((target) => ({
    value: target.id,
    label: target.label,
    description: target.description,
  }));
  const targetsById = new Map(targets.map((target) => [target.id, target]));

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
};
