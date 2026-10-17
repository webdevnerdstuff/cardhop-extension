// Pure placement math, so it can be tested without layout (jsdom reports every rect as zeros).
// All units are CSS px in viewport coordinates.
export interface Box { top: number; left: number; width: number; height: number }
export interface Size { width: number; height: number }

export const GAP = 6;
export const MARGIN = 8;
export const ICON_SIZE = 20;

// The prompt's fixed width, set in prompt.ts's styles. Used instead of measuring, since layout may not be ready.
export const PROMPT_WIDTH = 260;

// The top-right corner, just under the browser toolbar where the CardHop icon usually sits, like Eno's
// panel. A page can't see the toolbar, so this is as close as it can get. Placing it by the field instead
// went wrong on checkouts whose card form is one large frame: with no room beside it, the prompt ended up
// in the top-left corner.
export function placePromptCorner(viewport: Size): { top: number; left: number } {
	// A viewport narrower than the prompt can't satisfy both edges; keep the left edge visible.
	return { top: MARGIN, left: Math.max(MARGIN, viewport.width - PROMPT_WIDTH - MARGIN) };
}

// Vertically centred, with the right edge GAP inside the anchor's right edge.
export function placeIcon(anchor: Box): { top: number; left: number } {
	return {
		top: anchor.top + (anchor.height - ICON_SIZE) / 2,
		left: anchor.left + anchor.width - GAP - ICON_SIZE,
	};
}

// False only when the anchor is fully outside the viewport.
export function isInView(anchor: Box, viewport: Size): boolean {
	return !(
		anchor.top + anchor.height < 0
		|| anchor.left + anchor.width < 0
		|| anchor.top > viewport.height
		|| anchor.left > viewport.width
	);
}
