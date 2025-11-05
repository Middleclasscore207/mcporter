import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseToml } from "@iarna/toml";
import { z } from "zod";
import { expandHome } from "./env.js";

const RawServerSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	command: z.union([z.string(), z.array(z.string())]),
	headers: z.record(z.string()).optional(),
	env: z.record(z.string()).optional(),
	auth: z.string().optional(),
	token_cache_dir: z.string().optional(),
	client_name: z.string().optional(),
});

const RawConfigSchema = z.array(RawServerSchema);

export type RawServerDefinition = z.infer<typeof RawServerSchema>;

export interface HttpCommand {
	readonly kind: "http";
	readonly url: URL;
	readonly headers?: Record<string, string>;
}

export interface StdioCommand {
	readonly kind: "stdio";
	readonly command: string;
	readonly args: string[];
	readonly cwd: string;
}

export type CommandSpec = HttpCommand | StdioCommand;

export interface ServerDefinition {
	readonly name: string;
	readonly description?: string;
	readonly command: CommandSpec;
	readonly env?: Record<string, string>;
	readonly auth?: string;
	readonly tokenCacheDir?: string;
	readonly clientName?: string;
}

export interface LoadConfigOptions {
	readonly configPath?: string;
	readonly rootDir?: string;
	readonly sourcesConfigPath?: string;
	readonly sources?: ConfigSourceDefinition[];
	readonly strategy?: MergeStrategy;
}

export async function loadServerDefinitions(
	options: LoadConfigOptions = {},
): Promise<ServerDefinition[]> {
	const rootDir = options.rootDir ?? process.cwd();
	const { sources, strategy } = await resolveConfigSources(options, rootDir);
	const merged = new Map<
		string,
		{ entry: RawServerDefinition; baseDir: string }
	>();

	for (const source of sources) {
		const entries = await loadFromSource(source, rootDir);
		for (const candidate of entries) {
			const existing = merged.get(candidate.entry.name);
			if (!existing) {
				merged.set(candidate.entry.name, candidate);
				continue;
			}
			if (strategy === "last-wins") {
				merged.set(candidate.entry.name, candidate);
			}
		}
	}

	return [...merged.values()].map(({ entry, baseDir }) =>
		normalizeServer(entry, baseDir),
	);
}

function normalizeServer(
	entry: RawServerDefinition,
	baseDir: string,
): ServerDefinition {
	const command = normalizeCommand(entry.command, baseDir);
	const headers = entry.headers ? { ...entry.headers } : undefined;

	const commandSpec =
		command.kind === "http"
			? {
					...command,
					headers: mergeHeaders(command.headers, headers),
				}
			: command;

	const tokenCacheDir =
		entry.auth === "oauth"
			? path.join(os.homedir(), ".mcp-runtime", entry.name)
			: entry.token_cache_dir
				? expandHome(entry.token_cache_dir)
				: undefined;

	return {
		name: entry.name,
		description: entry.description,
		command: commandSpec,
		env: entry.env,
		auth: entry.auth,
		tokenCacheDir,
		clientName: entry.client_name,
	};
}

function mergeHeaders(
	base?: Record<string, string>,
	overrides?: Record<string, string>,
): Record<string, string> | undefined {
	if (!base && !overrides) {
		return undefined;
	}
	if (!base) {
		return overrides ? { ...overrides } : undefined;
	}
	if (!overrides) {
		return { ...base };
	}
	return { ...base, ...overrides };
}

function normalizeCommand(
	command: string | string[],
	baseDir: string,
): CommandSpec {
	if (typeof command === "string") {
		if (command.startsWith("http://") || command.startsWith("https://")) {
			return { kind: "http", url: new URL(command) };
		}
		throw new Error(
			`String commands must be HTTP(S) endpoints. Received '${command}'. Use an array for stdio commands.`,
		);
	}

	if (command.length === 0) {
		throw new Error("Stdio command must include at least one entry.");
	}

	const [first, ...rest] = command;
	if (!first) {
		throw new Error("Stdio command must include at least one entry.");
	}
	const exe = first;

	const resolvedArgs = rest.map((arg) => {
		if (arg.startsWith("~")) {
			return expandHome(arg);
		}
		return arg;
	});

	return {
		kind: "stdio",
		command: exe,
		args: resolvedArgs,
		cwd: baseDir,
	};
}

export function toFileUrl(filePath: string): URL {
	return pathToFileURL(filePath);
}

export type MergeStrategy = "first-wins" | "last-wins";

export type ConfigSourceKind =
	| "local-json"
	| "project-mcp-json"
	| "cursor-project"
	| "cursor-user"
	| "claude-project"
	| "claude-user"
	| "claude-desktop"
	| "codex";

export interface ConfigSourceDefinition {
	readonly kind: ConfigSourceKind;
	readonly path?: string;
	readonly optional?: boolean;
}

const ConfigSourceKindSchema = z.enum([
	"local-json",
	"project-mcp-json",
	"cursor-project",
	"cursor-user",
	"claude-project",
	"claude-user",
	"claude-desktop",
	"codex",
]);

const ConfigSourceSchema = z.object({
	kind: ConfigSourceKindSchema,
	path: z.string().optional(),
	optional: z.boolean().optional(),
});

const ConfigSourceListFileSchema = z.object({
	strategy: z.enum(["first-wins", "last-wins"]).optional(),
	sources: z.array(ConfigSourceSchema),
});

interface ResolvedConfigSource {
	readonly kind: ConfigSourceKind;
	readonly path: string;
	readonly optional: boolean;
}

const DEFAULT_STRATEGY: MergeStrategy = "first-wins";

function defaultConfigSources(): ConfigSourceDefinition[] {
	return [
		{ kind: "local-json" },
		{ kind: "project-mcp-json", optional: true },
		{ kind: "cursor-project", optional: true },
		{ kind: "claude-project", optional: true },
		{ kind: "claude-desktop", optional: true },
		{ kind: "cursor-user", optional: true },
		{ kind: "claude-user", optional: true },
		{ kind: "codex", optional: true },
	];
}

async function resolveConfigSources(
	options: LoadConfigOptions,
	rootDir: string,
): Promise<{
	sources: ResolvedConfigSource[];
	strategy: MergeStrategy;
}> {
	if (options.sources && options.sources.length > 0) {
		const resolved = options.sources.map((source) =>
			resolveSource(source, options, rootDir),
		);
		return {
			sources: resolved,
			strategy: options.strategy ?? DEFAULT_STRATEGY,
		};
	}

	const sourcesPath =
		options.sourcesConfigPath ??
		path.resolve(rootDir, "config", "mcp_sources.json");
	const sourcesFromFile = await loadSourcesFile(sourcesPath);

	const definitions = sourcesFromFile?.sources ?? defaultConfigSources();
	const mergedStrategy =
		options.strategy ?? sourcesFromFile?.strategy ?? DEFAULT_STRATEGY;

	const resolvedSources = definitions.map((definition) =>
		resolveSource(definition, options, rootDir),
	);

	return { sources: resolvedSources, strategy: mergedStrategy };
}

async function loadSourcesFile(
	sourcesPath: string,
): Promise<z.infer<typeof ConfigSourceListFileSchema> | null> {
	try {
		const buffer = await fs.readFile(sourcesPath, "utf8");
		return ConfigSourceListFileSchema.parse(JSON.parse(buffer));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function resolveSource(
	source: ConfigSourceDefinition,
	options: LoadConfigOptions,
	rootDir: string,
): ResolvedConfigSource {
	const resolvedPath =
		source.path ?? defaultPathForKind(source.kind, options, rootDir);
	return {
		kind: source.kind,
		path: resolvedPath,
		optional: source.optional ?? source.kind !== "local-json",
	};
}

function defaultPathForKind(
	kind: ConfigSourceKind,
	options: LoadConfigOptions,
	rootDir: string,
): string {
	switch (kind) {
		case "local-json": {
			if (options.configPath) {
				return path.resolve(options.configPath);
			}
			return path.resolve(rootDir, "config", "mcp_servers.json");
		}
		case "project-mcp-json":
			return path.resolve(rootDir, ".mcp.json");
		case "cursor-project":
			return path.resolve(rootDir, ".cursor", "mcp.json");
		case "claude-project":
			return path.resolve(rootDir, ".claude", "mcp.json");
		case "cursor-user":
			return defaultCursorConfigPath();
		case "claude-user":
			return defaultClaudeUserConfigPath();
		case "claude-desktop":
			return defaultClaudeDesktopConfigPath();
		case "codex":
			return path.join(os.homedir(), ".codex", "config.toml");
		default:
			return path.resolve(rootDir, "config", "mcp_servers.json");
	}
}

function defaultCursorConfigPath(): string {
	if (process.platform === "darwin") {
		return path.join(os.homedir(), ".cursor", "mcp.json");
	}
	if (process.platform === "win32") {
		const appData =
			process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
		return path.join(appData, "Cursor", "mcp.json");
	}
	return path.join(os.homedir(), ".config", "Cursor", "mcp.json");
}

function defaultClaudeDesktopConfigPath(): string {
	if (process.platform === "darwin") {
		return path.join(
			os.homedir(),
			"Library",
			"Application Support",
			"Claude",
			"claude_desktop_config.json",
		);
	}
	if (process.platform === "win32") {
		const appData =
			process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
		return path.join(appData, "Claude", "claude_desktop_config.json");
	}
	return path.join(
		os.homedir(),
		".config",
		"Claude",
		"claude_desktop_config.json",
	);
}

function defaultClaudeUserConfigPath(): string {
	const nested = path.join(os.homedir(), ".claude", "mcp.json");
	if (fsSync.existsSync(nested)) {
		return nested;
	}
	return path.join(os.homedir(), ".claude.json");
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function loadFromSource(
	source: ResolvedConfigSource,
	rootDir: string,
): Promise<Array<{ entry: RawServerDefinition; baseDir: string }>> {
	const resolved = expandHome(
		path.isAbsolute(source.path)
			? source.path
			: path.resolve(rootDir, source.path),
	);

	if (!(await fileExists(resolved))) {
		if (source.optional) {
			return [];
		}
		throw new Error(
			`MCP config source '${source.kind}' not found at '${resolved}'.`,
		);
	}

	const baseDir = path.dirname(resolved);

	switch (source.kind) {
		case "local-json": {
			const buffer = await fs.readFile(resolved, "utf8");
			const parsed = RawConfigSchema.parse(JSON.parse(buffer));
			return parsed.map((entry) => ({
				entry,
				baseDir,
			}));
		}
		case "project-mcp-json":
		case "cursor-project":
		case "cursor-user":
		case "claude-project":
		case "claude-user":
		case "claude-desktop": {
			const buffer = await fs.readFile(resolved, "utf8");
			const parsed = JSON.parse(buffer) as unknown;
			const entries = extractFromMcpServers(parsed, baseDir);
			return entries;
		}
		case "codex": {
			const buffer = await fs.readFile(resolved, "utf8");
			const parsed = parseToml(buffer) as Record<string, unknown>;
			const entries = extractFromCodexConfig(parsed, baseDir);
			return entries;
		}
		default:
			return [];
	}
}

function extractFromMcpServers(
	raw: unknown,
	baseDir: string,
): Array<{ entry: RawServerDefinition; baseDir: string }> {
	if (!raw || typeof raw !== "object") {
		return [];
	}

	const candidates: Record<string, unknown> =
		"mcpServers" in raw && raw.mcpServers && typeof raw.mcpServers === "object"
			? (raw.mcpServers as Record<string, unknown>)
			: (raw as Record<string, unknown>);

	const entries: Array<{ entry: RawServerDefinition; baseDir: string }> = [];

	for (const [name, value] of Object.entries(candidates)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const converted = convertMcpEntry(name, value as Record<string, unknown>);
		if (!converted) {
			continue;
		}
		entries.push({ entry: converted, baseDir });
	}

	return entries;
}

function convertMcpEntry(
	name: string,
	value: Record<string, unknown>,
): RawServerDefinition | null {
	const description = asString(value.description);
	const env = asStringRecord(value.env);
	const headers = buildHeaders(value);

	const commandOrUrl = resolveCommandOrUrl(value);
	if (!commandOrUrl) {
		return null;
	}

	const auth = normalizeAuth(value.auth);
	const tokenCacheDir = asString(value.tokenCacheDir ?? value.token_cache_dir);
	const clientName = asString(value.clientName ?? value.client_name);

	const raw = {
		name,
		description: description ?? undefined,
		command: commandOrUrl,
		headers: headers ?? undefined,
		env: env ?? undefined,
		auth: auth ?? undefined,
		token_cache_dir: tokenCacheDir ?? undefined,
		client_name: clientName ?? undefined,
	};

	return RawServerSchema.parse(raw);
}

function resolveCommandOrUrl(
	value: Record<string, unknown>,
): string | string[] | null {
	const url =
		asString(value.url) ??
		asString(value.serverUrl) ??
		asString(value.server_url) ??
		asString(value.baseUrl) ??
		asString(value.base_url);
	if (url) {
		return url;
	}

	const commandValue = value.command;
	if (
		Array.isArray(commandValue) &&
		commandValue.every((item) => typeof item === "string")
	) {
		return commandValue as string[];
	}

	if (typeof commandValue === "string") {
		const args = Array.isArray(value.args)
			? value.args.map((item) => String(item))
			: [];
		return [commandValue, ...args];
	}

	if (Array.isArray(value.args) && typeof value.executable === "string") {
		return [
			value.executable as string,
			...value.args.map((item) => String(item)),
		];
	}

	return null;
}

function buildHeaders(
	value: Record<string, unknown>,
): Record<string, string> | null {
	const headers: Record<string, string> = {};
	const candidateHeaders = asStringRecord(value.headers);
	if (candidateHeaders) {
		Object.assign(headers, candidateHeaders);
	}

	const bearerToken = asString(
		value.bearerToken ??
			value.bearer_token ??
			(value.credentials && typeof value.credentials === "object"
				? (value.credentials as Record<string, unknown>).bearerToken
				: undefined),
	);
	if (bearerToken) {
		headers.Authorization = `Bearer ${bearerToken}`;
	}
	const bearerTokenEnv = asString(
		value.bearerTokenEnv ?? value.bearer_token_env,
	);
	if (bearerTokenEnv) {
		headers.Authorization = `$env:${bearerTokenEnv}`;
	}

	return Object.keys(headers).length > 0 ? headers : null;
}

function normalizeAuth(auth: unknown): string | undefined {
	if (typeof auth !== "string") {
		return undefined;
	}
	if (auth.toLowerCase() === "oauth") {
		return "oauth";
	}
	return undefined;
}

function extractFromCodexConfig(
	raw: Record<string, unknown>,
	baseDir: string,
): Array<{ entry: RawServerDefinition; baseDir: string }> {
	const serversRaw = raw.mcp_servers;
	if (!serversRaw || typeof serversRaw !== "object") {
		return [];
	}
	const entries: Array<{ entry: RawServerDefinition; baseDir: string }> = [];

	for (const [name, value] of Object.entries(
		serversRaw as Record<string, unknown>,
	)) {
		if (!value || typeof value !== "object") {
			continue;
		}

		const record = value as Record<string, unknown>;
		const env = asStringRecord(record.env);
		const headers = buildCodexHeaders(record);
		const description = asString(record.description);
		const auth = normalizeAuth(record.auth);
		const tokenCacheDir = asString(
			record.token_cache_dir ?? record.tokenCacheDir,
		);

		const commandOrUrl = resolveCommandOrUrl(record);
		if (!commandOrUrl) {
			continue;
		}

		const rawEntry = {
			name,
			description: description ?? undefined,
			command: commandOrUrl,
			headers: headers ?? undefined,
			env: env ?? undefined,
			auth: auth ?? undefined,
			token_cache_dir: tokenCacheDir ?? undefined,
		};

		entries.push({
			entry: RawServerSchema.parse(rawEntry),
			baseDir,
		});
	}

	return entries;
}

function buildCodexHeaders(
	record: Record<string, unknown>,
): Record<string, string> | null {
	const headers: Record<string, string> = {};
	const bearerTokenEnv = asString(
		record.bearer_token_env ?? record.bearerTokenEnv,
	);
	const bearerToken = asString(record.bearer_token ?? record.bearerToken);
	if (bearerTokenEnv) {
		headers.Authorization = `$env:${bearerTokenEnv}`;
	} else if (bearerToken) {
		headers.Authorization = `Bearer ${bearerToken}`;
	}

	const customHeaders = asStringRecord(record.headers);
	if (customHeaders) {
		Object.assign(headers, customHeaders);
	}

	return Object.keys(headers).length > 0 ? headers : null;
}

function asString(value: unknown): string | undefined {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}
	return undefined;
}

function asStringRecord(input: unknown): Record<string, string> | undefined {
	if (!input || typeof input !== "object") {
		return undefined;
	}
	const record: Record<string, string> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (value === undefined || value === null) {
			continue;
		}
		if (typeof value === "string") {
			record[key] = value;
		} else if (typeof value === "number" || typeof value === "boolean") {
			record[key] = String(value);
		}
	}
	return Object.keys(record).length > 0 ? record : undefined;
}
