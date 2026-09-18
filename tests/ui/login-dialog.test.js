import { createContext, runInContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMainPage } from '../../src/ui/page.js';
import { getAuthCode } from '../../src/ui/scripts/auth.js';

async function createLoginHarness() {
	const html = await (await createMainPage()).text();
	const loginMarkup = html.match(/<div\b[^>]*\bid="loginModal"[\s\S]*?(?=<!-- 页面底部链接 -->)/)?.[0];
	expect(loginMarkup).toBeDefined();

	const elements = new Map();
	// Only create nodes that the actual page renders. Inventing loginError here
	// would hide a regression where the template drops this required element.
	for (const match of loginMarkup.matchAll(/<([a-z][\w:-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
		const attributes = Object.fromEntries([...match[2].matchAll(/([\w:-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]]));
		const classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
		const style = Object.fromEntries(
			(attributes.style || '')
				.split(';')
				.map((declaration) => declaration.split(':').map((part) => part.trim()))
				.filter((declaration) => declaration.length === 2),
		);
		elements.set(match[3], {
			tagName: match[1].toUpperCase(),
			type: attributes.type || '',
			value: attributes.value || '',
			textContent: '',
			style,
			attributes,
			classList: {
				add: (name) => classes.add(name),
				remove: (name) => classes.delete(name),
				contains: (name) => classes.has(name),
				toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
			},
			focus: vi.fn(),
			setAttribute: (name, value) => {
				attributes[name] = value;
			},
		});
	}

	const fetch = vi.fn();
	const showCenterToast = vi.fn();
	const loadSecrets = vi.fn();
	const context = createContext({
		document: { getElementById: (id) => elements.get(id) || null },
		window: { isSecureContext: true },
		console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
		requestAnimationFrame: (callback) => callback(),
		setTimeout,
		clearTimeout,
		fetch,
		showCenterToast,
		loadSecrets,
	});
	runInContext(getAuthCode(), context);
	return { context, elements, fetch, showCenterToast, loadSecrets };
}

describe('login dialog with the generated page DOM', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('opens, clears old feedback, and focuses the password field', async () => {
		const { context, elements } = await createLoginHarness();
		const input = elements.get('loginToken');
		input.value = 'previous attempt';
		input.type = 'text';

		expect(() => context.showLoginModal()).not.toThrow();
		expect(elements.get('loginModal').style.display).toBe('flex');
		expect(elements.get('loginModal').classList.contains('show')).toBe(true);
		expect(elements.get('loginError').style.display).toBe('none');
		expect(input.value).toBe('');
		expect(input.type).toBe('password');
		vi.advanceTimersByTime(100);
		expect(input.focus).toHaveBeenCalledOnce();
	});

	it('shows an empty password error without sending a request', async () => {
		const { context, elements, fetch } = await createLoginHarness();
		elements.get('loginToken').value = '   ';

		await expect(context.handleLoginSubmit()).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
		expect(elements.get('loginError').textContent).toBe('请输入密码');
		expect(elements.get('loginError').style.display).toBe('block');
	});

	it('shows a rejected password and lets the user retry', async () => {
		const { context, elements, fetch, loadSecrets } = await createLoginHarness();
		elements.get('loginToken').value = 'wrong password';
		fetch.mockResolvedValue({ ok: false, json: async () => ({ message: '密码错误，请重试' }) });

		await expect(context.handleLoginSubmit()).resolves.toBeUndefined();
		expect(fetch).toHaveBeenCalledWith(
			'/api/login',
			expect.objectContaining({
				method: 'POST',
				credentials: 'include',
				body: JSON.stringify({ credential: 'wrong password' }),
			}),
		);
		expect(elements.get('loginError').textContent).toBe('密码错误，请重试');
		expect(elements.get('loginError').style.display).toBe('block');
		expect(elements.get('loginToken').value).toBe('');
		expect(elements.get('loginToken').focus).toHaveBeenCalledOnce();
		expect(loadSecrets).not.toHaveBeenCalled();
	});

	it('shows network failures instead of rejecting while rendering the error', async () => {
		const { context, elements, fetch } = await createLoginHarness();
		elements.get('loginToken').value = 'test password';
		fetch.mockRejectedValue(new Error('Network unavailable'));

		await expect(context.handleLoginSubmit()).resolves.toBeUndefined();
		expect(elements.get('loginError').textContent).toBe('登录失败：Network unavailable');
		expect(elements.get('loginError').style.display).toBe('block');
	});

	it('closes the dialog and reloads the secrets after successful login', async () => {
		const { context, elements, fetch, showCenterToast, loadSecrets } = await createLoginHarness();
		context.showLoginModal();
		elements.get('loginToken').value = 'valid password';
		fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, expiresIn: '30 天' }) });

		await expect(context.handleLoginSubmit()).resolves.toBeUndefined();
		expect(showCenterToast).toHaveBeenCalledWith('✅', '登录成功，有效期 30 天');
		expect(loadSecrets).toHaveBeenCalledOnce();
		expect(elements.get('loginModal').classList.contains('show')).toBe(false);
		vi.advanceTimersByTime(300);
		expect(elements.get('loginModal').style.display).toBe('none');
	});
});
