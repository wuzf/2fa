/** Browser extension store links and installation guidance. */
export function getBrowserExtensionCode() {
	return `
    let browserExtensionDialog = null;

    function browserExtensionRecommendation() {
      const agent = navigator.userAgent || '';
      const data = navigator.userAgentData;
      const platform = (data && data.platform) || navigator.platform || '';
      const mobile = Boolean(data && data.mobile) || /Android|iPhone|iPad|iPod|Mobile|Windows Phone|IEMobile/i.test(agent)
        || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1);
      if (mobile) return { browser: null, mobile: true };

      const brands = data && Array.isArray(data.brands)
        ? data.brands.map(entry => String(entry.brand || '')) : [];
      if (/Edg\\//.test(agent) || brands.some(brand => /^Microsoft Edge$/i.test(brand))) {
        return { browser: 'edge', mobile: false };
      }
      if (/Firefox\\//.test(agent)) return { browser: 'firefox', mobile: false };

      const otherBrowser = /OPR\\/|Opera|SamsungBrowser\\/|Vivaldi\\/|YaBrowser\\/|Yowser|Whale\\/|UCBrowser\\/|UCWEB|QQBrowser\\/|Quark\\/|HuaweiBrowser\\/|HeyTapBrowser\\/|MiuiBrowser\\/|Brave\\/|DuckDuckGo\\/|Ddg\\/|Avast\\/|AVG\\/|Puffin\\/|Electron\\/|Chromium\\//i.test(agent)
        || brands.some(brand => /Opera|Brave|Vivaldi|Yandex|Samsung|Whale|DuckDuckGo|Avast|AVG|QQBrowser|Quark|Huawei|UC Browser/i.test(brand))
        || Boolean(navigator.brave);
      if (otherBrowser) return { browser: null, mobile: false };

      const chromeBrand = brands.some(brand => /^Google Chrome$/i.test(brand));
      const chromeAgent = /Chrome\\//.test(agent) && !/Edge\\//.test(agent);
      // A Chromium-only brand list also belongs to browsers other than Chrome.
      return { browser: chromeBrand || (brands.length === 0 && chromeAgent) ? 'chrome' : null, mobile: false };
    }

    function browserExtensionFocusable(modal) {
      return Array.from(modal.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).filter(element => {
        return element.tabIndex >= 0 && !element.disabled && !element.closest('[hidden], [inert]')
          && element.getClientRects().length > 0;
      });
    }

    function openBrowserExtensionStore() {
      const browser = browserExtensionRecommendation().browser;
      const storeIds = { chrome: 'extensionChromeStore', edge: 'extensionEdgeStore', firefox: 'extensionFirefoxStore' };
      const link = browser && document.getElementById(storeIds[browser]);
      if (link) {
        window.open(link.href, '_blank', 'noopener,noreferrer');
        return;
      }
      showBrowserExtensionModal();
    }

    function focusBrowserExtensionElement(element) {
      if (element && typeof element.focus === 'function') element.focus({ preventScroll: true });
    }

    function handleBrowserExtensionKeydown(event) {
      const state = browserExtensionDialog;
      if (!state) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        hideBrowserExtensionModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = browserExtensionFocusable(state.modal);
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (!first || !state.modal.contains(active) || active === state.modal
        || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        focusBrowserExtensionElement(event.shiftKey ? (last || state.modal) : (first || state.modal));
      }
    }

    function handleBrowserExtensionFocus(event) {
      const state = browserExtensionDialog;
      if (state && !state.modal.contains(event.target)) {
        focusBrowserExtensionElement(browserExtensionFocusable(state.modal)[0] || state.modal);
      }
    }

    function handleBrowserExtensionBackdrop(event) {
      if (browserExtensionDialog && event.target === browserExtensionDialog.modal) hideBrowserExtensionModal();
    }

    function restoreBrowserExtensionScroll(state) {
      enableBodyScroll();
      if (state.wasFixed) return;

      const restore = () => {
        for (const [property, value] of Object.entries(state.bodyStyles)) document.body.style[property] = value;
        window.scrollTo(state.scrollX, state.scrollY);
      };
      if (document.body.style.position !== 'fixed') {
        restore();
        return;
      }
      // If another dialog opened meanwhile, keep the background in place until
      // the shared lock counter releases its last lock. Do not unlock that dialog.
      const observer = new MutationObserver(() => {
        if (document.body.style.position !== 'fixed') {
          observer.disconnect();
          restore();
        }
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    }

    function showBrowserExtensionModal() {
      if (browserExtensionDialog) return;
      const modal = document.getElementById('browserExtensionModal');
      const input = document.getElementById('extensionInstanceUrl');
      if (!modal || !input) return;

      const recommendation = browserExtensionRecommendation();
      const hint = document.getElementById('extensionBrowserHint');
      if (hint) {
        hint.textContent = recommendation.mobile
          ? t('extensionMobileHint')
          : t('extensionDesktopHint');
      }

      const origin = window.location.origin;
      const instanceOrigin = typeof origin === 'string' && /^https?:\\/\\//.test(origin) ? origin : '';
      input.value = instanceOrigin;
      const status = document.getElementById('extensionCopyStatus');
      if (status) status.textContent = instanceOrigin ? '' : t('extensionNoInstance');
      const copyButton = document.getElementById('extensionCopyInstance');
      if (copyButton) copyButton.disabled = !instanceOrigin;

      const bodyStyles = {};
      for (const property of ['overflow', 'position', 'width', 'top', 'left']) bodyStyles[property] = document.body.style[property];
      const state = {
        modal, input, status, copyButton, instanceOrigin, copying: false,
        statusKey: instanceOrigin ? '' : 'extensionNoInstance',
        returnFocus: document.activeElement,
        scrollX: window.scrollX, scrollY: window.scrollY,
        wasFixed: document.body.style.position === 'fixed', bodyStyles
      };
      browserExtensionDialog = state;
      disableBodyScroll();
      if (!state.wasFixed) {
        document.body.style.top = -state.scrollY + 'px';
        document.body.style.left = -state.scrollX + 'px';
      }
      modal.hidden = false;
      modal.style.display = 'flex';
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      modal.setAttribute('tabindex', '-1');
      const trigger = document.getElementById('browserExtensionTrigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      modal.addEventListener('click', handleBrowserExtensionBackdrop);
      document.addEventListener('keydown', handleBrowserExtensionKeydown, true);
      document.addEventListener('focusin', handleBrowserExtensionFocus, true);
      focusBrowserExtensionElement(document.getElementById('browserExtensionClose') || browserExtensionFocusable(modal)[0] || modal);
    }

    function refreshBrowserExtensionLanguage() {
      const state = browserExtensionDialog;
      if (!state) return;
      const hint = document.getElementById('extensionBrowserHint');
      if (hint) hint.textContent = t(browserExtensionRecommendation().mobile ? 'extensionMobileHint' : 'extensionDesktopHint');
      if (state.status) state.status.textContent = state.statusKey ? t(state.statusKey) : '';
    }

    function hideBrowserExtensionModal() {
      const state = browserExtensionDialog;
      if (!state) return;
      browserExtensionDialog = null;
      state.modal.removeEventListener('click', handleBrowserExtensionBackdrop);
      document.removeEventListener('keydown', handleBrowserExtensionKeydown, true);
      document.removeEventListener('focusin', handleBrowserExtensionFocus, true);
      state.modal.classList.remove('show');
      state.modal.style.display = 'none';
      state.modal.hidden = true;
      state.modal.setAttribute('aria-hidden', 'true');
      const trigger = document.getElementById('browserExtensionTrigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      restoreBrowserExtensionScroll(state);
      const target = state.returnFocus && state.returnFocus.isConnected && state.returnFocus !== document.body
        ? state.returnFocus : trigger;
      focusBrowserExtensionElement(target);
    }

    async function copyExtensionInstanceUrl() {
      const state = browserExtensionDialog;
      if (!state || state.copying || !state.instanceOrigin) return;
      state.copying = true;
      if (state.copyButton) state.copyButton.disabled = true;
      state.statusKey = '';
      if (state.status) state.status.textContent = '';
      let copied = false;
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(state.instanceOrigin);
          copied = true;
        }
      } catch {
        // Fall back to a selected, readonly input when clipboard access is denied.
      }
      if (browserExtensionDialog !== state) return;
      if (!copied) {
        state.input.value = state.instanceOrigin;
        focusBrowserExtensionElement(state.input);
        state.input.select();
        try {
          copied = typeof document.execCommand === 'function' && document.execCommand('copy') === true;
        } catch {
          copied = false;
        }
      }
      if (browserExtensionDialog !== state) return;
      state.copying = false;
      if (state.copyButton) state.copyButton.disabled = false;
      state.statusKey = copied ? 'extensionInstanceCopied' : 'extensionInstanceCopyFailed';
      if (state.status) state.status.textContent = t(state.statusKey);
      if (copied) focusBrowserExtensionElement(state.copyButton);
    }
  `;
}
