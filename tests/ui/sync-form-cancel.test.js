import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { getS3ToolCode } from '../../src/ui/scripts/tools/s3Tool.js';
import { getWebdavToolCode } from '../../src/ui/scripts/tools/webdavTool.js';
import { getOneDriveToolCode } from '../../src/ui/scripts/tools/onedriveTool.js';
import { getGoogleDriveToolCode } from '../../src/ui/scripts/tools/gdriveTool.js';

const providers = [
	['S3', 's3', getS3ToolCode],
	['Webdav', 'webdav', getWebdavToolCode],
	['OneDrive', 'oneDrive', getOneDriveToolCode],
	['GoogleDrive', 'googleDrive', getGoogleDriveToolCode],
];

function createHarness(code, count = 0) {
	const elements = new Map();
	const document = {
		getElementById(id) {
			if (!elements.has(id)) {elements.set(id, { style: {}, dataset: {}, value: '' });}
			return elements.get(id);
		},
	};
	const state = { count, maxAllowed: 5, destinations: [] };
	const context = createContext({
		document,
		authenticatedFetch: async () => ({ json: async () => state }),
		console,
	});
	runInContext(code, context);
	return { api: context, element: document.getElementById, state };
}

describe.each(providers)('%s destination form cancellation', (name, prefix, code) => {
	it('allows adding another destination immediately after cancelling the form', async () => {
		const { api, element } = createHarness(code());
		await api[`load${name}Destinations`]();
		api[`show${name}Form`]();
		expect(element(`${prefix}AddBtn`).style.display).toBe('none');
		api[`hide${name}Form`]();
		expect(element(`${prefix}FormArea`).style.display).toBe('none');
		expect(element(`${prefix}AddBtn`).style.display).toBe('block');
		api[`show${name}Form`]();
		expect(element(`${prefix}FormArea`).style.display).toBe('block');
	});

	it('keeps the add button hidden at the limit and restores it after a slot is freed', async () => {
		const { api, element, state } = createHarness(code(), 5);
		await api[`load${name}Destinations`]();
		api[`show${name}Form`]('existing-destination');
		api[`hide${name}Form`]();
		expect(element(`${prefix}AddBtn`).style.display).toBe('none');
		state.count = 4;
		await api[`load${name}Destinations`]();
		expect(element(`${prefix}AddBtn`).style.display).toBe('block');
	});
});
