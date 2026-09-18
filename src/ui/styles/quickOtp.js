import { PROGRESS_GRADIENT, PROGRESS_HEIGHT } from './progress.js';

/** Shared Fluent layout for the public OTP form and code page. */
export function getQuickOtpStyles() {
	return `
    .otp-shell { width: 100%; max-width: 456px; min-width: 0; margin: auto; }
    .otp-brand { display: inline-flex; gap: 8px; align-items: center; margin: 0 0 18px 4px; color: var(--page-muted); font-weight: 600; text-decoration: none; }
    .otp-brand .dialog-icon { width: 18px; height: 18px; }
    .otp-card { position: relative; max-width: none; margin: 0; padding: 28px; border-radius: 16px; }
    .otp-header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
    .otp-header-icon { display: grid; place-items: center; flex: 0 0 40px; height: 40px; background: var(--page-bg); color: var(--page-brand); border: 1px solid var(--page-line); border-radius: 10px; }
    .otp-header .page-title { font-size: 18px; line-height: 24px; margin: 0; }
    .otp-subtitle { color: var(--page-muted); font-size: 12px; margin: 4px 0 0; }
    .otp-current-label { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--page-muted); font-size: 12px; }
    .countdown { margin: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .token-button { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 0; border-radius: 6px; background: transparent; color: var(--page-text); cursor: pointer; font-family: inherit; text-align: left; }
    .token-button:hover:not(:disabled) { color: var(--page-brand); background: var(--page-bg); }
    .token-button:active:not(:disabled) { background: var(--page-hover); }
    .token-button:disabled { cursor: default; color: var(--page-muted); }
    .token-button svg { flex-shrink: 0; color: var(--page-muted); }
    .token { width: calc(100% + 16px); margin: 8px -8px 24px; padding: 8px; }
    .token-value { font: 600 clamp(32px, 9vw, 48px)/1.2 'Segoe UI Variable Display', 'Segoe UI', 'Microsoft YaHei', sans-serif; font-variant-numeric: tabular-nums; letter-spacing: 2px; white-space: nowrap; }
    .otp-next { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 0 0; border-top: 1px solid var(--page-line); }
    .otp-next-label { font-size: 13px; color: var(--page-muted); white-space: nowrap; }
    .next-token { padding: 8px; margin: -8px; }
    .next-token-value { font-size: 22px; font-weight: 500; line-height: 28px; font-variant-numeric: tabular-nums; letter-spacing: 1px; white-space: nowrap; }
    .copied-message { min-height: 18px; margin: 20px 0 0; color: var(--page-muted); font-size: 12px; line-height: 18px; }
    .copied-message.error { color: var(--page-danger); }
    .progress-container { position: absolute; top: -1px; left: 16px; right: 16px; height: ${PROGRESS_HEIGHT}; overflow: hidden; }
    .progress-bar { height: 100%; width: 100%; background: ${PROGRESS_GRADIENT}; transform-origin: left; transition: transform .25s linear; }
    .otp-footer { display: flex; justify-content: space-between; gap: 16px; padding: 18px 4px 0; font-size: 12px; }
    .otp-footer .page-link { color: var(--page-muted); text-decoration: none; }
    .otp-footer .page-link:hover { color: var(--page-brand); text-decoration: underline; }
    .refresh-status { font-size: 12px; line-height: 18px; color: var(--page-danger); }
    .refresh-status p { margin: 12px 0 0; }
    .refresh-status p:empty { display: none; }
    .retry-button { margin-top: 8px; min-height: 36px; padding: 6px 12px; border: 1px solid var(--page-stroke); border-radius: 4px; background: var(--page-surface); color: var(--page-text); font: inherit; cursor: pointer; }
    .otp-card .page-notice { margin: 0; }
    @media (max-width: 600px) {
      .otp-card { padding: 24px; }
      .token-button { min-height: 44px; }
    }
    @media (max-width: 360px) {
      .otp-card { padding: 20px; }
      .token-value { font-size: 32px; letter-spacing: 1px; }
      .next-token-value { font-size: 20px; }
    }
    @media (prefers-reduced-motion: reduce) { .progress-bar { transition: none; } }
  
    .otp-entry .page-label { font-size: 13px; line-height: 20px; margin-bottom: 8px; }
    .otp-entry .page-input { min-height: 48px; padding: 12px; font-size: 16px; line-height: 22px; border-radius: 6px; }
    .otp-entry-hint { margin: 10px 0 0; color: var(--page-muted); font-size: 12px; line-height: 18px; }
    .otp-entry .page-button { width: 100%; min-height: 44px; margin-top: 24px; border-radius: 6px; }
  `;
}
