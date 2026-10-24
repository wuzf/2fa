/**
 * 搜索和排序模块
 * 包含搜索和排序密钥的功能
 */

import { getSearchFilterCode } from './searchFilter.js';
import { createAccountViewState } from '../runtime/accountViewState.js';
import { serializeBrowserFunction } from './browserSource.js';

/**
 * 获取搜索和排序相关代码
 * @returns {string} 搜索 JavaScript 代码
 */
export function getSearchCode() {
	return `    // ========== 搜索和排序模块 ==========

    ${getSearchFilterCode()}

    // 排序和显示模式相关变量
    let currentSortType = 'oldest-first';
    let currentFlatSortType = 'oldest-first';
    let currentGroupedItemSortType = 'oldest-first';
    let currentViewMode = 'grouped';
    let defaultViewMode = 'remember';
    let currentGroupSortType = 'name-asc';
    const VALID_VIEW_MODES = ['grouped', 'flat'];
    const VALID_GROUP_SORT_TYPES = ['name-asc', 'name-desc'];
    const VALID_SORT_TYPES = ['oldest-first', 'newest-first', 'name-asc', 'name-desc', 'account-asc', 'account-desc'];
    const VALID_GROUPED_ITEM_SORT_TYPES = ['oldest-first', 'newest-first', 'account-asc', 'account-desc'];
    const SEARCH_FILTER_DEBOUNCE_MS = 130;
    let searchFilterTimer = null;
    let sortMenuLayoutFrame = null;
    let sortMenuResizeObserver = null;
    let accountViewState = null;
    const createAccountViewState = ${serializeBrowserFunction(createAccountViewState)};

    function getAccountViewState() {
      if (!accountViewState) {
        accountViewState = createAccountViewState({
          filterAccountsByQuery: (...args) => filterAccountsByQuery(...args),
          groupSecretsByServiceFamily: (...args) => typeof groupSecretsByServiceFamily === 'function' ? groupSecretsByServiceFamily(...args) : [],
          compareStrings: (a, b) => typeof compareI18nStrings === 'function' ? compareI18nStrings(a, b) : a.localeCompare(b, 'zh-CN'),
          persist: patch => {
            const keys = { mode: '2fa-view-mode', groupSort: '2fa-group-sort-preference', flatSort: '2fa-flat-sort-preference', groupedItemSort: '2fa-group-item-sort-preference' };
            for (const [key, value] of Object.entries(patch)) if (keys[key]) localStorage.setItem(keys[key], value);
          },
          onError: error => console.warn('Account view preference failed', error)
        });
        syncAccountViewPreferences();
        accountViewState.subscribe(() => {
          const state = accountViewState.getState();
          currentViewMode = state.mode; currentGroupSortType = state.groupSort;
          currentFlatSortType = state.flatSort; currentGroupedItemSortType = state.groupedItemSort;
          currentSortType = state.mode === 'grouped' ? state.groupedItemSort : state.flatSort;
          currentSearchQuery = state.query;
        });
      }
      return accountViewState;
    }

    function syncAccountViewPreferences() {
      if (accountViewState) accountViewState.restore({ query: typeof currentSearchQuery === 'string' ? currentSearchQuery : '', mode: currentViewMode, groupSort: currentGroupSortType, flatSort: currentFlatSortType, groupedItemSort: currentGroupedItemSortType, serviceFilter: accountViewState.getState().serviceFilter });
    }

    function updateOfficialViewControls(selection) {
      const input = document.getElementById('searchInput');
      if (input && input.value.trim().toLowerCase() !== selection.query) input.value = selection.query;
      const clear = document.getElementById('searchClear');
      if (clear) clear.style.display = selection.query ? 'block' : 'none';
      const stats = document.getElementById('searchStats');
      if (stats) {
        stats.textContent = selection.serviceFilter ? t('searchFoundCount', { found: selection.found, total: selection.total }) : !selection.query ? '' : selection.found === 0 ? t('searchNoMatch') : selection.found === selection.total ? t('searchShowAll', { count: selection.total }) : t('searchFoundCount', { found: selection.found, total: selection.total });
        stats.style.color = selection.serviceFilter ? 'var(--2fa-muted)' : selection.found === 0 ? '#e74c3c' : selection.found === selection.total ? '#27ae60' : '#3498db';
      }
      currentViewMode = selection.mode; currentGroupSortType = selection.groupSort;
      currentFlatSortType = selection.flatSort; currentGroupedItemSortType = selection.groupedItemSort;
      markActiveViewMode(selection.mode); markActiveGroupSortOption(selection.groupSort); syncSortMenuForViewMode();
    }

    function normalizeViewMode(value) {
      return VALID_VIEW_MODES.includes(value) ? value : 'grouped';
    }

    function normalizeDefaultViewMode(value) {
      return VALID_VIEW_MODES.includes(value) ? value : 'remember';
    }

    function getDefaultViewModePreference() {
      return defaultViewMode;
    }

    function setDefaultViewModePreference(value) {
      defaultViewMode = normalizeDefaultViewMode(value);
      try {
        localStorage.setItem('2fa-default-view-mode', defaultViewMode);
      } catch (e) {
        console.warn('⚠️ 保存默认显示方式失败:', e);
      }
      return defaultViewMode;
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
        defaultViewMode = normalizeDefaultViewMode(localStorage.getItem('2fa-default-view-mode'));
        currentViewMode = defaultViewMode === 'remember'
          ? normalizeViewMode(localStorage.getItem('2fa-view-mode'))
          : defaultViewMode;
      } catch (e) {
        defaultViewMode = 'remember';
        currentViewMode = 'grouped';
        console.warn('⚠️ 恢复显示模式失败:', e);
      }

      markActiveViewMode(currentViewMode);
      syncSortMenuForViewMode();
      syncAccountViewPreferences();
    }

    function restoreGroupSortPreference() {
      try {
        currentGroupSortType = normalizeGroupSortType(localStorage.getItem('2fa-group-sort-preference'));
      } catch (e) {
        currentGroupSortType = 'name-asc';
        console.warn('⚠️ 恢复聚合分组排序失败:', e);
      }

      markActiveGroupSortOption(currentGroupSortType);
      syncAccountViewPreferences();
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
        const labelKey = isGrouped ? 'sortModeLabel' : 'sortModeFlatLabel';
        sortModeLabel.setAttribute('data-i18n', labelKey);
        sortModeLabel.textContent = typeof t === 'function' ? t(labelKey) : (isGrouped ? '组内排序' : '列表排序');
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
      getAccountViewState().setMode(currentViewMode);
      markActiveViewMode(currentViewMode);
      saveViewModePreference(currentViewMode);
      syncSortMenuForViewMode();

      await renderFilteredSecrets();
    }

    async function selectGroupSort(value) {
      currentGroupSortType = normalizeGroupSortType(value);
      getAccountViewState().setSort({ groupSort: currentGroupSortType });
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
        syncAccountViewPreferences();
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
        const searchSection = document.querySelector('.search-section');
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
      getAccountViewState().setQuery(trimmedQuery);

      const searchClear = document.getElementById('searchClear');
      const searchStats = document.getElementById('searchStats');

      if (searchClear && trimmedQuery) {
        searchClear.style.display = 'block';
      } else if (searchClear) {
        searchClear.style.display = 'none';
      }

      if (!trimmedQuery) {
        filteredSecrets = filterAccountsByQuery(secrets, trimmedQuery);
        if (searchStats) searchStats.textContent = '';
        await renderFilteredSecrets();
        return;
      }

      filteredSecrets = filterAccountsByQuery(secrets, trimmedQuery);

      const totalCount = secrets.length;
      const foundCount = filteredSecrets.length;

      if (searchStats && foundCount === 0) {
        searchStats.textContent = (typeof t === 'function' ? t('searchNoMatch') : null) || '未找到匹配的密钥';
        searchStats.style.color = '#e74c3c';
      } else if (searchStats && foundCount === totalCount) {
        searchStats.textContent = (typeof t === 'function' ? t('searchShowAll', { count: totalCount }) : null) || ('显示所有 ' + totalCount + ' 个密钥');
        searchStats.style.color = '#27ae60';
      } else if (searchStats) {
        searchStats.textContent = (typeof t === 'function' ? t('searchFoundCount', { found: foundCount, total: totalCount }) : null) || ('找到 ' + foundCount + ' 个匹配密钥（共 ' + totalCount + ' 个）');
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
      const input = document.getElementById('searchInput');
      if (input) input.value = '';
      filterSecrets('');
      input?.focus();
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
      getAccountViewState().setSort(currentViewMode === 'grouped' ? { groupedItemSort: currentSortType } : { flatSort: currentSortType });
      
      await renderFilteredSecrets();
    }

    // 排序密钥
    function sortSecrets(secretsToSort, sortType) {
      if (!secretsToSort || !secretsToSort.length) return secretsToSort;
      return getAccountViewState().sort(secretsToSort, sortType);
    }
`;
}
