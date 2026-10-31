import { build } from 'esbuild';
import vm from 'node:vm';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

describe('serialized browser closures', () => {
	it.each([
		{ minify: false, keepNames: false },
		{ minify: true, keepNames: false },
		{ minify: false, keepNames: true },
		{ minify: true, keepNames: true },
	])('preserves nested callables and explicit dependencies (minify=$minify, keepNames=$keepNames)', async ({ minify, keepNames }) => {
		const bundle = await build({
			stdin: {
				resolveDir: process.cwd(),
				contents: `
          import { serializeBrowserFunction } from './src/ui/scripts/browserSource.js';
          import { createAccountRenderer } from './src/ui/themes/renderer.js';
          import { createAppearanceDraft } from './src/ui/scripts/appearanceEditor.js';
          import { createAppearanceController } from './src/ui/scripts/appearanceRuntime.js';
          import { validateSettingValue, migrateSettings } from './src/themes/schema.js';
          import { getAppearanceErrorCode } from './src/ui/scripts/appearanceMessages.js';
          export const sources = {
            renderer: serializeBrowserFunction(createAccountRenderer),
            controller: serializeBrowserFunction(createAppearanceController),
            draft: serializeBrowserFunction(createAppearanceDraft),
            validate: serializeBrowserFunction(validateSettingValue),
            migrate: serializeBrowserFunction(migrateSettings),
            errors: getAppearanceErrorCode(),
            unresolved: serializeBrowserFunction(function unresolved() { return externalDependency(); })
          };
        `,
			},
			bundle: true,
			format: 'iife',
			globalName: 'serialized',
			platform: 'neutral',
			target: 'es2022',
			minify,
			keepNames,
			write: false,
		});
		const sources = vm.runInNewContext(bundle.outputFiles[0].text + '\nserialized.sources', { TextEncoder, TextDecoder });
		const window = new Window({ url: 'https://example.com/' });
		try {
			const context = vm.createContext({ window, document: window.document });
			const renderer = vm.runInContext(sources.renderer, context)();
			expect(renderer.card({ id: '1', name: 'Sample', account: 'work' })).toContain('data-account-action="edit"');
			const controller = vm.runInContext(sources.controller, context)(window.document);
			controller.apply({ manifest: { id: 'test' } });
			expect(window.document.documentElement.dataset.themeId).toBe('test');
			const validate = vm.runInContext(sources.validate, context);
			const migrate = vm.runInContext(sources.migrate, context);
			const draft = vm.runInContext(sources.draft, context);
			const field = { key: 'size', type: 'number', default: 14, min: 10, max: 20 };
			const manifest = { id: 'test', settings: [field], layout: {}, content: {} };
			const next = draft(
				{ packageId: 'v2', manifest },
				{ themeId: 'test', packageId: 'v1', manifest, settings: { size: 18 } },
				{},
				(before, after, values) => migrate(before, after, values, validate),
			);
			expect(next.draft.settings.size).toBe(18);
			expect(next.draft.packageId).toBe('v2');
			vm.runInContext(sources.errors, context);
			expect(window.localizeAppearanceError({ code: 'THEME_INVALID_SETTINGS', details: { field: 'size' } }, 400)).toBe(
				'appearanceErrorSettings [size]',
			);
			const unresolved = vm.runInContext(sources.unresolved, context);
			expect(() => unresolved()).toThrow(/externalDependency/);
		} finally {
			await window.happyDOM.close();
		}
	});
});
