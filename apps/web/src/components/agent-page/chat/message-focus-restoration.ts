export interface MessageFocusGeometry {
	scrollerTop: number;
	scrollerBottom: number;
	scrollerWidth: number;
	scrollerHeight: number;
	targetTop: number;
	targetBottom: number;
	targetWidth: number;
	targetHeight: number;
}

export function isMessageFocusRestorePending(input: {
	focusMessageId?: string;
	focusMessageRequest?: number;
}): boolean {
	return Boolean(input.focusMessageId) && (input.focusMessageRequest ?? 0) > 0;
}

/** A hidden or not-yet-laid-out chat must never be accepted as restored. */
export function hasMeasurableMessageFocusGeometry(
	geometry: MessageFocusGeometry,
): boolean {
	return (
		geometry.scrollerWidth > 0 &&
		geometry.scrollerHeight > 0 &&
		geometry.targetWidth > 0 &&
		geometry.targetHeight > 0 &&
		geometry.scrollerBottom > geometry.scrollerTop &&
		geometry.targetBottom > geometry.targetTop
	);
}

export function isMessageFocusTargetVisible(
	geometry: MessageFocusGeometry,
): boolean {
	return (
		hasMeasurableMessageFocusGeometry(geometry) &&
		geometry.targetBottom > geometry.scrollerTop &&
		geometry.targetTop < geometry.scrollerBottom
	);
}
