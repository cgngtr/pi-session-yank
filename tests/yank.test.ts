import test from "node:test";
import assert from "node:assert/strict";

import { copyTextToSystemClipboard, extractCodeBlocks, extractText, parseYankArgs, selectMessages } from "../extensions/yank.ts";

test("extractText joins text blocks and ignores non-text blocks", () => {
	const text = extractText([
		{ type: "text", text: "hello" },
		{ type: "image", url: "ignored" },
		{ type: "text", text: "world" },
	]);

	assert.equal(text, "hello\nworld");
});

test("extractCodeBlocks returns all fenced code blocks", () => {
	const text = [
		"before",
		"```ts",
		"const a = 1;",
		"```",
		"middle",
		"```bash",
		"echo hi",
		"```",
	].join("\n");

	assert.deepEqual(extractCodeBlocks(text), ["const a = 1;", "echo hi"]);
});

test("parseYankArgs parses valid inputs", () => {
	const parsed = parseYankArgs("assistant code all");
	assert.equal(parsed.ok, true);
	if (!parsed.ok) return;
	assert.deepEqual(parsed.request, {
		role: "assistant",
		format: "code",
		amount: "all",
	});
});

test("parseYankArgs rejects invalid inputs", () => {
	const parsed = parseYankArgs("assistant maybe 2");
	assert.equal(parsed.ok, false);
	if (parsed.ok) return;
	assert.match(parsed.message, /Format must be raw or code/);
});

test("selectMessages returns the latest matching messages in chronological order", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "u1" } },
		{ type: "message", message: { role: "assistant", content: "a1" } },
		{ type: "message", message: { role: "assistant", content: "a2" } },
		{ type: "message", message: { role: "user", content: "u2" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "a3" }] } },
	] as any;

	const result = selectMessages(entries, "assistant", 2);
	assert.equal(result.kind, "text");
	if (result.kind !== "text") return;
	assert.deepEqual(result.texts, ["a2", "a3"]);
	assert.equal(result.count, 2);
});

test("copyTextToSystemClipboard chooses Wayland before X11 when available", () => {
	const calls: Array<{ command: string; args: string[]; text: string }> = [];
	const ok = copyTextToSystemClipboard(
		"payload",
		{
			platform: "linux",
			waylandDisplay: "wayland-0",
			display: ":0",
		},
		(command, args, text) => {
			calls.push({ command, args, text });
			return true;
		},
	);

	assert.equal(ok, true);
	assert.deepEqual(calls, [{ command: "wl-copy", args: [], text: "payload" }]);
});
