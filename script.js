/**
 * 草本知行 - UI 交互逻辑
 * 核心：2.5D 药柜互动、网格卡片渲染、首页搜索/快捷标签联动、流程化表单逻辑
 */

let currentHerbId = null;
let currentStep = 1;
let symptomAnswers = {};
let detailReturnPage = 'search'; // 详情页返回时跳回的页面（home / search）
let currentSearchQuery = '';
let currentSearchCategory = '全部';
let pendingSymptomDescription = '';
const suggestionStates = {
    home: { items: [], activeIndex: -1 },
    library: { items: [], activeIndex: -1 }
};
let searchScrollPosition = 0;
let currentSearchResultIds = [];

document.addEventListener('DOMContentLoaded', () => {
    initCabinet();
    renderHerbGrid(HERB_DATA, { grouped: true });
    renderLibFilters();
    showHome();

    const homeSearchInput = document.getElementById('home-search-input');
    const librarySearchInput = document.getElementById('lib-search-input');

    homeSearchInput.addEventListener('input', event => handleSuggestionInput('home', event.target.value));
    homeSearchInput.addEventListener('keydown', event => handleSuggestionKeydown('home', event));
    homeSearchInput.addEventListener('focus', () => {
        if (homeSearchInput.value.trim()) updateSuggestions('home', homeSearchInput.value);
    });
    document.querySelector('.home-search-container').addEventListener('focusout', event => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions('home');
    });

    librarySearchInput.addEventListener('input', event => {
        clearFilterActive();
        filterHerbGrid(event.target.value);
        handleSuggestionInput('library', event.target.value);
    });
    librarySearchInput.addEventListener('keydown', event => handleSuggestionKeydown('library', event));
    librarySearchInput.addEventListener('focus', () => {
        if (librarySearchInput.value.trim()) updateSuggestions('library', librarySearchInput.value);
    });
    document.querySelector('.library-search-container').addEventListener('focusout', event => {
        if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions('library');
    });

    // Task 3.1：点击药柜与卡片以外的空白处，收起抽屉并隐藏今日一学卡片
    document.addEventListener('click', (e) => {
        const t = e.target;
        if (t.closest && (t.closest('.medicine-cabinet') || t.closest('#daily-card'))) return;
        document.querySelectorAll('.cabinet-drawer.open').forEach(d => d.classList.remove('open'));
        closeDailyCard();
    });
});

// --- 药柜系统 ---
function initCabinet() {
    const grid = document.getElementById('cabinet-grid');
    grid.innerHTML = '';

    CABINET_DRAWERS.forEach((name, index) => {
        const drawer = document.createElement('div');
        drawer.className = 'cabinet-drawer';
        drawer.dataset.name = name;

        // 默认金银花打开（页面加载即展开，右侧不空旷）
        if (name === "金银花") {
            drawer.classList.add('open');
            showDailyCard(name);
        }

        drawer.innerHTML = `
            <div class="drawer-box">
                <div class="drawer-face drawer-front">
                    <div class="drawer-label">${name}</div>
                    <div class="drawer-ring"></div>
                </div>
                <div class="drawer-face drawer-back"></div>
                <div class="drawer-face drawer-left"></div>
                <div class="drawer-face drawer-right"></div>
                <div class="drawer-face drawer-top"></div>
                <div class="drawer-face drawer-bottom"></div>
            </div>
        `;

        // Task 3.1：点击抽屉拉出；再次点击同一抽屉收起
        drawer.onclick = () => {
            if (drawer.classList.contains('open')) {
                drawer.classList.remove('open');
                closeDailyCard();
                return;
            }
            document.querySelectorAll('.cabinet-drawer').forEach(d => d.classList.remove('open'));
            drawer.classList.add('open');
            showDailyCard(name);
        };

        grid.appendChild(drawer);
    });
}

function showDailyCard(name) {
    const card = document.getElementById('daily-card');
    const title = document.getElementById('daily-name');
    const desc = document.getElementById('daily-desc');

    const herbId = CABINET_DATA[name];
    const herb = HERB_DATA.find(h => h.id === herbId);

    if (herb) {
        title.textContent = herb.name;
        desc.innerHTML = `关键词：${herb.tags.join('、')}<br>${herb.oneLiner}`;
        currentHerbId = herb.id;
    } else {
        title.textContent = name;
        desc.textContent = "暂无详细资料，正在努力整理中...";
        currentHerbId = null;
    }

    card.classList.add('visible');
    // 卡片显示时隐藏占位提示
    const ph = document.getElementById('daily-placeholder');
    if (ph) ph.classList.add('hidden');
}

// Task 3.1：收起今日一学卡片
function closeDailyCard() {
    const card = document.getElementById('daily-card');
    if (card) card.classList.remove('visible');
    // 卡片收起时显示占位提示，避免右侧空旷
    const ph = document.getElementById('daily-placeholder');
    if (ph) ph.classList.remove('hidden');
}

// Task 2.2：今日一学卡片“查看详情”→ 打开全屏详情页（方案 B）
function openDrawerDetail() {
    if (currentHerbId) {
        openDetail(currentHerbId, 'home');
    }
}

// --- 导航系统 ---
function showHome() { switchPage('home'); }
function showHerbSearch() { switchPage('search'); }
function showSymptomPage() {
    pendingSymptomDescription = '';
    symptomAnswers = {};
    switchPage('symptom');
    symptomResetAndRender();
}

function switchPage(id) {
    document.body.classList.toggle('home-page-active', id === 'home');
    const pages = ['home', 'search', 'symptom', 'detail'];
    pages.forEach(p => {
        const el = document.getElementById(`${p}-section`);
        const nav = document.getElementById(`nav-${p}`);
        if (!el) return;

        const isActive = p === id;
        el.classList.toggle('page-active', isActive);
        el.setAttribute('aria-hidden', String(!isActive));
        if (nav) nav.classList.toggle('active', isActive);
    });
    window.scrollTo(0, 0);
}

// --- 草本查询逻辑 ---
function buildHerbCardHTML(herb) {
    return `
        <article class="herb-card" tabindex="0" role="button" onclick="openDetail('${herb.id}', 'search')" onkeydown="if(event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail('${herb.id}', 'search'); }">
            <h3>${herb.name}</h3>
            <div class="herb-tag-row">
                <span class="herb-label">${herb.property}</span>
                <span class="herb-effect">${herb.category}</span>
            </div>
            <p class="herb-intro">${herb.oneLiner}</p>
            <div class="view-detail">查看详情 <span aria-hidden="true">→</span></div>
        </article>
    `;
}

function renderGroupedHerbs(data) {
    const groups = CATEGORIES
        .filter(category => category !== '全部')
        .map(category => ({ category, herbs: data.filter(herb => herb.category === category) }))
        .filter(group => group.herbs.length);

    return groups.map(group => `
        <section class="herb-category-group" aria-labelledby="category-${group.category}">
            <div class="category-group-header">
                <h2 id="category-${group.category}">${group.category}</h2>
                <span>${group.herbs.length} 味</span>
            </div>
            <div class="herb-group-grid">
                ${group.herbs.map(buildHerbCardHTML).join('')}
            </div>
        </section>
    `).join('');
}

function renderHerbGrid(data, options = {}) {
    const grid = document.getElementById('herb-grid');
    currentSearchResultIds = (data || []).map(herb => herb.id);
    if (!data || data.length === 0) {
        grid.classList.remove('grouped-view');
        grid.innerHTML = `
            <div class="search-empty-state">
                <h3>暂未找到相关草本知识</h3>
                <p>可以换一个药名或功效词继续查询，也可以把这段描述带入身体信号整理。</p>
                <div class="search-empty-actions">
                    <button type="button" class="secondary-action" onclick="focusLibrarySearch()">换个关键词</button>
                    <button type="button" class="search-button" onclick="organizeCurrentSearch()">整理身体信号</button>
                </div>
            </div>
        `;
        return;
    }

    const shouldGroup = options.grouped === true;
    grid.classList.toggle('grouped-view', shouldGroup);
    grid.innerHTML = shouldGroup
        ? renderGroupedHerbs(data)
        : data.map(buildHerbCardHTML).join('');
}

function renderLibFilters() {
    const container = document.getElementById('lib-filters');
    container.innerHTML = CATEGORIES.map(c => `
        <span class="filter-tag" onclick="filterByCategory('${c}', this)">${c}</span>
    `).join('');
    container.children[0].classList.add('active');
}

function filterByCategory(cat, el) {
    closeAllSuggestions();
    document.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    currentSearchCategory = cat;
    currentSearchQuery = '';
    const input = document.getElementById('lib-search-input');
    if (input) input.value = '';
    updateSearchStatus();

    if (cat === '全部') renderHerbGrid(HERB_DATA, { grouped: true });
    else renderHerbGrid(HERB_DATA.filter(h => h.category === cat));
}

function normalizeSearchText(value) {
    return String(value || '').trim().toLowerCase();
}

function matchesHerbQuery(herb, query) {
    const q = normalizeSearchText(query);
    if (!q) return true;
    const mappedCategory = EFFECT_TO_CATEGORY[String(query || '').trim()];
    if (mappedCategory && herb.category === mappedCategory) return true;
    return [
        herb.name,
        herb.latin,
        herb.category,
        herb.property,
        ...herb.tags,
        herb.oneLiner,
        ...herb.directions
    ].some(value => normalizeSearchText(value).includes(q));
}

function getHerbSuggestionItems(query) {
    const q = normalizeSearchText(query);
    if (!q) return [];
    return HERB_DATA
        .filter(herb => normalizeSearchText(herb.name).includes(q))
        .sort((a, b) => {
            const aStarts = normalizeSearchText(a.name).startsWith(q) ? 0 : 1;
            const bStarts = normalizeSearchText(b.name).startsWith(q) ? 0 : 1;
            return aStarts - bStarts;
        })
        .map(herb => ({
            type: 'herb',
            label: herb.name,
            subtitle: `${herb.category} · ${herb.tags.slice(0, 2).join('、')}`,
            value: herb.name,
            target: herb.id
        }));
}

function getEffectSuggestionItems(query) {
    const q = normalizeSearchText(query);
    if (!q) return [];
    return Object.entries(EFFECT_TO_CATEGORY)
        .filter(([label, category]) =>
            normalizeSearchText(label).includes(q) || normalizeSearchText(category).includes(q)
        )
        .filter(([label], index, entries) => entries.findIndex(item => item[0] === label) === index)
        .map(([label, category]) => ({
            type: 'effect',
            label,
            subtitle: `查看“${category}”方向的草本知识`,
            value: label,
            target: category
        }));
}

function getSymptomSuggestionItems(query) {
    const q = normalizeSearchText(query);
    if (!q) return [];
    const seen = new Set();
    const items = [];
    SYMPTOM_DATA.forEach(group => {
        (group.keywords || []).forEach(keyword => {
            if (!seen.has(keyword) && normalizeSearchText(keyword).includes(q)) {
                seen.add(keyword);
                items.push({
                    type: 'symptom',
                    label: keyword,
                    subtitle: '带入身体信号整理',
                    value: keyword,
                    target: 'symptom'
                });
            }
        });
    });
    return items;
}

function buildSuggestionItems(scope, query) {
    const herbs = getHerbSuggestionItems(query);
    const effects = getEffectSuggestionItems(query);
    const symptoms = scope === 'home' ? getSymptomSuggestionItems(query) : [];
    return [...herbs, ...effects, ...symptoms].slice(0, scope === 'home' ? 8 : 6);
}

function handleSuggestionInput(scope, query) {
    updateSuggestions(scope, query);
}

function filterHerbGrid(query) {
    const q = (query || '').trim();
    currentSearchQuery = q;
    currentSearchCategory = '全部';
    updateSearchStatus();
    const results = HERB_DATA.filter(herb => matchesHerbQuery(herb, q));
    renderHerbGrid(results, { grouped: !q });
    if (!q) closeSuggestions('library');
}

function updateSuggestions(scope, query) {
    const state = suggestionStates[scope];
    state.items = buildSuggestionItems(scope, query);
    state.activeIndex = -1;
    renderSuggestions(scope);
}

function getSuggestionElements(scope) {
    return scope === 'home'
        ? { list: document.getElementById('home-suggestions'), input: document.getElementById('home-search-input') }
        : { list: document.getElementById('herb-suggestions'), input: document.getElementById('lib-search-input') };
}

function getSuggestionTypeLabel(type) {
    return { herb: '药材', effect: '功效', symptom: '身体表现' }[type] || '';
}

function renderSuggestions(scope) {
    const state = suggestionStates[scope];
    const { list, input } = getSuggestionElements(scope);
    if (!list || !input) return;

    if (!state.items.length) {
        closeSuggestions(scope);
        return;
    }

    list.innerHTML = state.items.map((item, index) => `
        <button type="button" id="${scope}-suggestion-${index}" class="search-suggestion${index === state.activeIndex ? ' active' : ''}" role="option" aria-selected="${index === state.activeIndex}" data-suggestion-scope="${scope}" data-suggestion-index="${index}">
            <span class="suggestion-copy">
                <span class="suggestion-name">${item.label}</span>
                <span class="suggestion-meta">${item.subtitle}</span>
            </span>
            <span class="suggestion-type type-${item.type}">${getSuggestionTypeLabel(item.type)}</span>
        </button>
    `).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (state.activeIndex >= 0) {
        input.setAttribute('aria-activedescendant', `${scope}-suggestion-${state.activeIndex}`);
    } else {
        input.removeAttribute('aria-activedescendant');
    }

    list.querySelectorAll('[data-suggestion-index]').forEach(option => {
        option.addEventListener('mousedown', event => event.preventDefault());
        option.addEventListener('click', () => selectSuggestion(scope, Number(option.dataset.suggestionIndex)));
    });
}

function closeSuggestions(scope) {
    const state = suggestionStates[scope];
    const { list, input } = getSuggestionElements(scope);
    state.items = [];
    state.activeIndex = -1;
    if (list) {
        list.hidden = true;
        list.innerHTML = '';
    }
    if (input) {
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }
}

function closeAllSuggestions() {
    closeSuggestions('home');
    closeSuggestions('library');
}

function applyLibraryEffect(category) {
    const categoryTag = [...document.querySelectorAll('#lib-filters .filter-tag')]
        .find(tag => tag.textContent === category);
    if (categoryTag) filterByCategory(category, categoryTag);
}

function selectSuggestion(scope, index) {
    const item = suggestionStates[scope].items[index];
    if (!item) return;

    if (scope === 'home') {
        const input = document.getElementById('home-search-input');
        if (input) input.value = item.value;
        closeAllSuggestions();
        if (item.type === 'symptom') openSymptomOrganizer(item.value);
        else executeHomeSearch();
        return;
    }

    const input = document.getElementById('lib-search-input');
    if (item.type === 'effect') {
        if (input) input.value = '';
        closeSuggestions('library');
        applyLibraryEffect(item.target);
        return;
    }

    if (input) input.value = item.value;
    clearFilterActive();
    filterHerbGrid(item.value);
    closeSuggestions('library');
    input.focus();
}

function handleSuggestionKeydown(scope, event) {
    const state = suggestionStates[scope];
    if (event.key === 'Escape') {
        closeSuggestions(scope);
        return;
    }

    if (event.key === 'Enter' && state.activeIndex < 0) {
        if (scope === 'home') executeHomeSearch();
        return;
    }

    if (!state.items.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        state.activeIndex = (state.activeIndex + direction + state.items.length) % state.items.length;
        renderSuggestions(scope);
        return;
    }

    if (event.key === 'Enter' && state.activeIndex >= 0) {
        event.preventDefault();
        selectSuggestion(scope, state.activeIndex);
    }
}

// 激活某个分类筛选（供快捷标签语义匹配使用）
function activateCategory(cat) {
    const tags = document.querySelectorAll('#lib-filters .filter-tag');
    let target = null;
    tags.forEach(t => { if (t.textContent === cat) target = t; });
    if (target) {
        filterByCategory(cat, target);
    } else {
        renderHerbGrid(HERB_DATA.filter(h => h.category === cat));
    }
}

// 首页快捷标签与搜索框共用同一套意图分流规则
function quickSearch(kw) {
    const input = document.getElementById('home-search-input');
    if (input) input.value = (kw || '').trim();
    executeHomeSearch();
}

// 清除分类筛选高亮（用于非分类类搜索，避免误导）
function clearFilterActive() {
    document.querySelectorAll('#lib-filters .filter-tag').forEach(t => t.classList.remove('active'));
}

function updateSearchStatus() {
    const status = document.getElementById('search-status');
    if (!status) return;

    if (currentSearchQuery) {
        status.textContent = `正在展示与“${currentSearchQuery}”相关的草本知识`;
        return;
    }

    if (currentSearchCategory && currentSearchCategory !== '全部') {
        status.textContent = `正在展示“${currentSearchCategory}”方向的草本知识`;
        return;
    }

    status.textContent = '正在展示全部草本知识';
}

function classifyHomeIntent(value) {
    const val = (value || '').trim();
    if (!val) return { type: 'browse', value: '' };

    const matchesHerbName = HERB_DATA.some(herb =>
        herb.name.startsWith(val) || val.startsWith(herb.name)
    );
    if (matchesHerbName) return { type: 'herb', value: val };

    const category = CATEGORIES.includes(val) ? val : EFFECT_TO_CATEGORY[val];
    if (category) return { type: 'effect', value: val, category };

    const relatedGroup = SYMPTOM_DATA.find(item => item.name === val);
    if (relatedGroup) {
        return { type: 'related', value: val, herbIds: relatedGroup.herbs || [] };
    }

    const isBodySignal = SYMPTOM_DATA.some(item =>
        (item.keywords || []).some(keyword => val.includes(keyword))
    );
    if (isBodySignal) return { type: 'symptom', value: val };

    return { type: 'symptom', value: val };
}

function openSymptomOrganizer(description) {
    closeAllSuggestions();
    pendingSymptomDescription = (description || '').trim();
    symptomAnswers = {};
    if (pendingSymptomDescription) symptomAnswers.desc = pendingSymptomDescription;
    switchPage('symptom');
    symptomResetAndRender();
}

function focusLibrarySearch() {
    const input = document.getElementById('lib-search-input');
    if (!input) return;
    input.focus();
    input.select();
}

function organizeCurrentSearch() {
    openSymptomOrganizer(currentSearchQuery);
}

// 首页搜索框：根据输入意图切换到草本查询或身体信号整理
function executeHomeSearch() {
    closeAllSuggestions();
    const homeInput = document.getElementById('home-search-input');
    const intent = classifyHomeIntent(homeInput ? homeInput.value : '');

    if (intent.type === 'symptom') {
        openSymptomOrganizer(intent.value);
        return;
    }

    showHerbSearch();
    const input = document.getElementById('lib-search-input');
    input.value = '';

    if (intent.type === 'browse') {
        clearFilterActive();
        const allTag = [...document.querySelectorAll('#lib-filters .filter-tag')]
            .find(tag => tag.textContent === '全部');
        if (allTag) filterByCategory('全部', allTag);
        else filterHerbGrid('');
        return;
    }

    if (intent.type === 'effect') {
        const categoryTag = [...document.querySelectorAll('#lib-filters .filter-tag')]
            .find(tag => tag.textContent === intent.category);
        if (categoryTag) {
            filterByCategory(intent.category, categoryTag);
            return;
        }
    }

    if (intent.type === 'related') {
        input.value = intent.value;
        clearFilterActive();
        currentSearchQuery = intent.value;
        currentSearchCategory = '全部';
        updateSearchStatus();
        const relatedHerbs = intent.herbIds
            .map(id => HERB_DATA.find(herb => herb.id === id))
            .filter(Boolean);
        renderHerbGrid(relatedHerbs);
        return;
    }

    input.value = intent.value;
    clearFilterActive();
    filterHerbGrid(intent.value);
}

// --- 药材详情页（方案 B：全屏详情，替代右侧抽屉） ---
// 把详情内容抽成纯函数，便于复用与维护
function buildHerbDetailHTML(herb) {
    return `
        <div class="detail-layout">
            <aside class="detail-aside">
                <div class="detail-kicker">${herb.category} · 草本知识卡</div>
                <h1 class="detail-title">${herb.name}</h1>
                <p class="detail-latin">${herb.latin}</p>
                <p class="detail-summary">${herb.oneLiner}</p>
                <div class="detail-quick">
                    <div class="detail-quick-item">
                        <div class="detail-quick-label">性味</div>
                        <div class="detail-quick-value">${herb.property}</div>
                    </div>
                    <div class="detail-quick-item">
                        <div class="detail-quick-label">归经</div>
                        <div class="detail-quick-value">${herb.meridians.join('、')}</div>
                    </div>
                </div>
                <div class="detail-tags">
                    ${herb.tags.map(t => `<span>${t}</span>`).join('')}
                </div>
            </aside>
            <main class="detail-main">
                <section class="detail-block">
                    <h4>核心功效</h4>
                    <p>${herb.description}</p>
                </section>
                <section class="detail-block">
                    <h4>调理方向参考</h4>
                    <p>${herb.directions.join('、')}</p>
                </section>
                <section class="detail-block">
                    <h4>常见配伍思路</h4>
                    ${herb.pairings.map(p => `
                        <div class="detail-pairing">
                            <div class="detail-pairing-combo">${p.combo}</div>
                            <div class="detail-pairing-effect">${p.effect}</div>
                        </div>
                    `).join('')}
                </section>
                <section class="detail-block detail-warn">
                    <h4>⚠️ 禁忌提醒</h4>
                    <p>${herb.contraindications}</p>
                </section>
                <section class="detail-block detail-note">
                    <p>通俗理解：${herb.explanation}</p>
                </section>
            </main>
        </div>
    `;
}

// 打开全屏详情页：渲染内容并切换页面，记录返回去向
function openDetail(id, fromPage) {
    const herb = HERB_DATA.find(h => h.id === id);
    if (!herb) return;
    detailReturnPage = fromPage || 'search';
    if (detailReturnPage === 'search') searchScrollPosition = window.scrollY;
    const backButton = document.getElementById('detail-back');
    if (backButton) {
        backButton.textContent = detailReturnPage === 'home' ? '← 返回首页' : '← 返回查询';
        backButton.setAttribute('aria-label', detailReturnPage === 'home' ? '返回首页' : '返回草本查询');
    }
    closeAllSuggestions();
    document.getElementById('detail-content').innerHTML = buildHerbDetailHTML(herb);
    switchPage('detail');
}

function restoreSearchState() {
    const input = document.getElementById('lib-search-input');
    if (input) input.value = currentSearchQuery;
    updateSearchStatus();

    if (currentSearchQuery) {
        clearFilterActive();
    } else {
        const categoryTag = [...document.querySelectorAll('#lib-filters .filter-tag')]
            .find(tag => tag.textContent === currentSearchCategory);
        if (categoryTag) {
            document.querySelectorAll('.filter-tag').forEach(tag => tag.classList.remove('active'));
            categoryTag.classList.add('active');
        }
    }

    const restoredResults = currentSearchResultIds
        .map(id => HERB_DATA.find(herb => herb.id === id))
        .filter(Boolean);
    const shouldGroup = !currentSearchQuery && currentSearchCategory === '全部';
    renderHerbGrid(restoredResults, { grouped: shouldGroup });
    closeAllSuggestions();
}

// 详情页返回按钮
function goBackFromDetail() {
    const returnPage = detailReturnPage;
    switchPage(returnPage);
    if (returnPage === 'search') {
        restoreSearchState();
        requestAnimationFrame(() => window.scrollTo(0, searchScrollPosition));
    }
}

// --- 身体信号整理流程 · 引擎驱动（阶段 2：LocalMockDriver + 状态机 S0~S6） ---
const symptomSession = new SymptomAgentEngine.SymptomSession(SymptomAgentEngine.getDriver('mock'));
let symptomClarifyLocked = false;
let lastReportData = null;

// 4 步 Stepper 与状态机映射：S0→1, S1→2, S2/S3→3, S4/S5→4；SAFETY_CUTOFF 停在 2
function updateStepper(activeStep) {
    for (let i = 1; i <= 4; i++) {
        const label = document.getElementById(`step-${i}-label`);
        if (!label) continue;
        if (i <= activeStep) label.classList.add('active');
        else label.classList.remove('active');
    }
}

// 入口：重置会话并渲染 S0
function symptomResetAndRender() {
    symptomSession.restart();
    renderSymptomState('S0');
}

// 状态 → 渲染分发
function renderSymptomState(state, data) {
    const container = document.getElementById('symptom-step-container');
    if (!container) return;
    if (state === 'S0') { updateStepper(1); container.innerHTML = renderS0HTML(); }
    else if (state === 'S1') { updateStepper(2); container.innerHTML = renderS1HTML(); }
    else if (state === 'S2') { updateStepper(3); container.innerHTML = renderS2HTML(data); }
    else if (state === 'S3') { updateStepper(3); container.innerHTML = renderS3HTML(data); }
    else if (state === 'S4') { updateStepper(4); container.innerHTML = renderS4SkeletonHTML(); }
    else if (state === 'S5') { updateStepper(4); lastReportData = data; container.innerHTML = renderS5HTML(data); }
    else if (state === 'SAFETY_CUTOFF') { updateStepper(2); container.innerHTML = renderSafetyCutoffHTML(data); }
}

// S0 安全提醒
function renderS0HTML() {
    return `
        <div class="fade-in">
            <h2 style="text-align:center; margin-bottom:40px">在开始前，请确认您的基本情况</h2>
            <div style="max-width:480px; margin:0 auto">
                ${renderCheckbox('s_preg', '是否怀孕或备孕')}
                ${renderCheckbox('s_age', '是否为儿童或高龄老人')}
                ${renderCheckbox('s_risk', '是否有高烧、胸痛等紧急症状')}
                ${renderCheckbox('s_chronic', '是否有慢性疾病')}
                <div style="margin-top:40px; text-align:center">
                    <button class="search-button" onclick="symptomStartInput()" style="padding:0 60px">确认并开始</button>
                </div>
            </div>
        </div>
    `;
}

// S1 输入描述
function symptomStartInput() { renderSymptomState('S1'); }
function renderS1HTML() {
    const prefill = pendingSymptomDescription || (symptomSession.desc || '');
    pendingSymptomDescription = '';
    return `
        <div class="fade-in">
            <h2 style="margin-bottom:32px">请描述您的身体表现</h2>
            <textarea id="symptom-input" placeholder="例如：最近总是口苦、睡不好、容易烦躁、胃口一般。" style="width:100%; height:200px; border:1px solid var(--border-color); border-radius:16px; padding:24px; font-size:16px; background:white; resize:none"></textarea>
            <div style="margin-top:40px; text-align:center">
                <button class="search-button" onclick="symptomSubmit()" style="padding:0 60px">开始整理</button>
            </div>
        </div>
    `;
}
function symptomSubmit() {
    const el = document.getElementById('symptom-input');
    const val = el ? el.value.trim() : '';
    if (!val) { alert('请输入描述'); return; }
    const res = symptomSession.submitDescription(val);
    if (res.state === 'SAFETY_CUTOFF') { renderSymptomState('SAFETY_CUTOFF', res.data); return; }
    renderSymptomState('S2', res.data);
}

// S2 细节追问（双轨多组 · 多选 Checkbox · 每卡强制兜底）
function renderS2HTML(data) {
    const opts = (data.option_cards || []).map(c => `
        <label class="clarify-opt${c.negative ? ' clarify-neg' : ''}">
            <input type="checkbox" data-tag="${c.tag}" onchange="toggleClarify(this)">
            <span>${c.label}</span>
        </label>`).join('');
    return `
        <div class="fade-in">
            <h2 style="text-align:center; margin-bottom:8px">补充细节（可多选）</h2>
            <p style="text-align:center; color:var(--text-muted); font-size:13px; margin-bottom:24px">${data.ask_track === 'T1' ? '主诉深度细化' : (data.ask_track === 'T2' ? '《十问篇》基础盘查' : '补充问诊')} · 第 ${symptomSession.round} 轮</p>
            <div style="max-width:600px; margin:0 auto">
                <p style="font-weight:700; margin-bottom:16px; font-size:16px">${data.question_text || ''}</p>
                <div id="clarify-cards" style="display:flex; flex-direction:column; gap:12px">${opts}</div>
                <div style="margin-top:24px; display:flex; gap:16px; align-items:center; justify-content:center">
                    <button class="search-button" onclick="symptomAnswerMulti()">确认选择</button>
                    <button class="ghost-btn" type="button" onclick="symptomBackToEdit()">← 返回修改描述</button>
                </div>
                <p style="font-size:12px; color:var(--text-muted); margin-top:16px; text-align:center">收敛分 ${data.convergence_score} · 无对应情况请勾选「以上均无」</p>
            </div>
        </div>
    `;
}
// 多选排他：勾选兜底项则清空其它；勾选其它则清空兜底
function toggleClarify(box) {
    const group = document.getElementById('clarify-cards');
    if (!group) return;
    const boxes = group.querySelectorAll('input[type=checkbox]');
    if (box.classList.contains('clarify-neg') || (box.parentElement && box.parentElement.classList.contains('clarify-neg'))) {
        if (box.checked) boxes.forEach(b => { if (b !== box) b.checked = false; });
    } else {
        boxes.forEach(b => { if ((b.parentElement && b.parentElement.classList.contains('clarify-neg')) || b.classList.contains('clarify-neg')) b.checked = false; });
    }
}
// S2 多选提交
function symptomAnswerMulti() {
    if (symptomClarifyLocked) return;
    const group = document.getElementById('clarify-cards');
    if (!group) return;
    const tags = Array.from(group.querySelectorAll('input[type=checkbox]:checked')).map(b => b.getAttribute('data-tag'));
    if (!tags.length) { alert('请至少选择一项；若无对应情况，请勾选「以上均无」。'); return; }
    symptomClarifyLocked = true;
    const res = symptomSession.answer(tags);
    if (res.state === 'S2') renderSymptomState('S2', res.data);
    else if (res.state === 'S3') renderSymptomState('S3', res.data);
    symptomClarifyLocked = false;
}
// S2 → S1：返回修改描述（保留并回显上一轮文字，允许增删）
function symptomBackToEdit() {
    symptomSession.backToEdit();
    renderSymptomState('S1');
}

// S3 收敛确认（结构化：核心表现 / 兼带细节 / 已排除）
function renderS3HTML(data) {
    const p = data.ui_card_payload || {};
    const associated = (p.associated_symptoms || []).map(t => `<li>${t}</li>`).join('');
    const negative = (p.confirmed_negative || []).map(t => `<li>${t}</li>`).join('');
    return `
        <div class="fade-in">
            <h2 style="text-align:center; margin-bottom:24px">${p.card_title || '确认您的身体信号'}</h2>
            <div style="max-width:600px; margin:0 auto">
                <div class="structured-confirm">
                    <div class="sc-block">
                        <div class="sc-label">核心表现</div>
                        <div class="sc-value sc-primary">${p.primary_symptom || ''}</div>
                    </div>
                    ${associated.length ? `<div class="sc-block"><div class="sc-label">兼带细节</div><ul class="sc-list">${associated}</ul></div>` : ''}
                    ${negative.length ? `<div class="sc-block"><div class="sc-label">已排除 / 无异常</div><ul class="sc-list sc-negative">${negative}</ul></div>` : ''}
                    <div class="sc-block sc-note">${p.synthesized_symptom_text || ''}</div>
                </div>
                <div style="margin-top:40px; text-align:center; display:flex; gap:16px; justify-content:center">
                    <button class="search-button" onclick="symptomConfirm()" style="padding:0 40px">确认无误，生成报告</button>
                    <button class="ghost-btn" onclick="symptomEdit()">补充 / 修改描述</button>
                </div>
            </div>
        </div>
    `;
}
function symptomConfirm() {
    renderSymptomState('S4'); // 骨架屏瞬态（S4 检索加载）
    setTimeout(() => {
        const res = symptomSession.confirm();
        renderSymptomState('S5', res.data);
    }, 650);
}
function symptomEdit() {
    // 保留上一轮文字并回显，允许增删修改
    renderSymptomState('S1');
}

// S4 骨架屏
function renderS4SkeletonHTML() {
    return `
        <div class="fade-in skeleton-screen">
            <div class="skeleton-bar"></div>
            <div class="skeleton-bar"></div>
            <div class="skeleton-bar short"></div>
            <p class="skeleton-text">正在检索中医典籍与草本知识库...</p>
        </div>
    `;
}

// S5 报告渲染（8 模块，来自 Skill 5 输出；composition 与草本卡 ID 级强联动）
function renderS5HTML(data) {
    const sec = (data.ui_card_payload && data.ui_card_payload.sections) || {};
    const fm = sec.matched_formula_section || {};
    const herbs = sec.herb_knowledge_section || [];
    const diet = sec.dietary_guidance_section || {};
    const life = sec.lifestyle_guidance_section || {};
    // 组成药材名称 → herb_id 映射，用于 ID 级强联动
    const compMap = {};
    herbs.forEach(h => { compMap[h.herb_name] = h.herb_id; });
    const compositionChips = (fm.composition && fm.composition.length) ? fm.composition.map(name => {
        const cid = compMap[name] || '';
        return cid
            ? `<span class="composition-chip" data-herb-id="${cid}" role="button" tabindex="0" onclick="focusHerb('${cid}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();focusHerb('${cid}');}">${name}</span>`
            : `<span class="composition-chip no-link">${name}</span>`;
    }).join('') : '';
    const herbCards = herbs.length ? herbs.map(h => `
        <div class="report-herb${h.has_toxicity ? ' toxic' : ''}" data-herb-id="${h.herb_id}" ${h.openable ? `onclick="openDetail('${h.herb_id}','symptom')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openDetail('${h.herb_id}','symptom');}"` : ''}>
            <div class="report-herb-name">${h.herb_name}${h.has_toxicity ? ' <span class="toxic-tag">毒性药材</span>' : ''}</div>
            <div class="report-herb-desc">${h.description || ''}</div>
            ${h.has_toxicity ? `<div class="report-herb-warn">${h.toxicity_warning || ''}</div>` : ''}
        </div>
    `).join('') : '<div class="report-content">暂无特别匹配的草本，建议从温和调理方向了解。</div>';
    const habitItems = (life.habits || []).map(h => `<li>${h}</li>`).join('');

    return `
        <div class="fade-in report-card">
            <div style="text-align:center; margin-bottom:40px">
                <h2 style="color:var(--primary-green)">身体信号整理报告</h2>
                <p style="font-size:12px; color:var(--text-muted)">报告生成时间：${new Date().toLocaleString()}</p>
            </div>

            <div class="report-section">
                <h5>通俗译释</h5>
                <div class="report-content">${sec.tcm_explanation_section || ''}</div>
            </div>

            <div class="report-section">
                <h5>辨证倾向结论（5D 加权推理矩阵）</h5>
                <div class="report-content">
                    ${sec.bias_conclusion_section ? `
                    <p style="margin-bottom:10px">
                        <b>归经方向：</b>${sec.bias_conclusion_section.category_name}
                        ｜ <b>推荐典籍方剂：</b>${sec.bias_conclusion_section.formula_name}（${sec.bias_conclusion_section.source_book}）
                        ${sec.bias_conclusion_section.low_confidence ? ' <span class="toxic-tag">倾向性较弱</span>' : ''}
                    </p>
                    <p style="margin-bottom:10px; color:var(--text-muted); font-size:13px">
                        加权推理得分 Score = ${sec.bias_conclusion_section.score}
                        ${sec.bias_conclusion_section.matched_zhuan_tags && sec.bias_conclusion_section.matched_zhuan_tags.length ? ' ｜ 命中专病：' + sec.bias_conclusion_section.matched_zhuan_tags.join('、') : ''}
                        ${sec.bias_conclusion_section.matched_shiwen_tags && sec.bias_conclusion_section.matched_shiwen_tags.length ? ' ｜ 命中十问：' + sec.bias_conclusion_section.matched_shiwen_tags.join('、') : ''}
                    </p>
                    <p>${sec.bias_conclusion_section.conclusion_text || ''}</p>
                    ` : '<p>已完成辨证推理，详见上方脏腑方向与参考方剂。</p>'}
                </div>
            </div>

            <div class="report-section">
                <h5>面诊沟通话术</h5>
                <div class="report-content">${sec.doctor_communication_brief || ''}
                    <div style="margin-top:12px"><button class="search-button" style="padding:0 24px; font-size:13px" onclick="copyDoctorBrief()">复制话术给医生</button></div>
                </div>
            </div>

            <div class="report-section">
                <h5>古籍经典方剂参考</h5>
                <div class="report-content" style="background:var(--light-green-bg); color:var(--primary-green); font-weight:700">
                    ${fm.formula_name || '温和调理方向'} ${fm.source_book ? '（' + fm.source_book + '）' : ''}
                    <div style="font-weight:400; font-size:13px; margin-top:8px; color:var(--text-main)">${fm.description || ''}</div>
                    ${compositionChips ? `<div class="formula-composition"><div class="fc-label">组成药材（点击定位下方知识卡）</div><div class="fc-chips">${compositionChips}</div></div>` : ''}
                </div>
            </div>

            <div class="report-section">
                <h5>相关草本知识</h5>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">${herbCards}</div>
            </div>

            <div class="report-section">
                <h5>食疗避忌</h5>
                <div class="report-content">${diet.fruit_advice || ''}</div>
            </div>

            <div class="report-section">
                <h5>日常作息</h5>
                <div class="report-content"><ul style="margin:0; padding-left:18px; line-height:1.9">${habitItems}</ul></div>
            </div>

            <div style="margin-top:48px; display:flex; gap:16px; justify-content:center; flex-wrap:wrap">
                <button class="search-button" onclick="exportReportImage()">导出 / 复制为报告长图</button>
                <button class="ghost-btn" onclick="copyReport()">复制文字报告</button>
                <button class="ghost-btn" onclick="symptomRestart()">重新整理</button>
            </div>

            <p style="text-align:center; font-size:11px; color:var(--text-muted); margin-top:32px; font-style:italic">
                ${sec.disclaimer || ''}
            </p>
        </div>
    `;
}
// 组成药材 → 草本知识卡：点击定位并高亮（ID 级强联动）
function focusHerb(id) {
    if (!id) return;
    const card = document.querySelector('.report-herb[data-herb-id="' + id + '"]');
    if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('linked-highlight');
        setTimeout(function () { card.classList.remove('linked-highlight'); }, 1600);
    }
}
function symptomRestart() { symptomResetAndRender(); }

// 导出 / 复制为报告长图（html2canvas → PNG；优先写入剪贴板，否则下载）
function exportReportImage() {
    const card = document.querySelector('#symptom-step-container .report-card');
    if (!card) { alert('报告尚未生成'); return; }
    if (typeof html2canvas === 'undefined') { alert('图片导出库未加载，请检查网络后重试'); return; }
    const btn = event && event.target;
    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.textContent = '正在生成图片...'; btn.disabled = true; }
    html2canvas(card, { backgroundColor: '#FAF8F5', scale: 2, useCORS: true, logging: false, scrollY: -window.scrollY }).then(function (canvas) {
        canvas.toBlob(function (blob) {
            if (blob && navigator.clipboard && window.ClipboardItem) {
                navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                    .then(function () { if (btn) { btn.textContent = '已复制长图到剪贴板'; } setTimeout(function () { if (btn) { btn.textContent = oldText; btn.disabled = false; } }, 2000); })
                    .catch(function () { downloadCanvas(canvas, oldText, btn); });
            } else {
                downloadCanvas(canvas, oldText, btn);
            }
        }, 'image/png');
    }).catch(function () {
        alert('图片生成失败，请重试');
        if (btn) { btn.textContent = oldText; btn.disabled = false; }
    });
}
function downloadCanvas(canvas, oldText, btn) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = '身体信号整理报告.png';
    a.click();
    if (btn) { btn.textContent = '长图已下载'; setTimeout(function () { if (btn) { btn.textContent = oldText; btn.disabled = false; } }, 2000); }
}

// 复制面诊话术（取自 Skill 5 输出，不依赖 DOM 抓取）
function copyDoctorBrief() {
    const text = (lastReportData && lastReportData.ui_card_payload && lastReportData.ui_card_payload.sections.doctor_communication_brief) || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => alert('话术已复制')).catch(() => alert('复制失败，请手动选择'));
    } else alert('当前环境不支持自动复制');
}

// 红线切断（SAFETY_CUTOFF）固定合规红卡
function renderSafetyCutoffHTML(data) {
    return `
        <div class="fade-in" style="max-width:560px; margin:0 auto; text-align:center">
            <div style="border:2px solid #E5484D; border-radius:16px; padding:32px; background:#FFF5F5">
                <div style="font-size:40px; margin-bottom:12px">⚠</div>
                <p style="font-size:16px; font-weight:700; color:#E5484D; line-height:1.7">${data.compliance_card || '检测到急性或重症风险，请立即就医。'}</p>
            </div>
            <div style="margin-top:32px; display:flex; gap:16px; justify-content:center">
                <button class="search-button" onclick="symptomAcknowledgeSafety()">我知道了</button>
                <button class="ghost-btn" onclick="symptomRestart()">重新整理</button>
            </div>
        </div>
    `;
}
// 急症场景：清空危险输入并安全重置回到第一步
function symptomAcknowledgeSafety() {
    const el = document.getElementById('symptom-input');
    if (el) el.value = '';
    pendingSymptomDescription = '';
    symptomResetAndRender();
}

function renderCheckbox(id, label) {
    return `
        <label class="custom-checkbox">
            <input type="checkbox" id="${id}" style="display:none">
            <div class="checkbox-box"></div>
            <span>${label}</span>
        </label>
    `;
}

// 旧静态追问 / 硬编码报告已移除，由 LocalMockDriver + 状态机（S0~S6）驱动替代。

// 复制报告（真实复制到剪贴板，带降级提示）
function copyReport() {
    const text = document.querySelector('.report-card')?.innerText || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => alert('报告已复制到剪贴板'))
            .catch(() => alert('复制失败，请手动选择文本复制'));
    } else {
        alert('当前环境不支持自动复制，请手动选择文本复制');
    }
}
