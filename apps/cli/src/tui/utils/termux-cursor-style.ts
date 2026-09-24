import type { CursorStyleOptions } from "@opentui/core";
import { type Env, isTermuxRuntime } from "./termux-runtime";

export type TermuxCursorStyle = "block" | "line" | "underline" | "default";

const TERMUX_CURSOR_ENV = "CLINE_TUI_TERMUX_CURSOR";
const TERMUX_CURSOR_BLINK_ENV = "CLINE_TUI_TERMUX_CURSOR_BLINK";
const DEFAULT_TERMUX_CURSOR_STYLE: TermuxCursorStyle = "line";
const DEFAULT_TERMUX_CURSOR_BLINK = true;

const CURSOR_STYLE_VALUES: Record<string, TermuxCursorStyle> = {
	block: "block",
	bar: "line",
	line: "line",
	ibeam: "line",
	underline: "underline",
	ul: "underline",
	default: "default",
	auto: "default",
};

const BLINK_ON_VALUES = new Set(["1", "true", "yes", "on", "blink", "blinking"]);
const BLINK_OFF_VALUES = new Set(["0", "false", "no", "off", "steady", "static"]);

function parseTermuxCursorStyle(value: string | undefined): TermuxCursorStyle | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	return CURSOR_STYLE_VALUES[normalized];
}

function parseTermuxCursorBlink(value: string | undefined): boolean | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized || normalized === "auto") return undefined;
	if (BLINK_ON_VALUES.has(normalized)) return true;
	if (BLINK_OFF_VALUES.has(normalized)) return false;
	return undefined;
}

export function getTermuxCursorStyle(env: Env = process.env): CursorStyleOptions | undefined {
	if (!isTermuxRuntime(env)) return undefined;
	const style = parseTermuxCursorStyle(env[TERMUX_CURSOR_ENV]) ?? DEFAULT_TERMUX_CURSOR_STYLE;
	const blinking = parseTermuxCursorBlink(env[TERMUX_CURSOR_BLINK_ENV]) ?? DEFAULT_TERMUX_CURSOR_BLINK;
	return { style, blinking };
}

export const __test__ = {
	parseTermuxCursorStyle,
	parseTermuxCursorBlink,
	TERMUX_CURSOR_ENV,
	TERMUX_CURSOR_BLINK_ENV,
};
