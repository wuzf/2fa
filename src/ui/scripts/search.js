/**
 * 搜索和排序模块
 * 包含搜索和排序密钥的功能
 */

/**
 * 获取搜索和排序相关代码
 * @returns {string} 搜索 JavaScript 代码
 */
export function getSearchCode() {
	return `    // ========== 搜索和排序模块 ==========

    // 排序和显示模式相关变量
    let currentSortType = 'oldest-first';
    let currentFlatSortType = 'oldest-first';
    let currentGroupedItemSortType = 'oldest-first';
    let currentViewMode = 'grouped';
    let currentGroupSortType = 'name-asc';
    const VALID_VIEW_MODES = ['grouped', 'flat'];
    const VALID_GROUP_SORT_TYPES = ['name-asc', 'name-desc'];
    const VALID_SORT_TYPES = ['oldest-first', 'newest-first', 'name-asc', 'name-desc', 'account-asc', 'account-desc'];
    const VALID_GROUPED_ITEM_SORT_TYPES = ['oldest-first', 'newest-first', 'account-asc', 'account-desc'];
    const SEARCH_FILTER_DEBOUNCE_MS = 130;
    let searchFilterTimer = null;
    let sortMenuLayoutFrame = null;
    let sortMenuResizeObserver = null;

    function normalizeViewMode(value) {
      return VALID_VIEW_MODES.includes(value) ? value : 'grouped';
    }

    function normalizeGroupSortType(value) {
      return VALID_GROUP_SORT_TYPES.includes(value) ? value : 'name-asc';
    }

    function normalizeSortType(value) {
      return VALID_SORT_TYPES.includes(value) ? value : 'oldest-first';
    }

    function normalizeGroupedItemSortType(value) {
      return VALID_GROUPED_ITEM_SORT_TYPES.includes(value) ? value : 'oldest-first';
    }

    function restoreViewModePreference() {
      try {
        currentViewMode = normalizeViewMode(localStorage.getItem('2fa-view-mode'));
      } catch (e) {
        currentViewMode = 'grouped';
        console.warn('⚠️ 恢复显示模式失败:', e);
      }

      markActiveViewMode(currentViewMode);
      syncSortMenuForViewMode();
    }

    function restoreGroupSortPreference() {
      try {
        currentGroupSortType = normalizeGroupSortType(localStorage.getItem('2fa-group-sort-preference'));
      } catch (e) {
        currentGroupSortType = 'name-asc';
        console.warn('⚠️ 恢复聚合分组排序失败:', e);
      }

      markActiveGroupSortOption(currentGroupSortType);
    }

    function saveViewModePreference(viewMode) {
      try {
        localStorage.setItem('2fa-view-mode', viewMode);
      } catch (e) {
        console.warn('⚠️ 保存显示模式失败:', e);
      }
    }

    function saveGroupSortPreference(sortType) {
      try {
        localStorage.setItem('2fa-group-sort-preference', sortType);
      } catch (e) {
        console.warn('⚠️ 保存聚合分组排序失败:', e);
      }
    }

    function markActiveViewMode(value) {
      document.querySelectorAll('.view-mode-option').forEach(option => {
        const match = option.dataset.viewMode === value;
        option.classList.toggle('active', match);
        option.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }

    function markActiveGroupSortOption(value) {
      document.querySelectorAll('.group-sort-option').forEach(option => {
        const match = option.dataset.groupSort === value;
        option.classList.toggle('active', match);
        option.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }

    function syncSortMenuForViewMode() {
      const isGrouped = currentViewMode === 'grouped';
      document.querySelectorAll('.group-sort-only').forEach(element => {
        element.hidden = !isGrouped;
      });
      document.querySelectorAll('.flat-sort-only').forEach(element => {
        element.hidden = isGrouped;
      });

      syncCurrentSortTypeForViewMode();

      const sortModeLabel = document.getElementById('sortModeLabel');
      if (sortModeLabel) {
        sortModeLabel.textContent = isGrouped ? '组内排序' : '列表排序';
      }
      scheduleSortMenuPlacementUpdate();
    }

    function syncCurrentSortTypeForViewMode() {
      currentSortType = currentViewMode === 'grouped' ? currentGroupedItemSortType : currentFlatSortType;
      const sortSelect = document.getElementById('sortSelect');
      if (sortSelect) sortSelect.value = currentSortType;
      markActiveSortOption(currentSortType);
    }

    function closeSortDropdown(restoreFocus = false) {
      const dropdown = document.getElementById('sortDropdown');
      if (!dropdown) return;

      dropdown.removeAttribute('open');
      if (restoreFocus) {
        const trigger = typeof dropdown.querySelector === 'function'
          ? dropdown.querySelector('.sort-trigger')
          : null;
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
      }
    }

    function calculateSortMenuPlacement(triggerRect, viewportTop, viewportHeight) {
      const viewportBottom = viewportTop + viewportHeight;
      const gapAndMargin = 14;
      const spaceBelow = Math.max(0, viewportBottom - triggerRect.bottom - gapAndMargin);
      const spaceAbove = Math.max(0, triggerRect.top - viewportTop - gapAndMargin);
      const opensUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
      return {
        opensUpward,
        maxHeight: Math.max(48, Math.floor(opensUpward ? spaceAbove : spaceBelow))
      };
    }

    function updateSortMenuPlacement() {
      if (typeof window === 'undefined') return;
      const dropdown = document.getElementById('sortDropdown');
      if (!dropdown || !dropdown.hasAttribute('open')) return;

      const trigger = dropdown.querySelector('.sort-trigger');
      const menu = dropdown.querySelector('.sort-menu');
      if (!trigger || !menu) return;

      const viewport = window.visualViewport;
      const viewportTop = viewport ? viewport.offsetTop : 0;
      const viewportHeight = viewport ? viewport.height : window.innerHeight;
      const placement = calculateSortMenuPlacement(trigger.getBoundingClientRect(), viewportTop, viewportHeight);
      menu.classList.toggle('opens-upward', placement.opensUpward);
      menu.style.maxHeight = placement.maxHeight + 'px';
    }

    function scheduleSortMenuPlacementUpdate() {
      if (typeof window === 'undefined') return;
      if (sortMenuLayoutFrame !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(sortMenuLayoutFrame);
      }

      if (typeof requestAnimationFrame === 'function') {
        sortMenuLayoutFrame = requestAnimationFrame(() => {
          sortMenuLayoutFrame = null;
          updateSortMenuPlacement();
        });
      } else {
        updateSortMenuPlacement();
      }
    }

    async function selectViewMode(value) {
      currentViewMode = normalizeViewMode(value);
      markActiveViewMode(currentViewMode);
      saveViewModePreference(currentViewMode);
      syncSortMenuForViewMode();

      await renderFilteredSecrets();
    }

    async function selectGroupSort(value) {
      currentGroupSortType = normalizeGroupSortType(value);
      markActiveGroupSortOption(currentGroupSortType);
      saveGroupSortPreference(currentGroupSortType);
      await renderFilteredSecrets();
    }

    // 从 localStorage 恢复排序选择
    function restoreSortPreference() {
      let legacySort = null;
      let savedFlatSort = null;
      let savedGroupedSort = null;

      try {
        legacySort = localStorage.getItem('2fa-sort-preference');
        savedFlatSort = localStorage.getItem('2fa-flat-sort-preference');
        savedGroupedSort = localStorage.getItem('2fa-group-item-sort-preference');
        currentFlatSortType = normalizeSortType(savedFlatSort !== null ? savedFlatSort : legacySort);
        currentGroupedItemSortType = normalizeGroupedItemSortType(
          savedGroupedSort !== null ? savedGroupedSort : legacySort
        );
        syncCurrentSortTypeForViewMode();
        if (savedFlatSort || savedGroupedSort || legacySort) {
          console.log('✅ 已恢复排序设置:', {
            flat: currentFlatSortType,
            grouped: currentGroupedItemSortType
          });
        }
      } catch (e) {
        currentFlatSortType = 'oldest-first';
        currentGroupedItemSortType = 'oldest-first';
        currentSortType = 'oldest-first';
        syncCurrentSortTypeForViewMode();
        console.warn('⚠️  恢复排序设置失败:', e);
        return;
      }

      if (legacySort !== null && (savedFlatSort === null || savedGroupedSort === null)) {
        try {
          if (savedFlatSort === null) {
            localStorage.setItem('2fa-flat-sort-preference', currentFlatSortType);
          }
          if (savedGroupedSort === null) {
            localStorage.setItem('2fa-group-item-sort-preference', currentGroupedItemSortType);
          }
        } catch (e) {
          console.warn('⚠️ 迁移旧排序设置失败:', e);
        }
      }
    }

    // 同步 popover 中的 active 高亮
    function markActiveSortOption(value) {
      document.querySelectorAll('.sort-option').forEach(o => {
        const match = o.dataset.sort === value;
        o.classList.toggle('active', match);
        o.setAttribute('aria-pressed', match ? 'true' : 'false');
      });
    }

    // popover 选择事件：写入隐藏 select 并触发排序
    function selectSort(value) {
      const normalizedValue = currentViewMode === 'grouped' ? normalizeGroupedItemSortType(value) : normalizeSortType(value);
      const sortSelect = document.getElementById('sortSelect');
      if (sortSelect) sortSelect.value = normalizedValue;
      markActiveSortOption(normalizedValue);
      applySorting();
    }

    // 点击 popover 外或按 Escape 关闭
    function initSortDropdownOutsideClose() {
      const initializedDropdown = document.getElementById('sortDropdown');
      if (initializedDropdown) {
        initializedDropdown.addEventListener('toggle', scheduleSortMenuPlacementUpdate);
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', scheduleSortMenuPlacementUpdate);
        window.addEventListener('scroll', scheduleSortMenuPlacementUpdate, { passive: true });
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', scheduleSortMenuPlacementUpdate);
          window.visualViewport.addEventListener('scroll', scheduleSortMenuPlacementUpdate);
        }
      }
      if (typeof ResizeObserver === 'function') {
        sortMenuResizeObserver = new ResizeObserver(scheduleSortMenuPlacementUpdate);
        const clockWarning = document.getElementById('clockWarning');
        const searchSection = document.querySelector('.search-section');
        if (clockWarning) sortMenuResizeObserver.observe(clockWarning);
        if (searchSection) sortMenuResizeObserver.observe(searchSection);
      }

      document.addEventListener('click', (e) => {
        const dropdown = document.getElementById('sortDropdown');
        if (!dropdown || !dropdown.hasAttribute('open')) return;
        if (!dropdown.contains(e.target)) {
          closeSortDropdown(false);
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const dropdown = document.getElementById('sortDropdown');
        if (dropdown && dropdown.hasAttribute('open')) {
          closeSortDropdown(true);
        }
      });
    }

    // 保存排序选择到 localStorage
    function saveSortPreference(sortType) {
      try {
        if (currentViewMode === 'grouped') {
          currentGroupedItemSortType = normalizeGroupedItemSortType(sortType);
          localStorage.setItem('2fa-group-item-sort-preference', currentGroupedItemSortType);
        } else {
          currentFlatSortType = normalizeSortType(sortType);
          localStorage.setItem('2fa-flat-sort-preference', currentFlatSortType);
        }
        console.log('💾 已保存排序设置:', sortType);
      } catch (e) {
        console.warn('⚠️  保存排序设置失败:', e);
      }
    }

    // 搜索过滤功能
    function scheduleSecretFilter(query) {
      if (searchFilterTimer !== null) {
        clearTimeout(searchFilterTimer);
        searchFilterTimer = null;
      }

      if (!String(query || '').trim()) {
        filterSecrets('');
        return;
      }

      searchFilterTimer = setTimeout(() => {
        searchFilterTimer = null;
        filterSecrets(query);
      }, SEARCH_FILTER_DEBOUNCE_MS);
    }

    async function filterSecrets(query) {
      if (searchFilterTimer !== null) {
        clearTimeout(searchFilterTimer);
        searchFilterTimer = null;
      }

      const trimmedQuery = query.trim().toLowerCase();
      currentSearchQuery = trimmedQuery;

      const searchClear = document.getElementById('searchClear');
      const searchStats = document.getElementById('searchStats');

      if (trimmedQuery) {
        searchClear.style.display = 'block';
      } else {
        searchClear.style.display = 'none';
      }

      if (!trimmedQuery) {
        filteredSecrets = [...secrets];
        searchStats.textContent = '';
        await renderFilteredSecrets();
        return;
      }

      const { familyMetadata, identityBySecret } = getServiceFamilyMetadata(secrets);
      const searchableFamilyNames = new Map();
      familyMetadata.forEach((metadata, key) => {
        if (metadata.totalCount >= 2) {
          searchableFamilyNames.set(key, resolveServiceGroupName(metadata).toLowerCase());
        } else {
          searchableFamilyNames.set(key, '其他服务');
        }
      });

      filteredSecrets = secrets.filter(secret => {
        const serviceName = secret.name.toLowerCase();
        const accountName = (secret.account || '').toLowerCase();
        const identity = secret && typeof secret === 'object' ? identityBySecret.get(secret) : null;
        const familyName = identity ? searchableFamilyNames.get(identity.key) || '' : '';
        return serviceName.includes(trimmedQuery) || accountName.includes(trimmedQuery) || familyName.includes(trimmedQuery);
      });

      const totalCount = secrets.length;
      const foundCount = filteredSecrets.length;

      if (foundCount === 0) {
        searchStats.textContent = '未找到匹配的密钥';
        searchStats.style.color = '#e74c3c';
      } else if (foundCount === totalCount) {
        searchStats.textContent = '显示所有 ' + totalCount + ' 个密钥';
        searchStats.style.color = '#27ae60';
      } else {
        searchStats.textContent = '找到 ' + foundCount + ' 个匹配密钥（共 ' + totalCount + ' 个）';
        searchStats.style.color = '#3498db';
      }
      await renderFilteredSecrets();
    }

    // 清除搜索
    function clearSearch() {
      if (searchFilterTimer !== null) {
        clearTimeout(searchFilterTimer);
        searchFilterTimer = null;
      }
      document.getElementById('searchInput').value = '';
      filterSecrets('');
      document.getElementById('searchInput').focus();
    }

    // 应用排序
    async function applySorting() {
      const sortSelect = document.getElementById('sortSelect');
      currentSortType = currentViewMode === 'grouped'
        ? normalizeGroupedItemSortType(sortSelect.value)
        : normalizeSortType(sortSelect.value);
      sortSelect.value = currentSortType;
      
      // 保存用户的排序选择
      saveSortPreference(currentSortType);
      
      await renderFilteredSecrets();
    }

    // 排序密钥
    function sortSecrets(secretsToSort, sortType) {
      if (!secretsToSort || secretsToSort.length === 0) {
        return secretsToSort;
      }

      const sortedSecrets = [...secretsToSort];

      switch (sortType) {
        case 'name-asc':
          return sortedSecrets.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameA.localeCompare(nameB, 'zh-CN');
          });

        case 'name-desc':
          return sortedSecrets.sort((a, b) => {
            const nameA = (a.name || '').toLowerCase();
            const nameB = (b.name || '').toLowerCase();
            return nameB.localeCompare(nameA, 'zh-CN');
          });

        case 'account-asc':
          return sortedSecrets.sort((a, b) => {
            const accountA = (a.account || '').toLowerCase();
            const accountB = (b.account || '').toLowerCase();
            return accountA.localeCompare(accountB, 'zh-CN');
          });

        case 'account-desc':
          return sortedSecrets.sort((a, b) => {
            const accountA = (a.account || '').toLowerCase();
            const accountB = (b.account || '').toLowerCase();
            return accountB.localeCompare(accountA, 'zh-CN');
          });

        case 'oldest-first':
          // 最早添加：按添加顺序（保持原有顺序）
          return sortedSecrets;

        case 'newest-first':
          // 最晚添加：按添加顺序倒序
          return sortedSecrets.reverse();

        case 'default':
        default:
          // 兼容旧版本，默认使用最早添加
          return sortedSecrets;
      }
    }
`;
}
