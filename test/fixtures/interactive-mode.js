import { CombinedAutocompleteProvider, Container, fuzzyFilter, Loader, Markdown, matchesKey, ProcessTerminal, Spacer, setKeybindings, Text, TruncatedText, TUI, visibleWidth, } from "@mariozechner/pi-tui";
import { getAvailableThemes, getAvailableThemesWithPaths, getEditorTheme, getMarkdownTheme, getThemeByName, initTheme, onThemeChange, setRegisteredThemes, setTheme, setThemeInstance, stopThemeWatcher, Theme, theme, } from "./theme/theme.js";
import { copyToClipboard } from "../../utils/clipboard.js";

export class InteractiveMode {
    constructor() {
        this.session = {
            getLastAssistantText() {
                return "hello";
            },
        };
        this.editorContainer = { clear() {}, addChild() {} };
        this.editor = {};
        this.ui = { setFocus() {}, requestRender() {} };
    }
    showError(_message) {}
    showStatus(_message) {}
    async handleCopyCommand() {
        const text = this.session.getLastAssistantText();
        if (!text) {
            this.showError("No agent messages to copy yet.");
            return;
        }
        try {
            await copyToClipboard(text);
            this.showStatus("Copied last agent message to clipboard");
        }
        catch (error) {
            this.showError(error instanceof Error ? error.message : String(error));
        }
    }
    handleNameCommand(text) {
        return text;
    }
}
