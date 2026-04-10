import test from "node:test";
import assert from "node:assert/strict";

import {
  buildTargets,
  createCopyTargetPickerComponent,
  extractCodeBlocks,
  extractTextBlocks,
  getLatestAssistantResponse,
  parseCopyResponseArgs,
} from "../lib/copy-response-core.js";

const createTheme = () => ({
  fg: (_color, text) => text,
  bold: (text) => text,
});

test("extractTextBlocks keeps only non-empty text blocks", () => {
  assert.deepEqual(extractTextBlocks("hello"), ["hello"]);
  assert.deepEqual(
    extractTextBlocks([
      { type: "text", text: "first" },
      { type: "image", url: "ignored" },
      { type: "text", text: "  " },
      { type: "text", text: "second" },
    ]),
    ["first", "second"],
  );
  assert.deepEqual(extractTextBlocks(null), []);
});

test("getLatestAssistantResponse returns the latest assistant text", () => {
  const response = getLatestAssistantResponse([
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: "older" }] } },
    { type: "message", message: { role: "user", content: "ignore user" } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "newer" },
          { type: "text", text: "response" },
        ],
      },
    },
  ]);

  assert.deepEqual(response, { fullText: "newer\n\nresponse" });
});

test("buildTargets includes full response and fenced code blocks", () => {
  const response = {
    fullText: [
      "Intro",
      "```bash",
      "echo hello",
      "```",
      "",
      "```json",
      '{"ok":true}',
      "```",
    ].join("\n"),
  };

  const codeBlocks = extractCodeBlocks(response.fullText);
  assert.deepEqual(codeBlocks, [
    { lang: "bash", code: "echo hello" },
    { lang: "json", code: '{"ok":true}' },
  ]);

  const targets = buildTargets(response);
  assert.equal(targets.length, 3);
  assert.equal(targets[0]?.id, "full");
  assert.equal(targets[1]?.label, "Code block 1");
  assert.equal(targets[2]?.text, '{"ok":true}');
});

test("parseCopyResponseArgs routes main command and subcommands", () => {
  assert.deepEqual(parseCopyResponseArgs(""), { action: "copy" });
  assert.deepEqual(parseCopyResponseArgs(" apply "), { action: "apply" });
  assert.deepEqual(parseCopyResponseArgs("restore"), { action: "restore" });
  assert.deepEqual(parseCopyResponseArgs("status"), { action: "status" });
  assert.deepEqual(parseCopyResponseArgs("wat"), { action: "unknown", subcommand: "wat" });
});

test("picker component renders preview and updates selection with arrow keys", () => {
  let selectedValue = null;
  let renderRequests = 0;
  const tui = {
    terminal: { rows: 24 },
    requestRender() {
      renderRequests += 1;
    },
  };
  const component = createCopyTargetPickerComponent(
    tui,
    createTheme(),
    [
      { id: "full", label: "Full response", description: "full", text: "full body" },
      { id: "code-1", label: "Code block 1", description: "bash", text: "echo one" },
    ],
    (value) => {
      selectedValue = value;
    },
  );

  const initial = component.render(120).join("\n");
  assert.match(initial, /Select content to copy/);
  assert.match(initial, /Preview — Full response/);
  assert.match(initial, /full body/);

  component.handleInput?.("\u001b[B");
  const afterDown = component.render(120).join("\n");
  assert.match(afterDown, /Preview — Code block 1/);
  assert.match(afterDown, /echo one/);
  assert.ok(renderRequests > 0);

  component.handleInput?.("\r");
  assert.equal(selectedValue, "code-1");
});
