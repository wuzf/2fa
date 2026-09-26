/** Shared by progress indicators in the main UI and standalone pages. */
export const PROGRESS_HEIGHT = '1px';
export const PROGRESS_GRADIENT = 'linear-gradient(90deg, #4CAF50, #2196F3)';

/** Card countdown styles shared by the main UI and the browser extension. */
export function getCardProgressStyles() {
	return `    .progress-top {
      height: var(--progress-height);
      background: transparent;
      border-radius: 0;
      overflow: hidden;
      position: absolute;
      top: -1px;
      left: var(--radius-lg);
      right: var(--radius-lg);
    }

    .progress-top-fill {
      height: 100%;
      background: var(--progress-fill);
      border-radius: 0;
      transition: width 1s linear, background-color 0.5s ease;
      width: 0%;
    }`;
}
