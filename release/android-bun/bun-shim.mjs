#!/usr/bin/env node
/**
 * Bun CLI shim for Termux/Android.
 *
 * Upstream Bun cannot read the current working directory in the Android
 * sandbox (oven-sh/bun#30859), so `bun run`, `bun -F <filter> <script>`,
 * `bun x` and `bun <bin>` all abort with CouldntReadCurrentDirectory before
 * they do any work. `bun install`, `bun test` and running a file directly
 * (`bun file.ts`) still work.
 *
 * The release manager has to run `bun run build:sdk`, `bun -F @cline/cli
 * typecheck` and friends, so this shim re-implements the broken subset on top
 * of the parts that work:
 *
 *   bun install ...              -> real bun with --backend=copyfile
 *                                   (Android denies the hardlink install)
 *   bun run <script> [args]      -> run the package.json script via bash
 *   bun -F <filter> <script>     -> resolve workspace packages, run script
 *   bun x <bin> / bun <bin>      -> exec node_modules/.bin/<bin>
 *   bun <file.ts> / other cmds   -> real bun, untouched
 *
 * Anything not listed is delegated to the real Bun binary, so the shim never
 * silently swallows an invocation it does not understand.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REAL_BUN = process.env.CLINE_TERMUX_REAL_BUN;

// Bun subcommands the real binary still handles on Android. Anything else is
// treated as a bin lookup (`bun tsc`) or a script file.
const REAL_SUBCOMMANDS = new Set([
	"add",
	"audit",
	"build",
	"completions",
	"create",
	"exec",
	"info",
	"init",
	"install",
	"link",
	"outdated",
	"patch",
	"patch-commit",
	"pm",
	"publish",
	"remove",
	"test",
	"unlink",
	"update",
	"upgrade",
	"why",
]);

const SCRIPT_EXTENSIONS = /\.(?:[cm]?[jt]sx?|json)$/;
const MAX_WALK_UP = 40;

function fail(message) {
	process.stderr.write(`bun-shim: ${message}\n`);
	process.exit(1);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

function realBun() {
	if (!REAL_BUN || !existsSync(REAL_BUN)) {
		fail(
			"CLINE_TERMUX_REAL_BUN must point at the real Bun binary for this device",
		);
	}
	return REAL_BUN;
}

function execRealBun(argv) {
	const result = spawnSync(realBun(), argv, { stdio: "inherit" });
	process.exit(result.status ?? 1);
}

function hasFlag(argv, name) {
	return argv.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function withCopyfileBackend(argv) {
	return hasFlag(argv, "--backend") ? argv : [...argv, "--backend=copyfile"];
}

/** Directories to search for executables, nearest first. */
function binSearchPath(startDir) {
	const dirs = [];
	let dir = startDir;
	for (let depth = 0; depth < MAX_WALK_UP; depth += 1) {
		dirs.push(join(dir, "node_modules", ".bin"));
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return dirs.filter((entry) => existsSync(entry));
}

/** The shim itself must win PATH lookups so nested `bun run` calls work. */
function shimBinDir() {
	return process.env.CLINE_TERMUX_SHIM_BIN_DIR ?? "";
}

function scriptEnvironment(cwd, scriptName) {
	const path = [
		...binSearchPath(cwd),
		shimBinDir(),
		process.env.PATH ?? "",
	]
		.filter(Boolean)
		.join(":");
	const pkg = readJson(join(cwd, "package.json")) ?? {};
	return {
		...process.env,
		PATH: path,
		npm_lifecycle_event: scriptName,
		npm_package_name: pkg.name ?? "",
		npm_package_version: pkg.version ?? "",
	};
}

/**
 * Run one package.json script. Extra arguments are appended the way Bun does
 * it, by exposing them to the shell as "$@".
 */
function runPackageScript(scriptName, args, cwd = process.cwd()) {
	const pkg = readJson(join(cwd, "package.json"));
	const script = pkg?.scripts?.[scriptName];
	if (!script) {
		fail(`no script named "${scriptName}" in ${join(cwd, "package.json")}`);
	}
	const result = spawnSync("bash", ["-c", script, scriptName, ...args], {
		cwd,
		stdio: "inherit",
		env: scriptEnvironment(cwd, scriptName),
	});
	if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

/** Expand the simple `*` globs used by the root package.json workspaces. */
function expandWorkspacePattern(root, pattern) {
	const segments = pattern.split("/").filter((segment) => segment !== ".");
	let current = [root];
	for (const segment of segments) {
		const next = [];
		for (const base of current) {
			if (segment === "*") {
				if (!existsSync(base)) continue;
				for (const entry of readdirSync(base)) {
					const candidate = join(base, entry);
					if (statSync(candidate).isDirectory()) next.push(candidate);
				}
			} else {
				const candidate = join(base, segment);
				if (existsSync(candidate) && statSync(candidate).isDirectory()) {
					next.push(candidate);
				}
			}
		}
		current = next;
	}
	return current;
}

function findWorkspaceRoot(startDir) {
	let dir = startDir;
	for (let depth = 0; depth < MAX_WALK_UP; depth += 1) {
		const pkg = readJson(join(dir, "package.json"));
		if (pkg?.workspaces) return { dir, pkg };
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function workspacePackages(root) {
	const workspaces = Array.isArray(root.pkg.workspaces)
		? root.pkg.workspaces
		: (root.pkg.workspaces?.packages ?? []);
	const packages = [];
	for (const pattern of workspaces) {
		for (const dir of expandWorkspacePattern(root.dir, pattern)) {
			const pkg = readJson(join(dir, "package.json"));
			if (pkg) packages.push({ dir, pkg });
		}
	}
	return packages;
}

/** Resolve `-F` filters the way Bun documents them: name, path or glob. */
function filterPackages(root, filter) {
	const normalized = filter.replace(/^\.\//, "");
	if (normalized.includes("*") || filter.startsWith("./")) {
		const matched = expandWorkspacePattern(root.dir, normalized);
		return workspacePackages(root).filter((entry) =>
			matched.includes(entry.dir),
		);
	}
	return workspacePackages(root).filter(({ dir, pkg }) => {
		const relative = dir.slice(root.dir.length + 1);
		return (
			pkg.name === normalized ||
			relative === normalized ||
			pkg.name.endsWith(`/${normalized}`) ||
			relative.endsWith(`/${normalized}`)
		);
	});
}

function runFiltered(filters, scriptName, args) {
	const root = findWorkspaceRoot(process.cwd());
	if (!root) fail("no workspace root found for a --filter invocation");
	const seen = new Set();
	for (const filter of filters) {
		const matches = filterPackages(root, filter);
		if (matches.length === 0) fail(`no workspace package matched "${filter}"`);
		for (const entry of matches) {
			if (seen.has(entry.dir)) continue;
			seen.add(entry.dir);
			process.chdir(entry.dir);
			runPackageScript(scriptName, args);
			process.chdir(root.dir);
		}
	}
}

function resolveBin(name) {
	for (const dir of binSearchPath(process.cwd())) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** `bun x foo` and `bun foo` both mean "run foo from node_modules/.bin". */
function runBin(name, args) {
	const bin = resolveBin(name);
	if (!bin) execRealBun([name, ...args]);
	const result = spawnSync(bin, args, {
		stdio: "inherit",
		env: scriptEnvironment(process.cwd(), name),
	});
	process.exit(result.status ?? 1);
}

function main() {
	const argv = process.argv.slice(2);
	const filters = [];
	// Positional tokens keep their argv index so the arguments that follow the
	// script or bin name can be forwarded untouched, flags included.
	const positional = [];

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "-F" || arg === "--filter") {
			if (argv[index + 1] === undefined) fail(`${arg} requires a value`);
			filters.push(argv[index + 1]);
			index += 1;
			continue;
		}
		if (arg.startsWith("--filter=")) {
			filters.push(arg.slice("--filter=".length));
			continue;
		}
		if (arg === "--cwd" && argv[index + 1] !== undefined) {
			process.chdir(resolve(argv[index + 1]));
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) continue;
		positional.push({ value: arg, index });
	}

	const [head, target] = positional;
	const rest = (entry) => (entry ? argv.slice(entry.index + 1) : []);

	if (head === undefined) execRealBun(argv);
	if (head.value === "install") execRealBun(withCopyfileBackend(argv));

	if (filters.length > 0) {
		if (head.value === "run") {
			if (target === undefined) execRealBun(argv);
			runFiltered(filters, target.value, rest(target));
		} else {
			runFiltered(filters, head.value, rest(head));
		}
		return;
	}

	if (head.value === "run") {
		if (target === undefined) execRealBun(argv);
		const asPath = resolve(target.value);
		if (existsSync(asPath) && statSync(asPath).isFile()) {
			execRealBun([target.value, ...rest(target)]);
		}
		runPackageScript(target.value, rest(target));
		return;
	}

	if (head.value === "x") {
		if (target === undefined) execRealBun(argv);
		runBin(target.value, rest(target));
	}

	const asFile = resolve(head.value);
	if (existsSync(asFile) && statSync(asFile).isFile()) execRealBun(argv);
	if (REAL_SUBCOMMANDS.has(head.value)) execRealBun(argv);

	// A bare word that is neither a real subcommand nor an existing file: Bun
	// would resolve it from node_modules/.bin.
	runBin(head.value, rest(head));
}

main();

