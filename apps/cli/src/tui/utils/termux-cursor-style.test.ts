import { describe, expect, it } from "vitest";
import { __test__, getTermuxCursorStyle } from "./termux-cursor-style";

const { parseTermuxCursorStyle, parseTermuxCursorBlink } = __test__;

describe("getTermuxCursorStyle", () => {
	it("leaves non-Termux terminals unchanged", () => {
		expect(
			getTermuxCursorStyle({
				HOME: "/home/user",
				CLINE_TUI_TERMUX_CURSOR: "line",
			}),
		).toBeUndefined();
	});

	it("uses a thin blinking line by default inside Termux", () => {
		expect(getTermuxCursorStyle({ TERMUX_VERSION: "1" })).toEqual({
			style: "line",
			blinking: true,
		});
	});

	it("accepts bar/ibeam aliases for the thin line", () => {
		expect(parseTermuxCursorStyle("bar")).toBe("line");
		expect(parseTermuxCursorStyle("ibeam")).toBe("line");
		expect(parseTermuxCursorStyle("LINE")).toBe("line");
	});

	it("honours explicit style overrides", () => {
		expect(
			getTermuxCursorStyle({
				TERMUX_VERSION: "1",
				CLINE_TUI_TERMUX_CURSOR: "block",
			}),
		).toEqual({ style: "block", blinking: true });
		expect(
			getTermuxCursorStyle({
				TERMUX_VERSION: "1",
				CLINE_TUI_TERMUX_CURSOR: "underline",
			}),
		).toEqual({ style: "underline", blinking: true });
	});

	it("ignores unknown style values and falls back to the thin line", () => {
		expect(
			getTermuxCursorStyle({
				TERMUX_VERSION: "1",
				CLINE_TUI_TERMUX_CURSOR: "banana",
			}),
		).toEqual({ style: "line", blinking: true });
	});

	it("honours explicit blink overrides", () => {
		expect(parseTermuxCursorBlink("steady")).toBe(false);
		expect(parseTermuxCursorBlink("blink")).toBe(true);
		expect(
			getTermuxCursorStyle({
				TERMUX_VERSION: "1",
				CLINE_TUI_TERMUX_CURSOR_BLINK: "off",
			}),
		).toEqual({ style: "line", blinking: false });
	});
});
