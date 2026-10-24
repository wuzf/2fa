/** The account presentation contract. Models contain displayed values, never OTP secrets. */
export function createAccountRenderer() {
	const escape = (value) =>
		String(value ?? '').replace(
			/[&<>"']/g,
			(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
		);
	function card(model, labels = {}) {
		const id = escape(model.id);
		const name = escape(model.name);
		const label = (key, fallback) => escape(labels[key] || fallback);
		const action = (name) => ' data-account-action="' + name + '"';
		const menu = [
			['qr', 'cardMenuQRCode', 'QR code', 'cardMenuQRCodeTitle'],
			['uri', 'cardMenuCopyURI', 'Copy URI', 'cardMenuCopyURITitle'],
			['link', 'cardMenuCopyLink', 'Copy link', 'cardMenuCopyLinkTitle'],
			['edit', 'cardMenuEdit', 'Edit', 'cardMenuEditTitle'],
			['delete', 'cardMenuDelete', 'Delete', 'cardMenuDeleteTitle'],
		]
			.map(
				([name, key, fallback, title]) =>
					'<button type="button" class="menu-item' +
					(name === 'delete' ? ' menu-item-danger' : '') +
					'"' +
					action(name) +
					' title="' +
					label(title, fallback) +
					'">' +
					label(key, fallback) +
					'</button>',
			)
			.join('');
		return (
			'<div class="secret-card" data-part="account" data-account-id="' +
			id +
			'" title="' +
			label('cardCopyTooltip', 'Copy code') +
			'">' +
			(model.isHOTP
				? ''
				: '<div class="progress-top" data-part="progress"><div class="progress-top-fill" id="progress-' + id + '"></div></div>') +
			'<div class="card-header" data-part="account-header"><div class="secret-info" data-part="identity"><div class="service-icon" data-part="service-icon">' +
			(model.logoUrl
				? '<img src="' +
					escape(model.logoUrl) +
					'" alt="' +
					name +
					'"><span hidden>' +
					escape(
						String(model.name || '')
							.charAt(0)
							.toUpperCase(),
					) +
					'</span>'
				: '<span>' +
					escape(
						String(model.name || '')
							.charAt(0)
							.toUpperCase(),
					) +
					'</span>') +
			'</div><div class="secret-text"><h3><span class="secret-name" data-part="service" title="' +
			name +
			'">' +
			name +
			'</span>' +
			(model.isHOTP ? '<span class="secret-type">[HOTP]</span>' : '') +
			'</h3>' +
			(model.account ? '<p data-part="account-name" title="' + escape(model.account) + '">' + escape(model.account) + '</p>' : '') +
			(model.isHOTP
				? '<p class="account-counter" data-part="counter" id="counter-' +
					id +
					'">' +
					label('counterLabel', 'Counter: ') +
					escape(model.counter ?? 0) +
					'</p>'
				: '') +
			'</div></div><div class="card-menu" data-part="menu" title=""><button type="button" class="card-menu-trigger" title="' +
			label('cardMenuTriggerTitle', 'Account actions') +
			'" aria-label="' +
			label('cardMenuTriggerTitle', 'Account actions') +
			'" aria-expanded="false" aria-controls="menu-' +
			id +
			'"' +
			action('menu') +
			'><span class="menu-dots" aria-hidden="true">⋮</span></button><div class="card-menu-dropdown" id="menu-' +
			id +
			'">' +
			menu +
			'</div></div></div>' +
			'<div class="otp-preview" data-part="codes"><div class="otp-main"><div class="otp-code-container"><button type="button" class="otp-code" data-part="code" id="otp-' +
			id +
			'"' +
			action('copy') +
			' title="' +
			label('copyOtpBtnTitle', 'Copy code') +
			'" aria-label="' +
			label('copyOtpBtnAriaLabel', 'Copy current code') +
			'">' +
			escape(model.code || '------') +
			'</button></div>' +
			(model.isHOTP
				? ''
				: '<button type="button" class="otp-next-container" data-part="next-code-button"' +
					action('next') +
					' title="' +
					label('copyNextOtpBtnTitle', 'Copy next code') +
					'"><span class="otp-next-label">' +
					label('otpNextLabel', 'Next') +
					'</span><span class="otp-next-code" data-part="next-code" id="next-otp-' +
					id +
					'">' +
					escape(model.nextCode || '------') +
					'</span></button>') +
			'</div></div></div>'
		);
	}
	function bind(container, dispatch) {
		const onClick = (event) => {
			const element = event.target.closest?.('[data-account-id]');
			if (!element || !container.contains(element)) {
				return;
			}
			const control = event.target.closest('[data-account-action]');
			if (!control && event.target.closest('a,button,input,select,textarea,.card-menu,.secret-actions')) {
				return;
			}
			const action = control?.getAttribute('data-account-action') || 'copy';
			if (control) {
				event.stopPropagation();
			}
			dispatch(action, element.getAttribute('data-account-id'), event);
		};
		const onError = (event) => {
			const image = event.target;
			if (image.matches?.('[data-part="service-icon"] img')) {
				image.hidden = true;
				if (image.nextElementSibling) {
					image.nextElementSibling.hidden = false;
				}
			}
		};
		container.addEventListener('click', onClick);
		container.addEventListener('error', onError, true);
		return () => {
			container.removeEventListener('click', onClick);
			container.removeEventListener('error', onError, true);
		};
	}
	return { card, bind };
}
