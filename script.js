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
    initSymptomStep(1);
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
    initSymptomStep(1);
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

// --- 身体信号整理流程 ---
function initSymptomStep(step) {
    currentStep = step;
    const container = document.getElementById('symptom-step-container');

    // 更新流程条
    for (let i = 1; i <= 4; i++) {
        const label = document.getElementById(`step-${i}-label`);
        if (i <= step) label.classList.add('active');
        else label.classList.remove('active');
    }

    if (step === 1) {
        container.innerHTML = `
            <h2 style="text-align:center; margin-bottom:40px">在开始前，请确认您的基本情况</h2>
            <div style="max-width:480px; margin:0 auto">
                ${renderCheckbox('s_preg', '是否怀孕或备孕')}
                ${renderCheckbox('s_age', '是否为儿童或高龄老人')}
                ${renderCheckbox('s_risk', '是否有高烧、胸痛等紧急症状')}
                ${renderCheckbox('s_chronic', '是否有慢性疾病')}
                <div style="margin-top:40px; text-align:center">
                    <button class="search-button" onclick="initSymptomStep(2)" style="padding:0 60px">确认并开始</button>
                </div>
            </div>
        `;
    } else if (step === 2) {
        container.innerHTML = `
            <h2 style="margin-bottom:32px">请描述您的身体表现</h2>
            <textarea id="symptom-input" placeholder="例如：最近总是口苦、睡不好、容易烦躁、胃口一般。" style="width:100%; height:200px; border:1px solid var(--border-color); border-radius:16px; padding:24px; font-size:16px; background:white; resize:none"></textarea>
            <div style="margin-top:40px; text-align:center">
                <button class="search-button" onclick="handleStep2()" style="padding:0 60px">开始整理</button>
            </div>
        `;
        const symptomInput = document.getElementById('symptom-input');
        if (symptomInput) symptomInput.value = pendingSymptomDescription || symptomAnswers.desc || '';
        pendingSymptomDescription = '';
    } else if (step === 3) {
        container.innerHTML = `
            <h2 style="text-align:center; margin-bottom:40px">为了更准确，请补充细节</h2>
            <div style="max-width:600px; margin:0 auto">
                ${renderQuestion('怕冷怕热', '您更容易怕冷还是怕热？', ['怕冷', '怕热', '都不明显'])}
                ${renderQuestion('睡眠', '您的睡眠主要问题是？', ['入睡困难', '容易醒', '多梦', '正常'])}
                ${renderQuestion('大便', '您的大便情况更接近？', ['偏干', '偏稀', '黏腻', '正常'])}
                <div style="margin-top:40px; text-align:center">
                    <button class="search-button" onclick="initSymptomStep(4)" style="padding:0 60px">生成分析报告</button>
                </div>
            </div>
        `;
    } else if (step === 4) {
        renderReport(container);
    }
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

function renderQuestion(id, q, opts) {
    return `
        <div style="margin-bottom:32px">
            <p style="font-weight:700; margin-bottom:16px">${q}</p>
            <div style="display:flex; gap:12px; flex-wrap:wrap">
                ${opts.map(o => `<span class="tag-pill" onclick="saveAnswer('${id}', '${o}', this)">${o}</span>`).join('')}
            </div>
        </div>
    `;
}

function saveAnswer(id, val, el) {
    el.parentElement.querySelectorAll('.tag-pill').forEach(t => {
        t.style.background = 'var(--light-green-bg)';
        t.style.color = 'var(--primary-green)';
    });
    el.style.background = 'var(--primary-green)';
    el.style.color = 'white';
    symptomAnswers[id] = val;
}

function handleStep2() {
    const val = document.getElementById('symptom-input') ? document.getElementById('symptom-input').value : '';
    if (!val) { alert('请输入描述'); return; }
    symptomAnswers['desc'] = val;
    initSymptomStep(3);
}

function renderReport(container) {
    const desc = symptomAnswers['desc'] || "";
    let direction = desc.includes('火') || desc.includes('苦') ? "火热扰心" : "脾胃不和";
    let recs = desc.includes('火') ? ['jinyinhua', 'juhua'] : ['chenpi', 'fuling'];

    container.innerHTML = `
        <div class="report-card">
            <div style="text-align:center; margin-bottom:40px">
                <h2 style="color:var(--primary-green)">身体信号整理报告</h2>
                <p style="font-size:12px; color:var(--text-muted)">报告生成时间：${new Date().toLocaleString()}</p>
            </div>

            <div class="report-section">
                <h5>您的主要描述</h5>
                <div class="report-content">${desc}</div>
            </div>

            <div class="report-section">
                <h5>相关中医方向参考</h5>
                <div class="report-content" style="background:var(--light-green-bg); color:var(--primary-green); font-weight:700">
                    可能接近：${direction} 方向
                </div>
            </div>

            <div class="report-section">
                <h5>相关草本知识</h5>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
                    ${recs.map(rid => {
                        const h = HERB_DATA.find(item => item.id === rid);
                        return `<div style="padding:12px; border:1px solid var(--border-color); border-radius:12px; font-size:13px">${h.name}：${h.oneLiner}</div>`;
                    }).join('')}
                </div>
            </div>

            <div style="margin-top:48px; display:flex; gap:16px; justify-content:center">
                <button class="search-button" onclick="copyReport()">复制报告</button>
                <button class="search-button" style="background:#F3F4F6; color:var(--text-muted)" onclick="initSymptomStep(1)">重新整理</button>
            </div>

            <p style="text-align:center; font-size:11px; color:var(--text-muted); margin-top:32px; font-style:italic">
                提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。
            </p>
        </div>
    `;
}

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
