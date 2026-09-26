import { dialogIcon } from './dialogIcons.js';
import { getStandaloneHead, getStandaloneI18nScript, getStandaloneLanguageSelect, getStandaloneText } from './standalone.js';
import { getRequestLanguage } from '../utils/i18n.js';
import { getQuickOtpScript } from './scripts/quickOtp.js';
import { getQuickOtpStyles } from './styles/quickOtp.js';

/** Public entry form; API clients still receive the plain-text usage response. */
export function createOtpEntryPage(request) {
	const language = getRequestLanguage(request, 'en');
	const t = (key, params) => getStandaloneText(language, key, params);
	return new Response(
		`<!DOCTYPE html>
<html lang="${language}">
<head>${getStandaloneHead(t('otpEntryPageTitle'), getQuickOtpStyles())}</head>
<body>
  <main class="otp-shell" aria-labelledby="otpEntryTitle">
    <a class="otp-brand" href="/">${dialogIcon('key')}<span>2FA</span></a>
    <section class="standalone-card otp-card otp-entry" aria-label="${t('otpEntrySection')}" data-standalone-aria-label="otpEntrySection">
      <div class="standalone-language-row">${getStandaloneLanguageSelect(language)}</div>
      <header class="otp-header">
        <div class="otp-header-icon">${dialogIcon('lock')}</div>
        <div>
          <h1 class="page-title" id="otpEntryTitle" data-standalone-i18n="otpEntryTitle">${t('otpEntryTitle')}</h1>
          <p class="otp-subtitle" data-standalone-i18n="otpEntryDescription">${t('otpEntryDescription')}</p>
        </div>
      </header>
      <form id="otpEntryForm">
        <label class="page-label" for="s" data-standalone-i18n="otpSecretLabel">${t('otpSecretLabel')}</label>
        <input class="page-input" id="s" name="secret" aria-describedby="otpEntryHint" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${t('otpSecretPlaceholder')}" data-standalone-placeholder="otpSecretPlaceholder" required>
        <p class="otp-entry-hint" id="otpEntryHint" data-standalone-i18n="otpSecretHint">${t('otpSecretHint')}</p>
        <button class="page-button" type="submit" data-standalone-i18n="otpEntryTitle">${t('otpEntryTitle')}</button>
      </form>
    </section>
    <nav class="otp-footer" aria-label="${t('standaloneNavigation')}" data-standalone-aria-label="standaloneNavigation">
      <a class="page-link" href="/" data-standalone-i18n="standaloneHome">${t('standaloneHome')}</a>
    </nav>
  </main>
  <script>${getStandaloneI18nScript({ language, titleKey: 'otpEntryPageTitle' })}</script>
  <script>
    document.getElementById('otpEntryForm').addEventListener('submit', function (event) {
      event.preventDefault();
      const secret = document.getElementById('s').value.trim().replace(/\\s+/g, '');
      if (secret) location.href = '/otp/' + encodeURIComponent(secret) + '?lang=' + encodeURIComponent(standaloneLanguage);
    });
  </script>
</body>
</html>`,
		{
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'public, max-age=300',
				Vary: 'Accept, Accept-Language, X-Language',
				'Content-Language': language,
				'X-Content-Type-Options': 'nosniff',
			},
		},
	);
}

/** Render current/next TOTP codes or a fixed-counter HOTP code. */
export function createQuickOtpPage(otp, options = {}) {
	const {
		period = 30,
		remainingTime = 30,
		type = 'TOTP',
		counter = 0,
		nextToken = '',
		followingToken = '',
		validUntil = 0,
		serverTime,
		request,
	} = options;
	const language = getRequestLanguage(request, 'en');
	const t = (key, params) => getStandaloneText(language, key, params);
	const isHOTP = String(type).toUpperCase() === 'HOTP';
	const safeCode = (value) => (/^([0-9]{6}|[0-9]{8})$/.test(String(value)) ? String(value) : '');
	const current = safeCode(otp);
	const next = safeCode(nextToken);
	const totalTime = [30, 60, 120].includes(period) ? period : 30;
	const remaining =
		Number.isFinite(serverTime) && Number.isFinite(validUntil) && validUntil > 0
			? (validUntil - serverTime) / 1000
			: Number.isFinite(remainingTime)
				? remainingTime
				: totalTime;
	const counterLabel = Number.isSafeInteger(counter) && counter >= 0 ? counter : 0;
	const copyIcon =
		'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
	const htmlContent = `<!DOCTYPE html>
<html lang="${language}">
<head>${getStandaloneHead(t('otpPageTitle'), getQuickOtpStyles())}</head>
<body>
  <main class="otp-shell" aria-labelledby="otpTitle">
    <a class="otp-brand" href="/">${dialogIcon('key')}<span>2FA</span></a>
    <section class="standalone-card otp-card" aria-label="${t('otpSection')}" data-standalone-aria-label="otpSection">
      <div class="standalone-language-row">${getStandaloneLanguageSelect(language)}</div>
      ${isHOTP ? '' : `<div class="progress-container"><div class="progress-bar" id="progress" role="progressbar" aria-label="${t('otpProgress')}" data-standalone-aria-label="otpProgress" aria-valuemin="0" aria-valuemax="100"></div></div>`}
      <header class="otp-header">
        <div class="otp-header-icon">${dialogIcon(isHOTP ? 'key' : 'clock')}</div>
        <div>
          <h1 class="page-title" id="otpTitle" data-standalone-i18n="otpTitle">${t('otpTitle')}</h1>
          <p class="otp-subtitle" data-standalone-i18n="${isHOTP ? 'otpHotpSubtitle' : 'otpTotpSubtitle'}" data-standalone-params='{"seconds":${totalTime}}'>${t(isHOTP ? 'otpHotpSubtitle' : 'otpTotpSubtitle', { seconds: totalTime })}</p>
        </div>
      </header>
      <div class="otp-current-label">
        <span data-standalone-i18n="otpCurrent">${t('otpCurrent')}</span>
        ${isHOTP ? '' : '<p class="countdown" id="countdown"></p>'}
      </div>
      <button class="token-button token" id="token" type="button" aria-label="${t('otpCopyCurrent')}" title="${t('otpCopyCurrent')}" data-standalone-aria-label="otpCopyCurrent" data-standalone-title="otpCopyCurrent">
        <span class="token-value" id="tokenValue">${current || '------'}</span>
        ${copyIcon}
      </button>
      ${
				isHOTP
					? `<p class="page-notice" data-standalone-i18n="otpHotpNotice" data-standalone-params='{"counter":${counterLabel}}'>${t('otpHotpNotice', { counter: counterLabel })}</p>`
					: `<div class="otp-next">
        <span class="otp-next-label" data-standalone-i18n="otpNext">${t('otpNext')}</span>
        <button class="token-button next-token" id="nextToken" type="button" aria-label="${t('otpCopyNext')}" title="${t('otpCopyNext')}" data-standalone-aria-label="otpCopyNext" data-standalone-title="otpCopyNext">
          <span class="next-token-value" id="nextTokenValue">${next}</span>
          ${copyIcon}
        </button>
      </div>`
			}
      <p class="copied-message" id="copied" role="status" aria-live="polite" data-standalone-i18n="otpCopyHint">${t('otpCopyHint')}</p>
      ${
				isHOTP
					? ''
					: `<div class="refresh-status">
        <p id="refreshMessage" role="status" aria-live="polite"></p>
        <button class="retry-button" id="retry" type="button" hidden data-standalone-i18n="otpRetry">${t('otpRetry')}</button>
      </div>`
			}
    </section>
    <nav class="otp-footer" aria-label="${t('standaloneNavigation')}" data-standalone-aria-label="standaloneNavigation">
      <a class="page-link" href="/otp" data-standalone-i18n="otpOtherSecret">${t('otpOtherSecret')}</a>
      <a class="page-link" href="/" data-standalone-i18n="standaloneHome">${t('standaloneHome')}</a>
    </nav>
  </main>
  <script>${getStandaloneI18nScript({ language, titleKey: 'otpPageTitle' })}</script>
  <script>${getQuickOtpScript({
		isHOTP,
		period: totalTime,
		remainingTime: remaining,
		validUntil: Number.isFinite(validUntil) ? validUntil : 0,
		followingToken: safeCode(followingToken),
	})}</script>
</body>
</html>`;

	return new Response(htmlContent, {
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
			Pragma: 'no-cache',
			Expires: '0',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			'Referrer-Policy': 'no-referrer',
			'Content-Language': language,
		},
	});
}

/** Use the generated code's period, even if generation crossed its expiry. */
export function calculateRemainingTime(period = 30, generatedAt = Math.floor(Date.now() / 1000)) {
	const currentCounter = Math.floor(generatedAt / period);
	const expirationTime = (currentCounter + 1) * period * 1000;
	return Math.max(0, (expirationTime - Date.now()) / 1000);
}
