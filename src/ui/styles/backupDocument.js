/** Shared Fluent document layout for server and local HTML backups. */
export function getBackupDocumentStyles() {
	return `
    body { display: block; margin: 0; padding: 32px 24px; }
    .backup-document { width: 100%; max-width: 1440px; min-width: 0; margin: 0 auto; padding: 32px; background: var(--page-surface); border: 1px solid var(--page-line); border-radius: 8px; box-shadow: var(--page-shadow); }
    .document-header { margin-bottom: 24px; }
    .document-header h1 { margin: 0 0 12px; color: var(--page-text); font-size: 28px; font-weight: 600; line-height: 1.3; text-align: left; }
    .meta { color: var(--page-muted); font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
    .meta p { margin: 4px 0; }
    .table-scroll { width: 100%; max-width: 100%; overflow-x: auto; border: 1px solid var(--page-line); border-radius: 4px; }
    .table-scroll:focus-visible { outline: 2px solid var(--page-brand); outline-offset: 3px; }
    table { width: 100%; min-width: 1000px; border-collapse: collapse; background: var(--page-surface); }
    th, td { padding: 12px; border-bottom: 1px solid var(--page-line); text-align: left; vertical-align: top; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    th { color: var(--page-text); background: var(--page-hover); font-weight: 600; white-space: nowrap; }
    td { color: var(--page-text); }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover { background: var(--page-hover); }
    .service { font-weight: 600; }
    .account { color: var(--page-muted); }
    code, .param { font-family: Consolas, "Cascadia Code", monospace; font-size: 12px; }
    code { overflow-wrap: anywhere; word-break: break-all; }
    .qr-cell { text-align: center; min-width: 120px; }
    .qr-cell img { display: block; width: 96px; height: 96px; margin: 0 auto; background: #fff; }
    .qr-placeholder, .qr-cell-placeholder { color: var(--page-muted); font-size: 12px; }
    .partial-warning { margin: 16px 0 0; padding: 12px 16px; border: 1px solid var(--page-line); border-left: 3px solid var(--page-warning); border-radius: 4px; background: var(--page-hover); color: var(--page-text); overflow-wrap: anywhere; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--page-line); color: var(--page-muted); font-size: 12px; overflow-wrap: anywhere; }
    .footer a { color: var(--page-brand); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    @media (max-width: 600px) {
      body { padding: 16px 12px; }
      .backup-document { padding: 20px 16px; }
      .document-header h1 { font-size: 24px; }
    }
    @media print {
      :root, :root[data-theme] { color-scheme: light; }
      body { display: block; min-height: 0; padding: 0; background: #fff; color: #000; }
      .backup-document { max-width: none; padding: 0; border: 0; border-radius: 0; box-shadow: none; background: #fff; }
      .table-scroll { overflow: visible; border: 0; border-radius: 0; }
      table { min-width: 0; width: 100%; table-layout: fixed; background: #fff; }
      th, td { padding: 5px; border: 1px solid #999; background: #fff; color: #000; font-size: 9px; white-space: normal; overflow-wrap: anywhere; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      tbody tr:last-child td { border-bottom: 1px solid #999; }
      code, .param { font-size: 9px; }
      .qr-cell { min-width: 0; }
      .qr-cell img { width: 100%; max-width: 64px; height: auto; }
      .document-header h1, .meta, .account, .qr-placeholder, .qr-cell-placeholder, .footer, .footer a { color: #000; }
      .partial-warning { color: #000; background: #fff; border-color: #999; }
    }
  `;
}
