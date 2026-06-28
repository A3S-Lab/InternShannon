const createSvgElementFromPath = (params: {
	height: string;
	width: string;
	viewbox: string;
	path: string;
}): SVGSVGElement => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttributeNS(null, "height", params.height);
	svg.setAttributeNS(null, "width", params.width);
	svg.setAttributeNS(null, "viewBox", params.viewbox);
	svg.setAttributeNS(null, "aria-hidden", "false");
	svg.setAttributeNS(null, "focusable", "false");
	svg.classList.add("dv-svg");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttributeNS(null, "d", params.path);
	svg.appendChild(path);
	return svg;
};

export const createCloseButton = (): SVGSVGElement =>
	createSvgElementFromPath({
		width: "11",
		height: "11",
		viewbox: "0 0 28 28",
		path: "M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z",
	});

export const createExpandMoreButton = (): SVGSVGElement =>
	createSvgElementFromPath({
		width: "11",
		height: "11",
		viewbox: "0 0 24 15",
		path: "M12 14.15L0 2.15L2.15 0L12 9.9L21.85 0.0499992L24 2.2L12 14.15Z",
	});

export const createChevronRightButton = (): SVGSVGElement =>
	createSvgElementFromPath({
		width: "11",
		height: "11",
		viewbox: "0 0 15 25",
		path: "M2.15 24.1L0 21.95L9.9 12.05L0 2.15L2.15 0L14.2 12.05L2.15 24.1Z",
	});

// File type icon paths (16x16 viewbox)
const FILE_ICONS: Record<string, string> = {
	// JavaScript
	js: "M5.02 15.5c-.1 0-.2 0-.3-.1l-1.5-1.5c-.2-.2-.2-.4 0-.6s.4-.2.6 0l1.2 1.2 1.2-1.2c.2-.2.4-.2.6 0s.2.4 0 .6l-1.5 1.5c-.1.1-.2.1-.3.1zm6-6.5c-.1 0-.2 0-.3-.1l-1.5-1.5c-.2-.2-.2-.4 0-.6s.4-.2.6 0l1.2 1.2 1.2-1.2c.2-.2.4-.2.6 0s.2.4 0 .6l-1.5 1.5c-.1.1-.2.1-.3.1zm-3-3c-.1 0-.2 0-.3-.1l-1.5-1.5c-.2-.2-.2-.4 0-.6s.4-.2.6 0l1.2 1.2 1.2-1.2c.2-.2.4-.2.6 0s.2.4 0 .6l-1.5 1.5c-.1.1-.2.1-.3.1z",
	// TypeScript
	ts: "M3 5h2v1.5c0 .28.22.5.5.5h3c.28 0 .5-.22.5-.5V5h2v5.5c0 .28.22.5.5.5h1.5v.5c0 .83-.67 1.5-1.5 1.5h-7c-.83 0-1.5-.67-1.5-1.5v-7c0-.83.67-1.5 1.5-1.5h7c.83 0 1.5.67 1.5 1.5v.5H10c-.28 0-.5.22-.5.5s.22.5.5.5h4c.28 0 .5-.22.5-.5V5h-1c-.28 0-.5.22-.5.5v5.5c0 .28.22.5.5.5h1.5v1H5c-.28 0-.5-.22-.5-.5V5c0-.28.22-.5.5-.5zm1.5 3h3v1h-3V8z",
	// JSON
	json: "M4 4h2v2H4V4zm3 0h2v2H7V4zm3 0h2v2h-2V4zM4 7h2v2H4V7zm3 0h2v2H7V7zm3 0h2v2h-2V7zM4 10h2v2H4v-2zm3 0h2v2H7v-2zm3 0h2v2h-2v-2z",
	// Markdown
	md: "M3 5h2v1.5c0 .28.22.5.5.5h3c.28 0 .5-.22.5-.5V5h2v5.5c0 .28.22.5.5.5h1.5v.5c0 .83-.67 1.5-1.5 1.5h-7c-.83 0-1.5-.67-1.5-1.5v-7c0-.83.67-1.5 1.5-1.5h7c.83 0 1.5.67 1.5 1.5v.5H10c-.28 0-.5.22-.5.5s.22.5.5.5h4c.28 0 .5-.22.5-.5V5h-1c-.28 0-.5.22-.5.5v5.5c0 .28.22.5.5.5h1.5v1H5c-.28 0-.5-.22-.5-.5V5c0-.28.22-.5.5-.5zm1.5 3h3v1h-3V8zm-1 5h5v1h-5v-1z",
	// Python
	py: "M8 3c1.93 0 3.5 1.57 3.5 3.5S9.93 10 8 10H6v2.5c0 .83-.67 1.5-1.5 1.5S3 13.33 3 12.5V5.5C3 4.67 3.67 4 4.5 4h5c.83 0 1.5.67 1.5 1.5V6H8c-1.1 0-2-.9-2-2s.9-2 2-2h3V3H8zm0 2h3c.55 0 1 .45 1 1s-.45 1-1 1H8V5zm-3 7h3c1.1 0 2 .9 2 2s-.9 2-2 2H6v-1.5c0-.83-.67-1.5-1.5-1.5S3 11.67 3 12.5v3C3 16.33 3.67 17 4.5 17h5c.83 0 1.5-.67 1.5-1.5V13h-1c-.55 0-1-.45-1-1s.45-1 1-1h3v-1H5z",
	// HTML
	html: "M4 3h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zm1 2v10h10V5H5zm2 2h2v1H7V7zm0 2h2v1H7V9zm0 2h2v1H7v-1zm3-4h2v1h-2V7zm0 2h2v1h-2V9zm0 2h2v1h-2v-1zm3-4h2v1h-2V7z",
	// CSS
	css: "M4 3h12c.55 0 1 .45 1 1v12c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zm1 2v10h10V5H5zm2 2h2v1H7V7zm0 2h2v1H7V9zm0 2h2v1H7v-1zm3-4h2v1h-2V7zm0 2h2v1h-2V9zm0 2h2v1h-2v-1z",
	// Generic file
	default:
		"M6 2c-.55 0-1 .45-1 1v5H4.5c-.28 0-.5.22-.5.5v7c0 .28.22.5.5.5h7c.28 0 .5-.22.5-.5v-7c0-.28-.22-.5-.5-.5H13V6h4.5c.28 0 .5-.22.5-.5v-3c0-.55-.45-1-1-1H6z",
};

export const createFileIcon = (
	ext: string,
	size: number = 14,
): SVGSVGElement => {
	const path = FILE_ICONS[ext.toLowerCase()] || FILE_ICONS.default;
	return createSvgElementFromPath({
		width: String(size),
		height: String(size),
		viewbox: "0 0 16 16",
		path,
	});
};

export const createDirtyDot = (): SVGSVGElement => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttributeNS(null, "height", "8");
	svg.setAttributeNS(null, "width", "8");
	svg.setAttributeNS(null, "viewBox", "0 0 8 8");
	svg.classList.add("dv-dirty-dot");
	const circle = document.createElementNS(
		"http://www.w3.org/2000/svg",
		"circle",
	);
	circle.setAttributeNS(null, "cx", "4");
	circle.setAttributeNS(null, "cy", "4");
	circle.setAttributeNS(null, "r", "3");
	circle.setAttributeNS(null, "fill", "currentColor");
	svg.appendChild(circle);
	return svg;
};
