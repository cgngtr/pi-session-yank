/**
 * Pi extension: copy assistant/user message text or fenced code blocks from the
 * current session branch directly to the clipboard.
 */
import { execFileSync } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry } from "@mariozechner/pi-coding-agent";

type TextBlock = {
	type?: string;
	text?: string;
};

type CopyRole = "assistant" | "user";
type CopyFormat = "raw" | "code";
type CopyAmount = number | "all";

type CopyRequest = {
	role: CopyRole;
	format: CopyFormat;
	amount: CopyAmount;
};

type SelectionResult =
	| { kind: "no-message" }
	| { kind: "no-text" }
	| { kind: "text"; texts: string[]; count: number };

type ClipboardCopyResult = {
	usedOsc52: boolean;
	usedSystemClipboard: boolean;
};

type ClipboardEnvironment = {
	platform: NodeJS.Platform;
	termuxVersion?: string;
	waylandDisplay?: string;
	display?: string;
};

type ClipboardCommandRunner = (command: string, args: string[], text: string) => boolean;

const CLIPBOARD_COMMAND_TIMEOUT_MS = 5000;
const USAGE = [
	"Usage: /yank <assistant|user> <raw|code> [N|all]",
	"Examples:",
	"  /yank assistant raw",
	"  /yank assistant raw 3",
	"  /yank assistant code all",
	"  /yank user raw all",
].join("\n");

export const extractText = (content: unknown): string | undefined => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const textBlock = block as TextBlock;
		if (textBlock.type === "text" && typeof textBlock.text === "string") {
			parts.push(textBlock.text);
		}
	}

	return parts.length > 0 ? parts.join("\n") : undefined;
};

export const extractCodeBlocks = (text: string): string[] => {
	const matches = [...text.matchAll(/```(?:[\w.+-]+)?\n([\s\S]*?)```/g)];
	return matches
		.map((match) => match[1]?.replace(/\n$/, "") ?? "")
		.filter((code) => code.trim().length > 0);
};

export const selectMessages = (
	entries: SessionEntry[],
	role: CopyRole,
	amount: CopyAmount,
): SelectionResult => {
	const texts: string[] = [];

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "message" || !entry.message || entry.message.role !== role) continue;

		const text = extractText(entry.message.content);
		if (!text || text.trim().length === 0) continue;

		texts.push(text);
		if (amount !== "all" && texts.length >= amount) break;
	}

	if (texts.length === 0) {
		const hasMessage = entries.some((entry) => entry.type === "message" && entry.message?.role === role);
		return hasMessage ? { kind: "no-text" } : { kind: "no-message" };
	}

	return {
		kind: "text",
		texts: texts.reverse(),
		count: texts.length,
	};
};

export const parseYankArgs = (args: string): { ok: true; request: CopyRequest } | { ok: false; message: string } => {
	const parts = args.trim().split(/\s+/).filter(Boolean);
	if (parts.length < 2 || parts.length > 3) {
		return { ok: false, message: USAGE };
	}

	const [role, format, amountPart] = parts;
	if (role !== "assistant" && role !== "user") {
		return { ok: false, message: `${USAGE}\n\nRole must be assistant or user.` };
	}
	if (format !== "raw" && format !== "code") {
		return { ok: false, message: `${USAGE}\n\nFormat must be raw or code.` };
	}

	let amount: CopyAmount = 1;
	if (amountPart) {
		if (amountPart === "all") {
			amount = "all";
		} else {
			const parsed = Number.parseInt(amountPart, 10);
			if (!Number.isFinite(parsed) || parsed <= 0) {
				return { ok: false, message: `${USAGE}\n\nAmount must be a positive integer or 'all'.` };
			}
			amount = parsed;
		}
	}

	return {
		ok: true,
		request: { role, format, amount },
	};
};

const canUseOsc52Clipboard = (ctx: Pick<ExtensionCommandContext, "hasUI">) =>
	ctx.hasUI && Boolean(process.stdout.isTTY) && process.env.TERM !== "dumb";

const emitOsc52Clipboard = (text: string, ctx: Pick<ExtensionCommandContext, "hasUI">) => {
	if (!canUseOsc52Clipboard(ctx)) return false;
	const encoded = Buffer.from(text, "utf8").toString("base64");
	process.stdout.write(`\x1b]52;c;${encoded}\x07`);
	return true;
};

const runClipboardCommand: ClipboardCommandRunner = (command, args, text) => {
	execFileSync(command, args, {
		input: text,
		stdio: ["pipe", "ignore", "ignore"],
		timeout: CLIPBOARD_COMMAND_TIMEOUT_MS,
	});
	return true;
};

const tryClipboardCommand = (
	command: string,
	args: string[],
	text: string,
	commandRunner: ClipboardCommandRunner,
) => {
	try {
		return commandRunner(command, args, text);
	} catch {
		return false;
	}
};

const copyToX11Clipboard = (text: string, commandRunner: ClipboardCommandRunner) =>
	tryClipboardCommand("xclip", ["-selection", "clipboard"], text, commandRunner) ||
	tryClipboardCommand("xsel", ["--clipboard", "--input"], text, commandRunner);

export const copyTextToSystemClipboard = (
	text: string,
	environment: ClipboardEnvironment,
	commandRunner: ClipboardCommandRunner = runClipboardCommand,
) => {
	if (environment.platform === "darwin") {
		return tryClipboardCommand("pbcopy", [], text, commandRunner);
	}
	if (environment.platform === "win32") {
		return tryClipboardCommand("clip", [], text, commandRunner);
	}
	if (environment.termuxVersion && tryClipboardCommand("termux-clipboard-set", [], text, commandRunner)) {
		return true;
	}
	if (environment.waylandDisplay && tryClipboardCommand("wl-copy", [], text, commandRunner)) {
		return true;
	}
	if (environment.display) {
		return copyToX11Clipboard(text, commandRunner);
	}
	return false;
};

const copyTextSafely = (text: string, ctx: Pick<ExtensionCommandContext, "hasUI">): ClipboardCopyResult => {
	const usedOsc52 = emitOsc52Clipboard(text, ctx);
	const usedSystemClipboard = copyTextToSystemClipboard(text, {
		platform: process.platform,
		termuxVersion: process.env.TERMUX_VERSION,
		waylandDisplay: process.env.WAYLAND_DISPLAY,
		display: process.env.DISPLAY,
	});

	if (!usedOsc52 && !usedSystemClipboard) {
		throw new Error("No supported clipboard transport is available in this environment.");
	}

	return { usedOsc52, usedSystemClipboard };
};

const describeSelection = (role: CopyRole, format: CopyFormat, amount: CopyAmount, actualCount: number) => {
	const roleLabel = role === "assistant" ? "assistant" : "user";
	const scope = amount === "all"
		? `all ${roleLabel} messages`
		: actualCount === 1
			? `${roleLabel} message`
			: `${actualCount} ${roleLabel} messages`;

	return format === "raw" ? scope : `code from ${scope}`;
};

const handleYankCommand = (args: string, ctx: ExtensionCommandContext) => {
	const parsed = parseYankArgs(args);
	if (!parsed.ok) {
		ctx.ui.notify(parsed.message, "warning");
		return;
	}

	const { role, format, amount } = parsed.request;
	const selection = selectMessages(ctx.sessionManager.getBranch(), role, amount);
	const roleLabel = role === "assistant" ? "assistant" : "user";

	if (selection.kind === "no-message") {
		ctx.ui.notify(`No ${roleLabel} message found.`, "warning");
		return;
	}
	if (selection.kind === "no-text") {
		ctx.ui.notify(`No ${roleLabel} message with text found.`, "warning");
		return;
	}

	const payload = format === "raw"
		? selection.texts.join("\n\n")
		: selection.texts.flatMap((text) => extractCodeBlocks(text)).join("\n\n");

	if (!payload.trim()) {
		ctx.ui.notify(`No fenced code blocks found in the selected ${roleLabel} message${selection.count > 1 ? "s" : ""}.`, "warning");
		return;
	}

	const selectionLabel = describeSelection(role, format, amount, selection.count);
	try {
		const copyResult = copyTextSafely(payload, ctx);
		ctx.ui.notify(
			copyResult.usedSystemClipboard
				? `Copied ${selectionLabel} to clipboard.`
				: `Sent ${selectionLabel} via terminal clipboard (OSC 52).`,
			"info",
		);
	} catch (error) {
		ctx.ui.notify(
			`Failed to copy ${selectionLabel}: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	}
};

export default function (pi: ExtensionAPI) {
	pi.registerCommand("yank", {
		description: "Copy content with /yank <assistant|user> <raw|code> [N|all]",
		handler: async (args, ctx) => {
			handleYankCommand(args, ctx);
		},
	});
}
