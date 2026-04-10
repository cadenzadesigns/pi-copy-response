import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HANDLE_COPY_TEMPLATE_PATH = path.join(__dirname, "handle-copy-command.txt");
const PATCH_MARKER = "Preview shows the exact clipboard contents (wrapped for display).";
const BACKUP_SUFFIX = ".bak-pi-copy-response";
const LEGACY_BACKUP_SUFFIXES = [".bak-copy-original"];

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function findPiBinaryPath() {
  return run("bash", ["-lc", "command -v pi"]);
}

export function resolvePiPaths() {
  const candidates = [];
  const envPath = process.env.PI_COPY_RESPONSE_TARGET || process.env.PI_CODING_AGENT_PATH;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (resolved.endsWith("interactive-mode.js")) {
      candidates.push(resolved);
    } else if (resolved.endsWith("@mariozechner/pi-coding-agent")) {
      candidates.push(path.join(resolved, "dist", "modes", "interactive", "interactive-mode.js"));
    }
  }

  const piBinary = findPiBinaryPath();
  if (piBinary) {
    try {
      const realPi = fs.realpathSync(piBinary);
      const distDir = path.dirname(realPi);
      const packageRoot = path.dirname(distDir);
      candidates.push(path.join(distDir, "modes", "interactive", "interactive-mode.js"));
      candidates.push(path.join(packageRoot, "dist", "modes", "interactive", "interactive-mode.js"));
    } catch {
      // Ignore and continue.
    }
  }

  const npmRoot = run("npm", ["root", "-g"]);
  if (npmRoot) {
    candidates.push(path.join(npmRoot, "@mariozechner", "pi-coding-agent", "dist", "modes", "interactive", "interactive-mode.js"));
  }

  const interactiveModePath = unique(candidates).find((candidate) => fs.existsSync(candidate));
  if (!interactiveModePath) {
    throw new Error(
      "Could not find Pi's interactive-mode.js. Set PI_COPY_RESPONSE_TARGET to the file path or @mariozechner/pi-coding-agent package root.",
    );
  }

  return {
    interactiveModePath,
    backupPath: `${interactiveModePath}${BACKUP_SUFFIX}`,
  };
}

function readHandleCopyTemplate() {
  return fs.readFileSync(HANDLE_COPY_TEMPLATE_PATH, "utf8");
}

function getBackupCandidates(interactiveModePath) {
  return [
    `${interactiveModePath}${BACKUP_SUFFIX}`,
    ...LEGACY_BACKUP_SUFFIXES.map((suffix) => `${interactiveModePath}${suffix}`),
  ];
}

function getExistingBackupPath(interactiveModePath) {
  return getBackupCandidates(interactiveModePath).find((candidate) => fs.existsSync(candidate));
}

function ensureNamedImport(text, moduleSpecifier, symbol, afterSymbol) {
  const escapedModule = moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`import \\{([^}]*)\\} from \"${escapedModule}\";`);
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Could not find import for ${moduleSpecifier}`);
  }
  const rawItems = match[1]
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (rawItems.includes(symbol)) return text;
  const insertAt = afterSymbol ? rawItems.indexOf(afterSymbol) + 1 : rawItems.length;
  if (insertAt <= 0) rawItems.push(symbol);
  else rawItems.splice(insertAt, 0, symbol);
  const replacement = `import { ${rawItems.join(", ")} } from \"${moduleSpecifier}\";`;
  return text.replace(match[0], replacement);
}

function replaceHandleCopyCommand(text) {
  const replacement = `${readHandleCopyTemplate()}\n    handleNameCommand(text) {`;
  const pattern = /    async handleCopyCommand\(\) \{[\s\S]*?^    handleNameCommand\(text\) \{/m;
  if (!pattern.test(text)) {
    throw new Error("Could not find handleCopyCommand() in interactive-mode.js");
  }
  return text.replace(pattern, replacement);
}

export function getPatchStatus() {
  const { interactiveModePath, backupPath } = resolvePiPaths();
  const text = fs.readFileSync(interactiveModePath, "utf8");
  const existingBackupPath = getExistingBackupPath(interactiveModePath);
  let status = "unknown";
  if (text.includes(PATCH_MARKER)) status = "patched";
  else if (text.includes('this.showStatus("Copied last agent message to clipboard")')) status = "stock";

  return {
    status,
    interactiveModePath,
    backupPath,
    existingBackupPath,
    backupExists: Boolean(existingBackupPath),
  };
}

export function applyPatch() {
  const { interactiveModePath, backupPath } = resolvePiPaths();
  let text = fs.readFileSync(interactiveModePath, "utf8");

  if (text.includes(PATCH_MARKER)) {
    const existingBackupPath = getExistingBackupPath(interactiveModePath);
    if (!fs.existsSync(backupPath) && existingBackupPath && existingBackupPath !== backupPath) {
      fs.copyFileSync(existingBackupPath, backupPath);
    }
    return {
      changed: false,
      alreadyPatched: true,
      interactiveModePath,
      backupPath,
    };
  }

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(interactiveModePath, backupPath);
  }

  text = ensureNamedImport(text, "@mariozechner/pi-tui", "SelectList", "ProcessTerminal");
  text = ensureNamedImport(text, "./theme/theme.js", "getSelectListTheme", "getMarkdownTheme");
  text = replaceHandleCopyCommand(text);
  fs.writeFileSync(interactiveModePath, text);

  return {
    changed: true,
    alreadyPatched: false,
    interactiveModePath,
    backupPath,
  };
}

export function restorePatch() {
  const { interactiveModePath, backupPath } = resolvePiPaths();
  const existingBackupPath = getExistingBackupPath(interactiveModePath);
  if (!existingBackupPath) {
    throw new Error(`Backup not found: ${backupPath}`);
  }
  fs.copyFileSync(existingBackupPath, interactiveModePath);
  return {
    restored: true,
    interactiveModePath,
    backupPath: existingBackupPath,
  };
}
