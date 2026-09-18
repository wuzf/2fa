/** Shared, local SVG artwork for dialog controls and feedback. */
const dialogIconPaths = {
	plus: 'M12 5v14M5 12h14',
	search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1 5 6 6',
	import: 'M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5',
	export: 'M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5',
	restore: 'M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2',
	close: 'M6 6l12 12M18 6L6 18',
	check: 'm5 12 4 4L19 6',
	error: 'M12 8v5m0 3v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
	warning: 'm12 3 10 18H2L12 3ZM12 9v5m0 3v.01',
	info: 'M12 8v.01M12 11v5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
	lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3',
	eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
	'eye-off':
		'm3 3 18 18M10 5a12 12 0 0 1 2 0c6 0 10 7 10 7a20 20 0 0 1-3 4M6 6a20 20 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4',
	key: 'M14 3a6 6 0 1 1-3 11l-7 7H2v-3l7-7a6 6 0 0 1 5-8ZM16 7h.01',
	cloud: 'M6 18a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 0 10H6',
	box: 'm3 6 9-4 9 4v12l-9 4-9-4V6Zm0 0 9 4 9-4M12 10v12',
	folder: 'M3 6h7l2 2h9v12H3V6Zm0 0V4h7l2 2h7v2',
	file: 'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h5',
	grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
	qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v3M3 12h3m6 0h3m6 0v3M12 18v3',
	code: 'm8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16',
	clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
	sliders: 'M6 3v3m0 4v11M18 3v11m0 4v3M3 6h6v4H3zM15 14h6v4h-6z',
	toolbox:
		'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M5 7h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM3 12h18M8 10v4m8-4v4',
	settings:
		'M9.75 4.64L10.26 2.15L13.74 2.15L14.25 4.64L15.61 5.2L17.74 3.81L20.19 6.26L18.8 8.39L19.36 9.75L21.85 10.26L21.85 13.74L19.36 14.25L18.8 15.61L20.19 17.74L17.74 20.19L15.61 18.8L14.25 19.36L13.74 21.85L10.26 21.85L9.75 19.36L8.39 18.8L6.26 20.19L3.81 17.74L5.2 15.61L4.64 14.25L2.15 13.74L2.15 10.26L4.64 9.75L5.2 8.39L3.81 6.26L6.26 3.81L8.39 5.2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
	sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6L7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
	moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10',
	screen: 'M3 4h18v13H3zM8 21h8m-4-4v4',
};

export function dialogIcon(name) {
	const path = Object.prototype.hasOwnProperty.call(dialogIconPaths, name) ? dialogIconPaths[name] : dialogIconPaths.info;
	return `<svg class="dialog-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"></path></svg>`;
}

/** Keep static markup and lazily generated dialogs on the same icon set. */
export function getDialogIconCode() {
	return `
    const dialogIconPaths = ${JSON.stringify(dialogIconPaths)};
    function dialogIcon(name) {
      const path = Object.prototype.hasOwnProperty.call(dialogIconPaths, name) ? dialogIconPaths[name] : dialogIconPaths.info;
      return '<svg class="dialog-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' + path + '"></path></svg>';
    }
    window.dialogIcon = dialogIcon;
  `;
}
