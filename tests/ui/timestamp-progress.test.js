import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createMainPage } from '../../src/ui/page.js';
import { getTimestampToolCode } from '../../src/ui/scripts/tools/timestampTool.js';

async function createHarness(initialTime) {
	const html = await (await createMainPage()).text();
	const markup = html.match(/<div id="timestampModal"[\s\S]*?(?=<!-- 密钥检查器模态框 -->)/)[0];
	const elements = new Map();
	for (const match of markup.matchAll(/\bid="([^"]+)"/g)) {
		const classes = new Set();
		let value = '';
		let writes = 0;
		elements.set(match[1], {
			style: {},
			attributes: {},
			classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
			setAttribute(name, attributeValue) {
				this.attributes[name] = attributeValue;
			},
			get textContent() {
				return value;
			},
			set textContent(text) {
				value = String(text);
				writes++;
			},
			get writes() {
				return writes;
			},
		});
	}
	let now = initialTime;
	let nextFrameId = 0;
	const frames = new Map();
	const listeners = new Map();
	const document = {
		hidden: false,
		getElementById: (id) => elements.get(id) || null,
		addEventListener: (event, handler) => listeners.set(event, handler),
	};
	const cancelFrame = vi.fn((id) => frames.delete(id));
	const context = createContext({
		document,
		Date: { now: () => now },
		showModal: (_id, onShow) => onShow(),
		hideModal: vi.fn(),
		requestAnimationFrame: (callback) => {
			const id = nextFrameId++;
			frames.set(id, callback);
			return id;
		},
		cancelAnimationFrame: cancelFrame,
	});
	runInContext(getTimestampToolCode(), context);
	return {
		api: context,
		elements,
		frames,
		cancelFrame,
		fraction: () => Number(elements.get('progressBar').style.transform.match(/scaleX\(([^)]+)\)/)[1]),
		tick(atTime) {
			now = atTime;
			const queued = [...frames.values()];
			frames.clear();
			for (const callback of queued) {
				callback();
			}
		},
		visibility(hidden, atTime = now) {
			now = atTime;
			document.hidden = hidden;
			listeners.get('visibilitychange')();
		},
	};
}

describe('timestamp progress animation', () => {
	it('moves between integer seconds while text only updates once per second', async () => {
		const h = await createHarness(10_000);
		h.api.showTimestampModal();
		expect(h.fraction()).toBeCloseTo(2 / 3);
		const label = h.elements.get('currentTimestamp');
		const initialWrites = label.writes;
		h.tick(10_500);
		expect(h.fraction()).toBeCloseTo(0.65);
		h.tick(10_516);
		expect(h.fraction()).toBeLessThan(0.65);
		expect(label.writes).toBe(initialWrites);
		h.tick(11_000);
		expect(label.textContent).toBe('11');
		expect(label.writes).toBe(initialWrites + 1);
		expect(h.elements.get('remainingTime').textContent).toBe('19 秒');
		expect(h.frames.size).toBe(1);
	});

	it('resets at the exact cycle boundary without accumulating timer drift', async () => {
		const h = await createHarness(29_999);
		h.api.showTimestampModal();
		expect(h.fraction()).toBeCloseTo(1 / 30_000);
		h.tick(30_000);
		expect(h.fraction()).toBe(1);
		expect(h.elements.get('totpCounter').textContent).toBe('1');
		expect(h.elements.get('remainingTime').textContent).toBe('30 秒');
		expect(h.elements.get('progressBar').attributes['aria-valuenow']).toBe('100');
		h.tick(37_500);
		expect(h.fraction()).toBe(0.75);
	});

	it('updates period and countdown immediately without spawning another animation', async () => {
		const h = await createHarness(45_000);
		h.api.showTimestampModal();
		h.api.setPeriod(60);
		expect(h.fraction()).toBe(0.25);
		expect(h.elements.get('totpPeriod').textContent).toBe('60 秒');
		expect(h.elements.get('period60Btn').classList.contains('active')).toBe(true);
		h.api.setPeriod(120);
		expect(h.fraction()).toBe(0.625);
		expect(h.elements.get('remainingTime').textContent).toBe('75 秒');
		expect(h.elements.get('period60Btn').classList.contains('active')).toBe(false);
		expect(h.frames.size).toBe(1);
	});

	it('cancels even frame ID zero on close and stays stopped on visibility changes', async () => {
		const h = await createHarness(10_000);
		h.api.showTimestampModal();
		h.api.hideTimestampModal();
		expect(h.cancelFrame).toHaveBeenCalledWith(0);
		expect(h.frames.size).toBe(0);
		const fraction = h.fraction();
		h.tick(15_000);
		h.visibility(false);
		expect(h.fraction()).toBe(fraction);
		expect(h.frames.size).toBe(0);
	});

	it('keeps only one loop when the dialog is opened repeatedly', async () => {
		const h = await createHarness(10_000);
		h.api.showTimestampModal();
		h.api.showTimestampModal();
		expect(h.frames.size).toBe(1);
		expect(h.cancelFrame).toHaveBeenCalledWith(0);
		h.api.hideTimestampModal();
		expect(h.frames.size).toBe(0);
	});

	it('pauses in the background and recomputes from current time on return', async () => {
		const h = await createHarness(10_000);
		h.api.showTimestampModal();
		h.visibility(true);
		expect(h.frames.size).toBe(0);
		h.tick(72_001);
		expect(h.elements.get('currentTimestamp').textContent).toBe('10');
		h.visibility(false);
		expect(h.elements.get('currentTimestamp').textContent).toBe('72');
		expect(h.fraction()).toBeCloseTo(17_999 / 30_000);
		expect(h.frames.size).toBe(1);
	});
});
