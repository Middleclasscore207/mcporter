import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadServerDefinitions } from "../src/config.js";

const FIXTURE_ROOT = path.resolve(__dirname, "fixtures", "config-sources");

const PROJECT_MCP = path.join(FIXTURE_ROOT, ".mcp.json");
const CURSOR_PROJECT = path.join(FIXTURE_ROOT, ".cursor", "mcp.json");
const CLAUDE_PROJECT = path.join(FIXTURE_ROOT, ".claude", "mcp.json");
const CODEX = path.join(FIXTURE_ROOT, ".codex", "config.toml");

describe("loadServerDefinitions with merged sources", () => {
	const sources = [
		{ kind: "project-mcp-json" as const, path: PROJECT_MCP, optional: false },
		{ kind: "cursor-project" as const, path: CURSOR_PROJECT, optional: false },
		{ kind: "claude-project" as const, path: CLAUDE_PROJECT, optional: false },
		{ kind: "codex" as const, path: CODEX, optional: false },
	];

	it("prefers the first occurrence of duplicate names by default", async () => {
		const definitions = await loadServerDefinitions({
			sources,
			rootDir: FIXTURE_ROOT,
		});

		expect(definitions.map((entry) => entry.name).sort()).toEqual([
			"claude-only",
			"codex-only",
			"cursor-only",
			"project-only",
			"shared",
		]);

		const shared = definitions.find((entry) => entry.name === "shared");
		expect(shared).toBeDefined();
		expect(shared?.command.kind).toBe("http");
		expect(
			shared?.command.kind === "http" ? shared.command.url.toString() : "",
		).toBe("https://project.local/mcp");
		expect(
			shared?.command.kind === "http" ? shared.command.headers : undefined,
		).toEqual({
			Authorization: "Bearer project",
		});

		const cursorOnly = definitions.find(
			(entry) => entry.name === "cursor-only",
		);
		expect(cursorOnly?.command.kind).toBe("stdio");
		expect(cursorOnly?.env).toEqual({ CURSOR_FLAG: "1" });

		const claudeOnly = definitions.find(
			(entry) => entry.name === "claude-only",
		);
		expect(claudeOnly?.command.kind).toBe("stdio");
		expect(
			claudeOnly?.command.kind === "stdio" ? claudeOnly.command.command : "",
		).toBe("python");
	});

	it("allows switching to last-wins merging when requested", async () => {
		const definitions = await loadServerDefinitions({
			sources,
			rootDir: FIXTURE_ROOT,
			strategy: "last-wins",
		});

		const shared = definitions.find((entry) => entry.name === "shared");
		expect(shared).toBeDefined();
		expect(shared?.command.kind).toBe("http");
		expect(
			shared?.command.kind === "http" ? shared.command.url.toString() : "",
		).toBe("https://codex.local/mcp");
		expect(
			shared?.command.kind === "http" ? shared.command.headers : undefined,
		).toEqual({
			Authorization: "$env:CODEX_TOKEN",
			"X-Custom": "codex",
		});
	});
});
