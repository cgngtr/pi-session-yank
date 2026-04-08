# pi-session-yank

A Pi extension that copies assistant or user message content from the current session branch directly to your clipboard.

It avoids terminal selection issues caused by soft wrapping in the Pi TUI.

## What it does

Adds one command:

```text
/yank <assistant|user> <raw|code> [N|all]
```

Examples:

```text
/yank assistant raw
/yank assistant raw 3
/yank assistant code all
/yank user raw all
```

## Semantics

- `assistant|user` selects which role to copy from
- `raw|code` selects whether to copy plain text or fenced code blocks
- `[N|all]` selects how many messages to scan
  - omitted = `1`
  - `N` = last `N` matching messages
  - `all` = all matching messages in the current branch

Important detail:
- `amount` is **message scope**
- `code` copies **all fenced code blocks inside the selected messages**

So:

```text
/yank assistant code 3
```

means: copy all fenced code blocks from the last 3 assistant messages.

## Install

From npm:

```bash
pi install npm:pi-session-yank
```

From a local checkout during development:

```bash
pi -e ./extensions/yank.ts
```

Then reload Pi inside the app:

```text
/reload
```

## Clipboard behavior

The extension tries the system clipboard first, with OSC 52 terminal clipboard support as a fallback when available.

On Linux-family systems it tries these transports as available:

- `termux-clipboard-set`
- `wl-copy`
- `xclip`
- `xsel`

## Warnings and limitations

- Only text blocks are copied from messages.
- Attachments and images are ignored.
- `code` mode only extracts fenced code blocks using triple backticks.
- The command works on the current session branch only.

## Development

Run checks:

```bash
npm install
npm run check
```
