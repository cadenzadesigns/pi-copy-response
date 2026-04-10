# pi-copy-response

[![npm version](https://img.shields.io/npm/v/pi-copy-response)](https://www.npmjs.com/package/pi-copy-response)
[![npm downloads](https://img.shields.io/npm/dm/pi-copy-response)](https://www.npmjs.com/package/pi-copy-response)

A Pi package that copies the latest assistant response with a code-block picker, live preview, and optional built-in `/copy` override.

## Quick install

```bash
pi install npm:pi-copy-response
```

Adds a Pi slash command:

- `/copy-response`

It also supports subcommands:
- `/copy-response apply`
- `/copy-response restore`
- `/copy-response status`

It copies the latest assistant response.

If that response contains fenced code blocks, `/copy-response` opens a picker with:
- `Full response`
- one entry per fenced code block

The picker includes a live preview of the currently highlighted item, so you can see exactly what will be copied before pressing Enter.

If the latest assistant response has no fenced code blocks, `/copy-response` copies the full response immediately.

## Install

Package links:
- npm: https://www.npmjs.com/package/pi-copy-response
- GitHub: https://github.com/cadenzadesigns/pi-copy-response


### Local path

```bash
pi install /absolute/path/to/pi-copy-response
```

### npm

```bash
pi install npm:pi-copy-response
```

### git

```bash
pi install git:github.com/cadenzadesigns/pi-copy-response
```

## Standard usage

In Pi, run:

```text
/copy-response
```

This copies the latest assistant response, with a picker if fenced code blocks are present.

## Optional override management

If you personally want Pi's built-in `/copy` command to use the same picker and live preview as `/copy-response`, use the built-in override subcommands.

Apply the override:

```text
/copy-response apply
```

Check override status:

```text
/copy-response status
```

Restore original built-in `/copy`:

```text
/copy-response restore
```

After applying or restoring, fully restart Pi.

After restart:
- `/copy` uses the enhanced picker if applied
- `/copy` returns to stock behavior if restored
- `/copy-response` always remains available

## Why the override is optional

Current Pi versions handle built-in interactive commands before extension commands, so a package cannot cleanly replace the exact built-in `/copy` command through standard extension registration alone.

Because of that, this package offers two modes:

1. **Normal package mode**
   - use `/copy-response`
   - no patching
   - best for shared/package use

2. **Personal override mode**
   - run `/copy-response apply`
   - patches your installed Pi locally so `/copy` uses the same behavior
   - best if you want the enhanced UX on your own machine

## Behavior

- no fenced code blocks: copies full latest assistant response immediately
- fenced code blocks present: opens a picker with live preview
- in non-UI contexts: copies the full response

## Notes

- The preview is wrapped for display, but the clipboard gets the raw content.
- Clipboard support uses the system clipboard when available and falls back to OSC 52 terminal clipboard support when possible.
- The optional `/copy` override modifies your local Pi install and may need to be re-applied after Pi upgrades.
