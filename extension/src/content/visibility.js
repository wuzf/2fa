import { treeParent } from './dom.js';

const CLIPPING_OVERFLOW = new Set(['hidden', 'clip', 'scroll', 'auto']);

function positioningContainer(element, style) {
	if (style?.display === 'contents') {
		return undefined;
	}
	if (style?.position === 'absolute') {
		return element.offsetParent;
	}
	if (style?.position !== 'fixed') {
		return undefined;
	}
	for (let parent = treeParent(element); parent?.ownerDocument === element.ownerDocument; parent = treeParent(parent)) {
		const css = parent.ownerDocument.defaultView.getComputedStyle(parent);
		if (
			[css.transform, css.perspective, css.filter, css.backdropFilter].some((value) => value && value !== 'none') ||
			/\b(layout|paint|strict|content)\b/.test(css.contain) ||
			/\b(transform|perspective|filter)\b/.test(css.willChange) ||
			css.contentVisibility === 'auto'
		) {
			return parent;
		}
	}
	return null;
}

function intersect(rect, clip, clipX = true, clipY = true) {
	const result = {
		left: clipX ? Math.max(rect.left, clip.left) : rect.left,
		right: clipX ? Math.min(rect.right, clip.right) : rect.right,
		top: clipY ? Math.max(rect.top, clip.top) : rect.top,
		bottom: clipY ? Math.min(rect.bottom, clip.bottom) : rect.bottom,
	};
	return result.right > result.left && result.bottom > result.top ? result : null;
}

function clientBox(element) {
	const bounds = element.getBoundingClientRect();
	const scaleX = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
	const scaleY = element.offsetHeight > 0 ? bounds.height / element.offsetHeight : 1;
	const left = bounds.left + element.clientLeft * scaleX;
	const top = bounds.top + element.clientTop * scaleY;
	return {
		left,
		top,
		right: left + element.clientWidth * scaleX,
		bottom: top + element.clientHeight * scaleY,
		scaleX,
		scaleY,
	};
}

function cssClipRectangle(element, values, inset) {
	const bounds = element.getBoundingClientRect();
	const scaleX = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
	const scaleY = element.offsetHeight > 0 ? bounds.height / element.offsetHeight : 1;
	const lengths = values.map((value, index) => {
		const vertical = index % 2 === 0;
		const size = vertical ? bounds.height : bounds.width;
		if (!inset && value === 'auto') {
			return index === 1 || index === 2 ? size : 0;
		}
		const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|%)?$/.exec(value);
		if (!match || (!match[2] && Number(match[1]) !== 0)) {
			return NaN;
		}
		return Number(match[1]) * (match[2] === '%' ? size / 100 : vertical ? scaleY : scaleX);
	});
	if (lengths.length !== 4 || !lengths.every(Number.isFinite)) {
		return null;
	}
	const [top, right, bottom, left] = lengths;
	return {
		left: bounds.left + left,
		top: bounds.top + top,
		right: inset ? bounds.right - right : bounds.left + right,
		bottom: inset ? bounds.bottom - bottom : bounds.top + bottom,
	};
}

function applyCssClipping(areas, element, style) {
	const clipPath = style?.clipPath;
	const legacyClip = ['absolute', 'fixed'].includes(style?.position) ? style.clip : null;
	for (const [value, inset] of [
		[clipPath, true],
		[legacyClip, false],
	]) {
		if (!value || value === 'none' || value === 'auto') {
			continue;
		}
		const match = (inset ? /^inset\(([^()]+)\)(?:\s+border-box)?$/ : /^rect\(([^()]+)\)$/).exec(value);
		if (!match) {
			return [];
		}
		let values = match[1].trim().split(/[\s,]+/);
		if (inset && values.length >= 1 && values.length <= 4) {
			values = [values[0], values[1] ?? values[0], values[2] ?? values[0], values[3] ?? values[1] ?? values[0]];
		}
		const clip = cssClipRectangle(element, values, inset);
		if (!clip) {
			return [];
		}
		areas = areas.map((rect) => intersect(rect, clip)).filter(Boolean);
	}
	return areas;
}

// Rectangles inside a frame use that document's coordinates, even when the
// embedding frame is collapsed. Carry the surviving area through every frame
// viewport and clipping ancestor before declaring a field visible.
export function hasVisibleInputArea(input) {
	let areas = Array.from(input.getClientRects(), (rect) => ({
		left: rect.left ?? rect.x ?? 0,
		top: rect.top ?? rect.y ?? 0,
		right: rect.right ?? (rect.left ?? rect.x ?? 0) + rect.width,
		bottom: rect.bottom ?? (rect.top ?? rect.y ?? 0) + rect.height,
	})).filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
	let doc = input.ownerDocument;
	const inputStyle = doc.defaultView?.getComputedStyle(input);
	areas = applyCssClipping(areas, input, inputStyle);
	let clippingContainer = positioningContainer(input, inputStyle);
	for (let element = treeParent(input); areas.length && element?.nodeType === 1; element = treeParent(element)) {
		const style = element.ownerDocument.defaultView?.getComputedStyle(element);
		if (element.ownerDocument !== doc) {
			const box = clientBox(element);
			const padding = (side) => Number.parseFloat(style?.[side]) || 0;
			box.left += padding('paddingLeft') * box.scaleX;
			box.top += padding('paddingTop') * box.scaleY;
			const viewport = {
				left: 0,
				top: 0,
				right: element.clientWidth - padding('paddingLeft') - padding('paddingRight'),
				bottom: element.clientHeight - padding('paddingTop') - padding('paddingBottom'),
			};
			areas = areas
				.map((rect) => intersect(rect, viewport))
				.filter(Boolean)
				.map((rect) => ({
					left: box.left + rect.left * box.scaleX,
					right: box.left + rect.right * box.scaleX,
					top: box.top + rect.top * box.scaleY,
					bottom: box.top + rect.bottom * box.scaleY,
				}))
				.filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
			doc = element.ownerDocument;
			clippingContainer = undefined;
		}
		areas = applyCssClipping(areas, element, style);
		if (element === clippingContainer) {
			clippingContainer = undefined;
		}
		// Non-replaced inline elements and display:contents ancestors do not
		// establish an overflow clipping box, despite reporting client size zero.
		const clipsOverflow = style?.display !== 'inline' && style?.display !== 'contents';
		const clipX = clipsOverflow && CLIPPING_OVERFLOW.has(style?.overflowX);
		const clipY = clipsOverflow && CLIPPING_OVERFLOW.has(style?.overflowY);
		// Positioned descendants escape intermediate overflow containers until
		// their containing block, but can never escape an embedding frame viewport.
		if (clippingContainer === undefined && (clipX || clipY)) {
			const box = clientBox(element);
			areas = areas.map((rect) => intersect(rect, box, clipX, clipY)).filter(Boolean);
		}
		if (clippingContainer === undefined) {
			clippingContainer = positioningContainer(element, style);
		}
	}
	return areas.length > 0;
}
