/**
 * ==========================================================================
 * TERMUX CURSOR STYLE OVERRIDE
 * ==========================================================================
 *
 * PROBLEM:
 * The Cline TUI is built on @opentui/core, which defaults the input cursor
 * to a thick "block" style (ESC[1 q). In Termux, users typically configure
 * their terminal to use a thin vertical line (bar, ESC[5 q or ESC[6 q).
 * When Cline TUI starts, it overrides the user's terminal cursor with the
 * block style, and doesn't restore it on exit. This is jarring for Termux
 * users who expect a thin line cursor.
 *
 * SOLUTION:
 * This module provides a Termux-specific cursor style that replaces the
 * opentui default "block" with a thin "line" (bar) cursor. It is injected
 * into every <input> / <textarea> component across the TUI via the
 * `cursorStyle` prop.
 *
 * HOW IT WORKS:
 * - getTermuxCursorStyle() checks if we're running in Termux (via
 *   isTermuxRuntime which checks for TERMUX_VERSION env var)
 * - If NOT in Termux: returns undefined, letting opentui use its defaults
 * - If IN Termux: returns { style: "line", blinking: true } by default,
 *   which maps to ESC[5 q (thin blinking bar)
 *
 * USER OVERRIDES VIA ENVIRONMENT VARIABLES:
 *   CLINE_TUI_TERMUX_CURSOR=line|bar|ibeam|block|underline|default
 *     - "line", "bar", "ibeam" all map to thin vertical line (ESC[5/6 q)
 *     - "block" restores the thick rectangle (ESC[1/2 q)
 *     - "underline" gives horizontal underline (ESC[3/4 q)
 *     - "default" lets opentui decide
 *
 *   CLINE_TUI_TERMUX_CURSOR_BLINK=on|off|blink|steady|true|false|1|0
 *     - Controls whether the cursor blinks or stays static
 *     - "on"/"blink"/"true"/"1" = blinking (ESC[5 q for line)
 *     - "off"/"steady"/"false"/"0" = static (ESC[6 q for line)
 *
 * WHERE THIS IS USED:
 * Imported and called in every TUI component that renders an input:
 *   - apps/cli/src/tui/components/input-bar.tsx (main chat input)
 *   - apps/cli/src/tui/components/queued-prompts.tsx
 *   - apps/cli/src/tui/components/searchable-list.tsx
 *   - apps/cli/src/tui/components/dialogs/command-palette.tsx
 *   - apps/cli/src/tui/components/dialogs/provider-picker.tsx
 *   - apps/cli/src/tui/components/dialogs/ask-question.tsx
 *   - apps/cli/src/tui/components/model-selector/model-selector.tsx
 *   - apps/cli/src/tui/views/onboarding/screens.tsx
 *
 * Each component does: const termuxCursorStyle = getTermuxCursorStyle();
 * Then passes cursorStyle={termuxCursorStyle} to the <input> JSX element.
 *
 * TECHNICAL NOTE:
 * The opentui CursorStyleOptions type accepts style as "block"|"line"|
 * "underline"|"default". We map user-friendly aliases (bar, ibeam) to
 * "line" since they all produce the same DECSCUSR escape sequence.
 * ==========================================================================
 */
import type { CursorStyleOptions } from "@opentui/core";
import { type Env, isTermuxRuntime } from "./termux-runtime";

/** Valid cursor shapes after normalization. Maps to DECSCUSR values. */
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
