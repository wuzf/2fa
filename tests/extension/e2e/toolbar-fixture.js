import { expect } from '@playwright/test';

export async function openToolbarPopup(context, extensionId, targetPage) {
	await targetPage.bringToFront();
	const cdp = await context.browser().newBrowserCDPSession();
	const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
	const target = targetInfos.find((entry) => entry.url === targetPage.url());
	expect(target).toBeDefined();
	await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId });
	let popupTarget;
	await expect
		.poll(async () => {
			popupTarget = (await cdp.send('Target.getTargets')).targetInfos.find(
				(entry) => entry.url === `chrome-extension://${extensionId}/popup.html`,
			);
			return Boolean(popupTarget);
		})
		.toBe(true);
	const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: false });
	const pending = new Map();
	let nextId = 0;
	const receive = (event) => {
		if (event.sessionId !== sessionId) {
			return;
		}
		const message = JSON.parse(event.message);
		const callback = pending.get(message.id);
		if (!callback) {
			return;
		}
		pending.delete(message.id);
		clearTimeout(callback.timer);
		if (message.error) {
			callback.reject(new Error(message.error.message));
		} else {
			callback.resolve(message.result);
		}
	};
	cdp.on('Target.receivedMessageFromTarget', receive);
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const id = ++nextId;
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error(`Toolbar command timed out: ${method}`));
			}, 5000);
			pending.set(id, { resolve, reject, timer });
			cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch((error) => {
				clearTimeout(timer);
				pending.delete(id);
				reject(error);
			});
		});
	await send('Runtime.runIfWaitingForDebugger');
	const evaluate = async (expression) => {
		const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.text);
		}
		return result.result.value;
	};
	return {
		evaluate,
		click: async (selector) => {
			const point = await evaluate(`(() => {
				const element = document.querySelector(${JSON.stringify(selector)});
				element.scrollIntoView({block:'nearest'});
				const rect = element.getBoundingClientRect();
				return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
			})()`);
			await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
			await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
		},
		close: async () => {
			cdp.off('Target.receivedMessageFromTarget', receive);
			await cdp.send('Target.closeTarget', { targetId: popupTarget.targetId });
			await cdp.detach();
		},
	};
}
