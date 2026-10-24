/**
 * UI 交互模块
 * 包含 Toast 提示、主题切换、模态框管理、滚动控制等 UI 交互功能
 */

/**
 * 获取 UI 交互相关代码
 * @returns {string} UI JavaScript 代码
 */
export function getUICode() {
	return `    // ========== UI 交互模块 ==========

    // Browsers can retain :focus-visible when a keyboard-focused button is
    // clicked again. Track input changes without blurring the current control.
    document.addEventListener('pointerdown', function() {
      document.documentElement.setAttribute('data-card-input', 'pointer');
    }, true);
    document.addEventListener('keydown', function(event) {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        document.documentElement.removeAttribute('data-card-input');
      }
    }, true);

    // Toast 提示相关变量
    let toastTimeout = null;
    let isToastVisible = false;
    let lastToastTime = 0;
    let toastGeneration = 0;

    function refreshToastLanguage() {
      toastGeneration += 1;
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = null;
      isToastVisible = false;
      lastToastTime = 0;
      const toast = document.getElementById('centerToast');
      if (toast) {
        toast.classList.remove('show');
        toast.querySelector('.toast-message').textContent = '';
      }
    }

    // 显示中间提示
    function showCenterToast(icon, message) {
      const now = Date.now();

      // 防止过于频繁的toast调用（至少间隔100ms）
      if (now - lastToastTime < 100) {
        return;
      }
      lastToastTime = now;
      const generation = ++toastGeneration;
      const toast = document.getElementById('centerToast');
      const iconElement = toast.querySelector('.toast-icon');
      const messageElement = toast.querySelector('.toast-message');

      // 如果当前有toast正在显示，先清除之前的定时器
      if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
      }

      // 更新内容
      const feedbackIcon = icon === '✅' ? 'check' : icon === '❌' ? 'error' : icon === '⚠️' ? 'warning' : 'info';
      iconElement.innerHTML = dialogIcon(feedbackIcon);
      messageElement.textContent = message;

      // 如果toast已经显示，先隐藏再显示，确保动画效果
      if (isToastVisible) {
        toast.classList.remove('show');
        // 等待隐藏动画完成后再显示新的toast
        setTimeout(() => {
          if (generation !== toastGeneration) return;
          toast.classList.add('show');
          isToastVisible = true;

          // 设置新的定时器
          toastTimeout = setTimeout(() => {
            if (generation !== toastGeneration) return;
            toast.classList.remove('show');
            isToastVisible = false;
            toastTimeout = null;
          }, 2000);
        }, 125); // 等待隐藏动画的一半时间 (0.25s / 2)
      } else {
        // 直接显示toast
        toast.classList.add('show');
        isToastVisible = true;

        // 设置定时器
        toastTimeout = setTimeout(() => {
          if (generation !== toastGeneration) return;
          toast.classList.remove('show');
          isToastVisible = false;
          toastTimeout = null;
        }, 2000);
      }
    }

    // Keep a single active change so an older cleanup cannot interrupt a newer fade.
    let themeChange = null;

    // 应用主题（支持过渡动画）
    function applyTheme(theme, withTransition = false) {
      const root = document.documentElement;
      const nextTheme = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
      if (nextTheme === (themeChange ? themeChange.theme : root.getAttribute('data-theme'))) return;

      const animate = withTransition && !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Only visible cards and group headings need a fade. Offscreen transitions
      // otherwise keep style/paint work running throughout the transition.
      // Read bounds BEFORE removing existing transition styles. A layout read
      // between removal and reapplication would finish the old fade immediately,
      // making a rapid reversal jump to the previous target color first.
      const surfaces = animate ? Array.from(document.querySelectorAll('.secret-card, .service-group-header')).filter(surface => {
        const rect = surface.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
          rect.top < window.innerHeight && rect.left < window.innerWidth;
      }) : [];

      const previous = themeChange;
      themeChange = null;
      if (previous) {
        if (previous.timer !== null) clearTimeout(previous.timer);
        if (previous.frame !== null) cancelAnimationFrame(previous.frame);
        previous.surfaces.forEach(surface => surface.classList.remove('theme-viewport-transition'));
      }
      root.classList.remove('theme-transition', 'theme-instant');
      surfaces.forEach(surface => surface.classList.add('theme-viewport-transition'));
      const change = { theme: nextTheme, timer: null, frame: null, surfaces };
      themeChange = change;
      const finish = () => {
        if (themeChange !== change) return;
        themeChange = null;
        surfaces.forEach(surface => surface.classList.remove('theme-viewport-transition'));
        root.classList.remove('theme-transition', 'theme-instant');
      };
      const afterPaint = (callback) => {
        change.frame = requestAnimationFrame(() => {
          if (themeChange !== change) return;
          change.frame = requestAnimationFrame(() => {
            change.frame = null;
            if (themeChange === change) callback();
          });
        });
      };

      root.classList.add(animate ? 'theme-transition' : 'theme-instant');
      root.setAttribute('data-theme', nextTheme);
      if (typeof notifyThemeRuntimeEnvironment === 'function') notifyThemeRuntimeEnvironment('theme');
      // Start cleanup after styles have painted, with a small margin over 180ms.
      afterPaint(() => {
        if (animate) change.timer = setTimeout(finish, 220);
        else finish();
      });
    }

    function initTheme() {
      // 主题已在 head 内联脚本中应用，这里仅监听系统主题变化
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const currentTheme = localStorage.getItem('theme') || 'auto';
        if (currentTheme === 'auto') {
          applyTheme('auto', true);
        }
      });
    }

    // 模态框管理
    function hideQRModal() {
      hideModal('qrModal');
    }

    function syncSecretDialogTranslations() {
      const title = document.getElementById('modalTitle');
      const titleKey = editingId ? 'editSecretTitle' : 'addSecretTitle';
      title.setAttribute('data-i18n', titleKey);
      title.textContent = typeof t === 'function' ? t(titleKey) : (editingId ? '编辑密钥' : '添加新密钥');

      const submitBtn = document.getElementById('submitBtn');
      const submitKey = secretDialogSubmission ? 'saving' : (editingId ? 'update' : 'save');
      submitBtn.setAttribute('data-i18n', submitKey);
      submitBtn.textContent = typeof t === 'function' ? t(submitKey)
        : (secretDialogSubmission ? '保存中...' : (editingId ? '更新' : '保存'));
      syncSecretAdvancedInfo();
    }

    function syncSecretAdvancedInfo() {
      const advancedInfo = document.getElementById('advancedInfo');
      const typeSelect = document.getElementById('secretType');
      if (!advancedInfo || !typeSelect) return;
      const isHOTP = typeSelect.value === 'HOTP';
      const key = isHOTP ? 'secretAdvancedHotpHelp' : 'secretAdvancedHelp';
      advancedInfo.setAttribute('data-i18n', key);
      advancedInfo.textContent = typeof t === 'function' ? t(key)
        : (isHOTP ? 'HOTP使用计数器基准，每次生成后计数器自动递增'
          : '大多数2FA应用使用默认设置：TOTP、6位、30秒、SHA1算法');
    }

    // Options added by selectSecretFormValue() for the account being shown.
    function removeTemporarySecretFormOptions() {
      const form = document.getElementById('secretForm');
      if (!form) return;
      form.querySelectorAll('option[data-temporary-value]').forEach(option => option.remove());
    }

    function showSecretModal(onShow) {
      secretDialogCommandGuard = null;
      const modal = document.getElementById('secretModal');
      if (!modal) return;
      if (typeof trackModalClosed === 'function') trackModalClosed(modal);
      const generation = ++secretDialogGeneration;
      secretDialogSubmission = null;
      secretDialogQueuedOperationId = null;
      secretDialogStoredParams = null;
      removeTemporarySecretFormOptions();
      clearTimeout(secretDialogShowTimer);
      clearTimeout(secretDialogHideTimer);
      secretDialogShowTimer = null;
      secretDialogHideTimer = null;
      document.getElementById('submitBtn').disabled = false;
      modal.style.display = 'flex';
      if (!secretDialogOpen) disableBodyScroll();
      secretDialogOpen = true;
      onShow();
      syncSecretDialogTranslations();
      if (typeof trackModalOpen === 'function') trackModalOpen(modal);
      secretDialogShowTimer = setTimeout(() => {
        if (!secretDialogOpen || secretDialogGeneration !== generation) return;
        secretDialogShowTimer = null;
        modal.classList.add('show');
      }, 10);
    }

    function showAddModal(guard = {}) {
      showSecretModal(() => {
        secretDialogCommandGuard = guard;
        editingId = null;
        document.getElementById('secretForm').reset();
        document.getElementById('secretId').value = '';
      });
    }

    // 隐藏添加/编辑密钥模态框
    function hideSecretModal() {
      const modal = document.getElementById('secretModal');
      if (!modal || !secretDialogOpen) return;
      secretDialogCommandGuard = null;
      if (typeof trackModalClosed === 'function') trackModalClosed(modal);
      const generation = ++secretDialogGeneration;
      secretDialogOpen = false;
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = false;
      secretDialogSubmission = null;
      syncSecretDialogTranslations();
      clearTimeout(secretDialogShowTimer);
      clearTimeout(secretDialogHideTimer);
      secretDialogShowTimer = null;
      modal.classList.remove('show');
      secretDialogHideTimer = setTimeout(() => {
        if (secretDialogGeneration !== generation || secretDialogOpen) return;
        secretDialogHideTimer = null;
        modal.style.display = 'none';
        // Removed after the fade so the closing dialog never flips to a default.
        removeTemporarySecretFormOptions();
      }, 300);
      enableBodyScroll();
    }

    // 实用工具相关函数
    function showToolsModal() {
      showModal('toolsModal');
    }

    function hideToolsModal() {
      hideModal('toolsModal');
    }

    // 设置模态框相关函数
    function showSettingsModal() {
      showModal('settingsModal', () => {
        // 重置到第一个标签页
        switchSettingsTab('security');
      });
    }

    function hideSettingsModal() {
      hideModal('settingsModal');
    }

    // 折叠式菜单控制函数
    function toggleActionMenu() {
      if (actionPresentation === 'toolbar') return;
      // 刚刚结束拖拽时忽略本次点击，避免拖完立刻弹菜单
      if (fabDragJustHappened) return;
      const mainBtn = document.getElementById('mainActionBtn');
      const submenu = document.getElementById('actionSubmenu');
      const overlay = document.getElementById('menuOverlay');

      if (!mainBtn || !submenu || !overlay) return;
      const isActive = mainBtn.classList.contains('active');

      if (isActive) {
        closeActionMenu();
      } else {
        openActionMenu();
      }
    }

    function openActionMenu() {
      if (actionPresentation === 'toolbar') return;
      const mainBtn = document.getElementById('mainActionBtn');
      const submenu = document.getElementById('actionSubmenu');
      const overlay = document.getElementById('menuOverlay');

      if (!mainBtn || !submenu || !overlay) return;
      mainBtn.classList.add('active');
      mainBtn.setAttribute('aria-expanded', 'true');
      submenu.classList.add('show');
      overlay.classList.add('show');

      // 根据 FAB 当前位置调整子菜单展开方向，避免溢出视口
      updateSubmenuDirection();

      // 防止点击事件冒泡
      if (typeof event !== 'undefined' && event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
      }
    }

    function closeActionMenu() {
      const mainBtn = document.getElementById('mainActionBtn');
      const submenu = document.getElementById('actionSubmenu');
      const overlay = document.getElementById('menuOverlay');

      mainBtn?.classList.remove('active');
      mainBtn?.setAttribute('aria-expanded', 'false');
      submenu?.classList.remove('show');
      overlay?.classList.remove('show');
    }

    // 高级选项切换函数
    function toggleAdvancedOptions() {
      const checkbox = document.getElementById('showAdvanced');
      const options = document.getElementById('advancedOptions');

      if (checkbox.checked) {
        options.style.display = 'block';
        updateAdvancedOptionsForType(); // 根据当前类型调整UI
      } else {
        options.style.display = 'none';
      }
    }

    // 根据OTP类型更新高级选项UI
    function updateAdvancedOptionsForType() {
      const typeSelect = document.getElementById('secretType');
      const digitsGroup = document.getElementById('digitsGroup');
      const periodGroup = document.getElementById('periodGroup');
      const algorithmGroup = document.getElementById('algorithmGroup');
      const counterRow = document.getElementById('counterRow');
      const digitsSelect = document.getElementById('secretDigits');
      const periodSelect = document.getElementById('secretPeriod');
      const algorithmSelect = document.getElementById('secretAlgorithm');

      const selectedType = typeSelect.value;
      syncSecretAdvancedInfo();

      switch (selectedType) {
        case 'HOTP':
          // HOTP: 显示位数、算法、计数器，隐藏周期
          digitsGroup.style.display = 'block';
          periodGroup.style.display = 'none';
          algorithmGroup.style.display = 'block';
          counterRow.style.display = 'block';
          break;

        case 'TOTP':
        default:
          // TOTP: 显示位数、周期、算法，隐藏计数器
          digitsGroup.style.display = 'block';
          periodGroup.style.display = 'block';
          algorithmGroup.style.display = 'block';
          counterRow.style.display = 'none';
          break;
      }
    }

    // ESC键关闭菜单
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        closeActionMenu();
      }
    });

    // ========== FAB 拖拽：右下角"+"按钮可拖动并记住位置 ==========
    const FAB_POSITION_STORAGE_KEY = '2fa-fab-position';
    let fabDragJustHappened = false;
    let actionPresentation = 'floating';
    let disposeFABDrag = null;

    function setActionPresentation(mode) {
      const nextMode = mode === 'toolbar' ? 'toolbar' : 'floating';
      if (disposeFABDrag) { disposeFABDrag(); disposeFABDrag = null; }
      actionPresentation = nextMode;
      document.documentElement.setAttribute('data-actions-mode', nextMode);
      fabDragJustHappened = false;
      const fab = document.querySelector('.action-menu-float');
      const submenu = document.getElementById('actionSubmenu');
      if (fab) {
        fab.classList.remove('dragging');
        ['left','top','right','bottom'].forEach(name => fab.style.removeProperty(name));
      }
      if (submenu) ['left','top','right','bottom'].forEach(name => submenu.style.removeProperty(name));
      const initial = document.getElementById('fab-init-position');
      if (initial) initial.remove();
      if (document.getElementById('mainActionBtn') && submenu && document.getElementById('menuOverlay')) closeActionMenu();
      if (nextMode === 'floating') initFABDrag();
    }


    function loadFABPosition() {
      try {
        const raw = localStorage.getItem(FAB_POSITION_STORAGE_KEY);
        if (!raw) return null;
        const pos = JSON.parse(raw);
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) return pos;
      } catch (e) {}
      return null;
    }

    function saveFABPosition(x, y) {
      if (actionPresentation !== 'floating') return;
      try {
        localStorage.setItem(FAB_POSITION_STORAGE_KEY, JSON.stringify({ x: x, y: y }));
      } catch (e) {}
    }

    function clampFABPosition(x, y, w, h) {
      const margin = 8;
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const maxX = Math.max(margin, vw - w - margin);
      const maxY = Math.max(margin, vh - h - margin);
      const clampedX = Math.min(Math.max(x, margin), maxX);
      const clampedY = Math.min(Math.max(y, margin), maxY);
      const headerControls = document.querySelector('.search-action-row');
      if (headerControls) {
        const controlsRect = headerControls.getBoundingClientRect();
        const overlapsHeader =
          clampedX < controlsRect.right + margin &&
          clampedX + w > controlsRect.left - margin &&
          clampedY < controlsRect.bottom + margin &&
          clampedY + h > controlsRect.top - margin;
        if (overlapsHeader) {
          // Move only as far as needed to clear the controls; never reset to the bottom.
          const candidates = [
            { x: clampedX, y: controlsRect.bottom + margin },
            { x: clampedX, y: controlsRect.top - h - margin },
            { x: controlsRect.left - w - margin, y: clampedY },
            { x: controlsRect.right + margin, y: clampedY }
          ].filter(pos => pos.x >= margin && pos.x <= maxX && pos.y >= margin && pos.y <= maxY);
          if (candidates.length) {
            return candidates.reduce((nearest, pos) =>
              Math.hypot(pos.x - clampedX, pos.y - clampedY) < Math.hypot(nearest.x - clampedX, nearest.y - clampedY)
                ? pos : nearest
            );
          }
        }
      }
      return {
        x: clampedX,
        y: clampedY
      };
    }

    function applyFABPosition(x, y) {
      if (actionPresentation !== 'floating') return null;
      const fab = document.querySelector('.action-menu-float');
      if (!fab) return null;
      const w = fab.offsetWidth || 48;
      const h = fab.offsetHeight || 48;
      const c = clampFABPosition(x, y, w, h);
      fab.style.left = c.x + 'px';
      fab.style.top = c.y + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      return c;
    }

    // 根据 FAB 位置自适应子菜单展开方向（上/下、左/右）
    function updateSubmenuDirection() {
      if (actionPresentation !== 'floating') return;
      const fab = document.querySelector('.action-menu-float');
      const submenu = document.getElementById('actionSubmenu');
      if (!fab || !submenu) return;
      const fabRect = fab.getBoundingClientRect();
      const submenuW = submenu.offsetWidth || 180;
      const submenuH = submenu.offsetHeight || 350;
      const gap = 12;

      // 垂直方向：上方空间足够时向上展开（保持默认行为），否则向下
      if (fabRect.top >= submenuH + gap) {
        submenu.style.top = 'auto';
        submenu.style.bottom = (fabRect.height + gap) + 'px';
      } else {
        submenu.style.bottom = 'auto';
        submenu.style.top = (fabRect.height + gap) + 'px';
      }

      // 水平方向：默认右对齐；FAB 偏左导致溢出时改为左对齐
      if (fabRect.right >= submenuW + 4) {
        submenu.style.right = '0';
        submenu.style.left = 'auto';
      } else {
        submenu.style.right = 'auto';
        submenu.style.left = '0';
      }
    }

    function initFABDrag() {
      if (actionPresentation !== 'floating' || disposeFABDrag) return;
      const fab = document.querySelector('.action-menu-float');
      const btn = document.getElementById('mainActionBtn');
      if (!fab || !btn) return;

      // 移除预注入的 FOUC 防闪 style（用了 !important，会胜过下方的 inline style）
      const initStyle = document.getElementById('fab-init-position');
      if (initStyle && initStyle.parentNode) {
        initStyle.parentNode.removeChild(initStyle);
      }

      // 还原上次保存的位置
      const saved = loadFABPosition();
      if (saved) {
        const restored = applyFABPosition(saved.x, saved.y);
        if (restored && (restored.x !== saved.x || restored.y !== saved.y)) {
          saveFABPosition(restored.x, restored.y);
        }
      }

      let dragging = false;
      let moved = false;
      let startPx = 0;
      let startPy = 0;
      let startFx = 0;
      let startFy = 0;
      const DRAG_THRESHOLD = 5;
      let dragClickSuppressTimer = null;

      function getPoint(e) {
        if (e.touches && e.touches[0]) return e.touches[0];
        if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
        return e;
      }

      function onDown(e) {
        if (actionPresentation !== 'floating') return;
        if (e.button !== undefined && e.button !== 0) return;
        const p = getPoint(e);
        const rect = fab.getBoundingClientRect();
        dragging = true;
        moved = false;
        startPx = p.clientX;
        startPy = p.clientY;
        startFx = rect.left;
        startFy = rect.top;
        fab.classList.add('dragging');
      }

      function onMove(e) {
        if (!dragging || actionPresentation !== 'floating') return;
        const p = getPoint(e);
        const dx = p.clientX - startPx;
        const dy = p.clientY - startPy;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!moved) {
          moved = true;
          // 一旦判定为拖动，关闭已展开的菜单
          const submenu = document.getElementById('actionSubmenu');
          if (submenu && submenu.classList.contains('show')) {
            closeActionMenu();
          }
        }
        if (e.cancelable) e.preventDefault();
        applyFABPosition(startFx + dx, startFy + dy);
      }

      function onUp(e) {
        if (!dragging || actionPresentation !== 'floating') return;
        dragging = false;
        fab.classList.remove('dragging');
        if (moved) {
          const rect = fab.getBoundingClientRect();
          saveFABPosition(rect.left, rect.top);
          // 触摸结束时阻止浏览器合成 click，避免拖完立刻弹菜单
          if (e && e.cancelable && e.type && e.type.indexOf('touch') === 0) {
            e.preventDefault();
          }
          // 对鼠标场景：通过下方 capture-phase click 守卫拦截即将到来的 click
          fabDragJustHappened = true;
          // 500ms 兜底超时，避免标志位被卡住
          if (dragClickSuppressTimer) clearTimeout(dragClickSuppressTimer);
          dragClickSuppressTimer = setTimeout(function() {
            fabDragJustHappened = false;
            dragClickSuppressTimer = null;
          }, 500);
        }
      }

      btn.addEventListener('mousedown', onDown);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

      btn.addEventListener('touchstart', onDown, { passive: true });
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      document.addEventListener('touchcancel', onUp);

      // capture-phase 拦截拖拽结束后第一个 click，保证不会误触菜单
      function onDragClick(e) {
        if (!fabDragJustHappened || !fab.contains(e.target)) {
          return;
        }
        fabDragJustHappened = false;
        if (dragClickSuppressTimer) {
          clearTimeout(dragClickSuppressTimer);
          dragClickSuppressTimer = null;
        }
        e.stopPropagation();
        e.preventDefault();
      }
      document.addEventListener('click', onDragClick, true);

      // 窗口尺寸变化时重新约束位置，并把约束后的坐标写回 storage，
      // 保证下次进入显示的位置与上次可见状态一致
      function onFABResize() {
        if (actionPresentation !== 'floating') return;
        if (fab.style.left || fab.style.top) {
          const rect = fab.getBoundingClientRect();
          const next = applyFABPosition(rect.left, rect.top);
          if (next) saveFABPosition(next.x, next.y);
        }
      }
      window.addEventListener('resize', onFABResize);
      disposeFABDrag = function() {
        dragging = false;
        moved = false;
        fab.classList.remove('dragging');
        if (dragClickSuppressTimer) clearTimeout(dragClickSuppressTimer);
        btn.removeEventListener('mousedown', onDown);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        btn.removeEventListener('touchstart', onDown);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onUp);
        document.removeEventListener('click', onDragClick, true);
        window.removeEventListener('resize', onFABResize);
      };
    }
`;
}

/** Host-owned flows remain reachable when the account view uses a different DOM. */
export function getHostFlowsCode() {
	return `
    const themeHostDialogOwners = new Map();
    const themeHostChildren = new Map();
    const themeHostSuspensions = new WeakMap();
    function themeModalVisible(modal) {
      return Boolean(modal && modal.isConnected && !modal.hidden && !modal.inert && modal.style.display !== 'none'
        && (modal.style.display === 'flex' || modal.classList.contains('show')));
    }
    function focusThemeHostControl(target) {
      if (!target?.isConnected || target.disabled || target.closest?.('[hidden],[inert]')) return;
      const modal = target.closest?.('.modal');
      if (modal && (!themeModalVisible(modal) || modal.style.visibility === 'hidden')) return;
      target.focus?.({preventScroll:true});
    }
    // Keep the parent flow alive while its child is open. No delayed callback
    // can resurrect a dismissed parent or an invalidated application scope.
    function openThemeHostChild(parentId, childId, open, close, moduleName = 'tools') {
      const parent = document.getElementById(parentId);
      if (!themeModalVisible(parent)) return {status:'rejected',reason:'parent-unavailable'};
      const owner = themeHostDialogOwners.get(parentId);
      const parentSession = typeof modalSessions !== 'undefined' ? modalSessions.get(parent) : null;
      const session = typeof secretSessionGeneration === 'number' ? secretSessionGeneration : null;
      const trigger = parent.contains(document.activeElement) ? document.activeElement : parent.querySelector('.close-btn');
      const valid = () => themeModalVisible(parent)
        && (typeof modalSessions === 'undefined' || modalSessions.get(parent) === parentSession)
        && (session === null || secretSessionGeneration === session)
        && (!owner || (owner.active && owner.context.isCurrent() && themeHostDialogOwners.get(parentId) === owner));
      const pending = {};
      owner?.pendingChildren.add(pending);
      const invoke = () => {
        if (!valid()) return {status:'rejected',reason:'mount-invalidated'};
        if (themeHostChildren.has(childId) || themeModalVisible(document.getElementById(childId))) return {status:'rejected',reason:'dialog-busy'};
        const previousVisibility = parent.style.visibility;
        let observer, unsubscribe, ended = false;
        const child = document.getElementById(childId);
        const relation = {
          cancel() { finish(false); },
          owner
        };
        function finish(returning) {
          if (ended) return;
          ended = true; observer?.disconnect(); unsubscribe?.();
          if (themeHostChildren.get(childId) === relation) themeHostChildren.delete(childId);
          owner?.children.delete(relation);
          const ownsSuspension = themeHostSuspensions.get(parent) === relation;
          try {
            if (ownsSuspension && parent.style.visibility === 'hidden') {
              if (previousVisibility) parent.style.visibility = previousVisibility; else parent.style.removeProperty('visibility');
            }
            if (!returning && themeModalVisible(child)) close();
            if (ownsSuspension) {
              // Resolve inherited visibility with transitions still suspended.
              // Otherwise transition:all can leave the trigger unfocusable.
              const visibility = getComputedStyle(trigger?.isConnected ? trigger : parent).visibility;
              if (returning && valid() && visibility !== 'hidden' && visibility !== 'collapse') focusThemeHostControl(trigger);
            }
          } finally {
            // A focus/close handler can synchronously start a newer relation.
            if (themeHostSuspensions.get(parent) === relation) {
              themeHostSuspensions.delete(parent);
              parent.removeAttribute('data-theme-host-suspended');
            }
          }
        }
        try {
          open();
          if (!valid() || !themeModalVisible(child)) { finish(false); return {status:'rejected',reason:'dialog-unavailable'}; }
          themeHostChildren.set(childId, relation); owner?.children.add(relation);
          themeHostSuspensions.set(parent, relation);
          parent.setAttribute('data-theme-host-suspended', '');
          parent.style.visibility = 'hidden';
          const inspect = () => {
            if (!valid()) finish(false);
            else if (!themeModalVisible(child)) finish(true);
          };
          observer = new MutationObserver(records => {
            if (records.some(record => record.target === child || record.target === parent)) inspect();
          });
          observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['style','class','hidden','inert']});
          if (typeof accountStore !== 'undefined') unsubscribe = accountStore.subscribe(inspect);
          return {status:'opening'};
        } catch (error) { finish(false); throw error; }
      };
      const ready = () => { try { return invoke(); } finally { owner?.pendingChildren.delete(pending); } };
      if (moduleName && typeof loadModule === 'function') return loadModule(moduleName).then(ready, () => {
        owner?.pendingChildren.delete(pending);return {status:'rejected',reason:'module-unavailable'};
      });
      return ready();
    }
    function openThemeToolChild(childId, open, close) {
      if (themeModalVisible(document.getElementById('toolsModal'))) return openThemeHostChild('toolsModal',childId,open,close,null);
      return open();
    }
    function openToolsFromMenu(kind) {
      const entries = {
        'qr-decode':['qrDecodeModal',()=>{if(typeof ensureJsQR==='function')ensureJsQR().catch(()=>{});showQRDecodeModal();},()=>hideQRDecodeModal()],
        'qr-generate':['qrGenerateModal',()=>{if(typeof ensureQRCodeGen==='function')ensureQRCodeGen().catch(()=>{});showQRGenerateModal();},()=>hideQRGenerateModal()],
        base32:['base32Modal',()=>showBase32Modal(),()=>hideBase32Modal()],
        timestamp:['timestampModal',()=>showTimestampModal(),()=>hideTimestampModal()],
        'key-check':['keyCheckModal',()=>showKeyCheckModal(),()=>hideKeyCheckModal()],
        'key-generate':['keyGeneratorModal',()=>showKeyGeneratorModal(),()=>hideKeyGeneratorModal()]
      };
      const entry=entries[kind];
      return entry ? openThemeHostChild('toolsModal',...entry) : {status:'rejected',reason:'invalid-tool'};
    }
    function openThemeHostDialog(modalId, open, context, moduleName = null) {
      const invoke = () => {
        if (!context.isCurrent()) return { status: 'session-invalidated' };
        if (themeHostDialogOwners.get(modalId)?.active) return {status:'rejected',reason:'dialog-busy'};
        const owner = {active:true,context,children:new Set(),pendingChildren:new Set()};
        themeHostDialogOwners.set(modalId,owner);
        let observer = null;
        let opened = false;
        let settled = false;
        let finish;
        let ownedSecretGeneration = null;
        const originalSecretGeneration = typeof secretDialogGeneration === 'number' ? secretDialogGeneration : null;
        const captureSecretOwnership = () => { if (ownedSecretGeneration === null && modalId === 'secretModal' && typeof secretDialogGeneration === 'number' && secretDialogGeneration !== originalSecretGeneration && typeof secretDialogCommandGuard !== 'undefined' && secretDialogCommandGuard?.isCurrent === context.isCurrent) ownedSecretGeneration = secretDialogGeneration; };
        const invalidated = () => {
          const navigating = owner.children.size > 0 || owner.pendingChildren.size > 0;
          owner.active = false;
          for (const child of [...owner.children]) child.cancel();
          if (ownedSecretGeneration !== null && secretDialogGeneration === ownedSecretGeneration && typeof hideSecretModal === 'function') hideSecretModal();
          // An ordinary open settings form outlives its observer. Only a
          // still-owned aggregate transition is withdrawn with its child.
          if (navigating && ['settingsModal','toolsModal'].includes(modalId) && typeof hideModal === 'function') hideModal(modalId);
          finish({ status: 'rejected', reason: 'mount-invalidated' });
        };
        const closed = new Promise(resolve => { finish = result => {
          if (settled) return; settled = true; owner.active=false;
          owner.pendingChildren.clear();
          for (const child of [...owner.children]) child.cancel();
          if(themeHostDialogOwners.get(modalId)===owner)themeHostDialogOwners.delete(modalId);
          observer?.disconnect(); context.signal?.removeEventListener('abort', invalidated); resolve(result);
        }; });
        context.signal?.addEventListener('abort', invalidated, { once: true });
        const inspect = () => {
          const modal = document.getElementById(modalId);
          const visible = Boolean(modal && !modal.hidden && modal.style.display !== 'none' && (modal.style.display || modal.classList.contains('show')));
          if (visible) opened = true;
          else if (opened) finish({ status: 'closed' });
        };
        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(inspect);
          observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ['style', 'class', 'hidden'] });
        }
        let result;
        try { result = open(); captureSecretOwnership(); inspect(); } catch { finish({ status: 'rejected', reason: 'flow-failed' }); return { closed }; }
        Promise.resolve(result).then(value => {
          captureSecretOwnership();
          inspect();
          if (value && ['rejected', 'session-invalidated', 'cancelled'].includes(value.status)) finish(value);
          else if (!opened) finish({ status: 'rejected', reason: 'dialog-unavailable' });
          else if (!observer) finish({ status: 'unknown', reason: 'dialog-observer-unavailable' });
        }, () => finish({ status: 'rejected', reason: 'flow-failed' }));
        return { closed };
      };
      if (moduleName && typeof loadModule === 'function') return loadModule(moduleName).then(invoke);
      return invoke();
    }

    function openThemeHostPanel(panelId, title, context) {
      const panel = document.getElementById(panelId);
      if (!panel) return { status: 'rejected', reason: 'panel-unavailable' };
      const oldParent = panel.parentNode;
      const oldNext = panel.nextSibling;
      let modal = document.getElementById('themeHostStatusModal');
      if (!modal) {
        modal = document.createElement('div'); modal.id = 'themeHostStatusModal'; modal.className = 'modal'; modal.style.display = 'none';
        modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.dataset.part = 'dialog'; modal.dataset.dialogKind = 'passive';
        const content = document.createElement('div'); content.className = 'modal-content';
        const heading = document.createElement('h2'); heading.id = 'themeHostStatusTitle'; content.append(heading); modal.setAttribute('aria-labelledby', heading.id);
        const body = document.createElement('div'); body.id = 'themeHostStatusBody'; content.append(body);
        const close = document.createElement('button'); close.type = 'button'; close.className = 'btn btn-secondary'; close.setAttribute('data-dialog-dismiss',''); close.textContent = t('close'); close.onclick = () => hideModal('themeHostStatusModal'); content.append(close);
        modal.append(content); document.body.append(modal);
      }
      if (modal.style.display !== 'none') return { status: 'rejected', reason: 'dialog-busy' };
      document.getElementById('themeHostStatusTitle').textContent = title;
      const flow = openThemeHostDialog('themeHostStatusModal', () => {
        document.getElementById('themeHostStatusBody').append(panel);
        showModal('themeHostStatusModal');
      }, context);
      flow.closed?.then(() => {
        if (oldParent?.isConnected) oldParent.insertBefore(panel, oldNext?.parentNode === oldParent ? oldNext : null);
        else document.getElementById('hostThemePanels')?.append(panel);
      });
      return flow;
    }

    function getThemeHostHandlers() {
      const dialog = (id, open, context, moduleName) => openThemeHostDialog(id, open, context, moduleName);
      const tools = {
        'qr-decode': ['qrDecodeModal', () => showQRScanAndDecode()], 'qr-generate': ['qrGenerateModal', () => showQRGenerateTool()],
        'base32': ['base32Modal', () => showBase32Tool()], 'timestamp': ['timestampModal', () => showTimestampTool()],
        'key-check': ['keyCheckModal', () => showKeyCheckTool()], 'key-generate': ['keyGeneratorModal', () => showKeyGeneratorTool()]
      };
      const providers = { webdav: ['webdavModal', () => showWebdavTool()], s3: ['s3Modal', () => showS3Tool()], onedrive: ['oneDriveModal', () => showOneDriveTool()], gdrive: ['googleDriveModal', () => showGoogleDriveTool()] };
      return {
        login: (request, context) => dialog('loginModal', () => showLoginModal(), context),
        logout: async () => { const serverConfirmed = await logout(); return { status: serverConfirmed ? 'completed' : 'unknown', reason: serverConfirmed ? 'logout-server-confirmed' : 'logout-local-only' }; },
        'account-add': (request, context) => dialog('secretModal', () => showAddModal({ isCurrent: context.isCurrent }), context),
        'account-edit': (request, context) => dialog('secretModal', () => editSecret(request.account.id, { isCurrent: context.isCurrent }), context),
        'account-delete': (request, context) => deleteSecret(request.account.id, { isCurrent: context.isCurrent }),
        'account-qr': (request, context) => dialog('qrModal', () => showQRCode(request.account.id), context, 'qrcode'),
        'scan-import': (request, context) => dialog('qrScanModal', () => showQRScanner(), context, 'qrcode'),
        import: (request, context) => dialog('importModal', () => showImportModal(), context, 'import'),
        export: (request, context) => dialog('exportFormatModal', () => showExportFormatModal(), context, 'export'),
        backup: (request, context) => dialog('restoreModal', () => showRestoreModal(), context, 'backup'),
        tools: (request, context) => dialog('toolsModal', () => showToolsModal(), context),
        tool: (request, context) => { const [id, open] = tools[request.tool]; return dialog(id, open, context, 'tools'); },
        settings: (request, context) => dialog('settingsModal', () => { showSettingsModal(); switchSettingsTab(request.section); }, context),
        'sync-provider': (request, context) => { const [id, open] = providers[request.provider]; return dialog(id, open, context, 'tools'); },
        appearance: (request, context) => dialog('appearanceModal', () => window.showAppearanceEditor(), context, 'appearance'),
        recovery: () => { const result = getThemeRuntime().sdk.lifecycle.requestReload('recovery'); return result; },
        'hidden-accounts': (request, context) => { hiddenSecretsExpanded = true; renderHiddenSecretsNotice(); return openThemeHostPanel('hiddenSecrets', t('pageHiddenAccounts'), context); },
        'offline-queue': (request, context) => { offlineQueueExpanded = true; renderOfflineQueue(); void refreshOfflineQueue(); return openThemeHostPanel('offlineQueue', t('offlineQueueView'), context); },
        'offline-queue-edit': (request, context) => dialog('secretModal', () => openOfflineQueueEditor(request.operationId, { isCurrent: context.isCurrent }), context),
        'offline-queue-retry': (request, context) => changeOfflineQueueOperation('OFFLINE_QUEUE_RETRY', request.operationId, { isCurrent: context.isCurrent }),
        'offline-queue-cancel': (request, context) => changeOfflineQueueOperation('OFFLINE_QUEUE_CANCEL', request.operationId, { isCurrent: context.isCurrent }),
        'offline-queue-status-retry': () => refreshOfflineQueue(),
        extension: (request, context) => dialog('browserExtensionModal', () => showBrowserExtensionModal(), context),
        'pwa-install': () => triggerPwaInstallFromSettings(),
        'quick-otp': () => { window.location.assign('/otp'); return { status: 'completed' }; }
      };
    }
  `;
}
