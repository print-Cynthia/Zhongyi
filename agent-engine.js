/**
 * agent-engine.js — 身体信号整理 · 可插拔本地引擎（LocalMockDriver） v2
 *
 * 本文件实现《契约 1/2/3》（agents/contracts/）规定的：
 *   - 5 Skill + Safety Shield 的本地规则驱动（零 API / 零成本 / 强 Schema 合规）
 *   - 状态机 S0~S6 的编排（Min Rounds=2 硬下限 / Max Rounds=5 硬停 / 红线切断 / 降级）
 *   - getDriver('mock'|'cloud') 可插拔接缝：未来切 CloudAPIDriver 业务代码零改动
 *
 * 语料库：统一读取 database/herbs_rag_db.js（PRD §3.3 三大层级：
 *   Layer1 体征标准化规范表、Layer2 问诊推导逻辑表《十问篇》、Layer3 结构化归纳与草本映射表）。
 * 双模：浏览器挂到 window.SymptomAgentEngine；Node 下 module.exports（供 QA 走查）。
 * 知识库：浏览器从全局 HERBS_RAG_DB / HERB_DATA / CABINET_DATA 读取；Node 用 globalThis.__TEST_* 注入。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SymptomAgentEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ============================ 0. 红线 / 红牌 / 配置 ============================ */
    // 急症红牌词（compliance-rules.md §2 + 阶段 3 自然语言扩展）：
    // 急性/重症方向——含口语化急症表达（胸好痛 / 心口痛 / 胸口痛 / 胸闷得慌 等），命中一票否决弹 RED 合规卡。
    // 注意：轻度「胸闷 / 胸胁胀痛」不在列，仍走正常心肺胸胁归纳路径。
    const RED_FLAGS = ['胸痛剧烈', '胸痛', '胸好痛', '心口痛', '胸口痛', '心口疼', '胸口疼', '胸疼', '胸闷得慌',
        '吐血', '呼吸困难', '剧烈头痛', '头痛伴呕吐', '昏迷', '大出血', '严重外伤', '急性中毒', '休克'];
    // 红线词（compliance-rules.md §3，用于检索时二次校验，本驱动仅记录）
    const FORBIDDEN_WORDS = ['确诊', '开方', '处方', '剂量', '治愈', '包好', '保证有效'];

    const MAX_ROUNDS = 5;
    const MIN_ROUNDS = 2;            // 收敛硬下限：至少追问 2 轮，杜绝「1 轮假收敛」
    const CONVERGENCE_PASS = 0.85;   // 收敛分展示阈值（仅展示，主约束为轮次）
    // 通用兜底选项（强制追加到每个追问卡片，绝不强迫硬选）
    const FALLBACK_LABEL = '以上均无 / 无上述情况';

    // 毒性药材名录（静态强预警，命中即插入 toxicity_warning，不依赖模型）
    const TOXIC_HERBS = ['banxia', 'fuzi', 'mahuang', 'zhenzhu', 'cantui', 'baidou'];

    // 维度 → 排除项展示文案（供 Synthesizer「已排除」叙述）
    const DIM_EXCLUDE_LABEL = {
        body: '局部体征', property: '寒热偏性', diet: '饮食消化异常', excretion: '二便异常',
        sleep: '睡眠障碍', emotion: '情绪问题', trigger: '诱发因素', other: '其他补充'
    };

    const DISCLAIMER = '提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。';

    /* ============================ 1. 语料库读取 ============================ */
    function getRag() {
        if (typeof HERBS_RAG_DB !== 'undefined') return HERBS_RAG_DB;
        if (globalThis.__TEST_RAG_DB__) return globalThis.__TEST_RAG_DB__;
        return { categories: [], global_inquiry: {} };
    }
    function getKB() {
        return {
            herbs: (typeof HERB_DATA !== 'undefined') ? HERB_DATA : (globalThis.__TEST_HERB__ || []),
            nameToId: (typeof CABINET_DATA !== 'undefined') ? CABINET_DATA : (globalThis.__TEST_NAME_TO_ID__ || {})
        };
    }
    // 收集语料库中出现过的所有维度（用于 missing_dimensions 计算）
    function collectAllDims(rag) {
        const set = new Set();
        (rag.categories || []).forEach(c => {
            Object.keys(c.depth_prompts || {}).forEach(k => { if (c.depth_prompts[k].dimension) set.add(c.depth_prompts[k].dimension); });
        });
        Object.keys(rag.global_inquiry || {}).forEach(k => { const g = rag.global_inquiry[k]; if (g.dimension) set.add(g.dimension); });
        return Array.from(set);
    }
    // 名称 → herb_id（优先类目草本，其次全局 Cabinet 名→id 映射；仅用于 ID 级联动与可点击判定）
    function buildNameToId(category, kb) {
        const map = {};
        (category && category.herbs || []).forEach(h => { if (h.name && h.id) map[h.name] = h.id; });
        const cab = kb.nameToId || {};
        Object.keys(cab).forEach(n => { if (!map[n]) map[n] = cab[n]; });
        return map;
    }

    function buildCtx(driver) {
        return {
            session_id: 'sess_' + Math.random().toString(36).slice(2, 10),
            round: 0,
            max_rounds: MAX_ROUNDS,
            driver: 'mock',
            knowledge_base: getRag(),
            red_list: RED_FLAGS,
            forbidden_words: FORBIDDEN_WORDS
        };
    }

    /* ============================ 2. 各 Skill 的 Mock 实现 ============================ */
    // Skill 0/护栏：Safety Shield 前置硬拦截（自然语言红线）
    function skillSafetyShield(ctx, input) {
        const text = input.user_raw_input || '';
        const matched = RED_FLAGS.filter(f => text.indexOf(f) >= 0);
        if (matched.length) {
            return {
                blocked: true, matched_red_flags: matched,
                compliance_card: '⚠ 安全提示：检测到您描述的症状可能属于急性或重症健康风险（如' + matched.join('、') + '）。本系统仅作轻量级健康整理，无法提供急救或临床诊断。请立即拨打急救电话或前往最近的医院急诊科就医！'
            };
        }
        return { blocked: false, matched_red_flags: [] };
    }

    // Skill 1 · Extractor（口语映射 + 类目命中 + 维度覆盖）
    function skillExtractor(ctx, input) {
        const text = input.user_raw_input || '';
        const rag = getRag();
        const matchedStandards = [];   // [{standard, dimension, raw}]
        const covered = new Set();
        let bestCat = null, bestScore = 0;
        (rag.categories || []).forEach(cat => {
            let score = 0;
            (cat.oral_synonyms || []).forEach(syn => {
                const hit = syn.oral.find(o => text.indexOf(o) >= 0);
                if (hit) {
                    score += 2;
                    matchedStandards.push({ standard: syn.standard, dimension: syn.dimension, raw: hit });
                    if (syn.dimension) covered.add(syn.dimension);
                }
            });
            (cat.standard_keywords || []).forEach(k => { if (text.indexOf(k) >= 0) score += 1; });
            if (score > bestScore) { bestScore = score; bestCat = cat; }
        });
        const allDims = collectAllDims(rag);
        const missing = allDims.filter(d => !covered.has(d));
        const completeness = covered.size < 2 ? 'low' : (covered.size <= 3 ? 'medium' : 'high');
        return {
            detected_category: bestCat ? bestCat.id : null,
            detected_category_name: bestCat ? bestCat.name : null,
            extracted_symptoms: matchedStandards,
            covered_dimensions: Array.from(covered),
            missing_dimensions: missing,
            overall_completeness: completeness
        };
    }

    // 构建双轨多组追问队列：轨1 主诉深度细化（类目 depth_prompts）→ 轨2 《十问篇》基础盘查（global_inquiry 未覆盖维度）→ 补位
    function buildClarifyQueue(ext, rag) {
        const queue = [];
        const cat = (rag.categories || []).find(c => c.id === ext.detected_category) || null;
        if (cat) {
            Object.keys(cat.depth_prompts || {}).forEach(k => {
                const dp = cat.depth_prompts[k];
                queue.push({ track: 'T1', key: k, dim: dp.dimension, question: dp.question, options: dp.options });
            });
        }
        // 轨2：仅盘查初始未覆盖的基础维度（避免与轨1重复）
        const coveredNow = new Set(ext.covered_dimensions || []);
        const gOrder = ['寒热', '二便', '睡眠', '饮食'];
        gOrder.forEach(gk => {
            const gi = (rag.global_inquiry || {})[gk];
            if (gi && gi.dimension && !coveredNow.has(gi.dimension)) {
                queue.push({ track: 'T2', key: gk, dim: gi.dimension, question: gi.question, options: gi.options });
                coveredNow.add(gi.dimension);
            }
        });
        // 补位：确保达到 Min Rounds（通用的「其他补充」多维盘查）
        const generic = { track: 'T3', key: 'generic', dim: 'other', question: '是否还有其他想补充的身体表现？（可多选）', options: ['乏力、神疲', '怕热、上火', '睡眠差、多梦', '情绪易波动'] };
        while (queue.length < MIN_ROUNDS) queue.push(generic);
        if (queue.length > MAX_ROUNDS) queue.length = MAX_ROUNDS;
        return queue;
    }

    // Skill 2 · Clarifier（双轨 + 单维拆分 + 多选 + 强制兜底）
    function skillClarifier(ctx, input) {
        const rag = getRag();
        const round = input.current_round;
        const queue = input.clarify_queue || [];
        const qi = input.queue_index || 0;
        const coveredCount = (input.covered_dimensions || []).length;
        const score = Math.min(1, 0.3 + 0.15 * coveredCount + 0.1 * round);
        const current = queue[qi];
        const shouldContinue = (qi < queue.length) && (round < MAX_ROUNDS);
        if (!current) {
            return { should_continue: false, ask_dimension: null, ask_track: null, ask_key: null, question_text: '', option_cards: [], convergence_score: Number(score.toFixed(2)) };
        }
        // 每个选项独立成 tag（以 label 为 tag，便于叙述回显）；强制追加兜底（负向）
        const option_cards = current.options.map(o => ({ label: o, tag: o, negative: false }))
            .concat([{ label: FALLBACK_LABEL, tag: FALLBACK_LABEL, negative: true }]);
        return {
            should_continue: shouldContinue,
            ask_dimension: current.dim,
            ask_track: current.track,
            ask_key: current.key,
            question_text: current.question,
            option_cards: option_cards,
            convergence_score: Number(score.toFixed(2))
        };
    }

    // 是否为兜底负向选项
    function isNegativeLabel(t) { return t === FALLBACK_LABEL; }

    // Skill 3 · Synthesizer（自然语言叙述 + 结构化载荷）
    function skillSynthesizer(ctx, input) {
        const extracted = input.extracted_symptoms || [];
        const answered = input.answered || [];
        const posSelections = [];
        const negDims = [];
        answered.forEach(a => {
            const tags = a.tags || [];
            const hasNeg = tags.some(isNegativeLabel);
            tags.forEach(t => { if (!isNegativeLabel(t)) posSelections.push(t); });
            if (hasNeg) negDims.push(DIM_EXCLUDE_LABEL[a.dim] || '相关方面');
        });
        const primary = extracted.length ? extracted[0].standard : (posSelections[0] || '相关身体表现');
        const associated = extracted.slice(1).map(e => e.standard).concat(posSelections.slice(1));
        const confirmed_negative = Array.from(new Set(negDims));

        // 深整理感的大段叙述
        let narrative = '';
        if (extracted.length) {
            narrative += '您最初描述的突出表现是' + extracted.map(e => e.standard).join('、') + '。';
        } else {
            narrative += '您最初的描述较为笼统，经逐步补充问诊后，整理出以下表现。';
        }
        if (posSelections.length) {
            narrative += '在进一步问诊中，您补充了：' + posSelections.join('；') + '。';
        }
        if (confirmed_negative.length) {
            narrative += '同时，您明确排除了' + confirmed_negative.join('、') + '等方面的问题。';
        }
        narrative += '综合来看，目前信息主要围绕「' + primary + '」方向展开，已具备进一步与医生沟通的基础。';

        return {
            summary_status: 'ready_for_confirmation',
            ui_card_payload: {
                card_type: 'symptom_summary_confirmation_card',
                card_title: '您的身体信号已系统整理',
                primary_symptom: primary,
                associated_symptoms: associated,
                confirmed_negative: confirmed_negative,
                selected_details: posSelections,
                synthesized_symptom_text: narrative,
                action_buttons: [
                    { label: '确认无误，生成报告', action: 'trigger_skill_4', type: 'primary' },
                    { label: '补充 / 修改描述', action: 'edit_symptoms', type: 'secondary' }
                ]
            }
        };
    }

    // Skill 4 · Retriever（RAG 精确匹配：类目 → 主方；composition 组成药材 → 草本知识卡 ID 级强联动）
    function skillRetriever(ctx, input) {
        const rag = getRag();
        const kb = getKB();
        const cat = (rag.categories || []).find(c => c.id === input.category_id) || null;
        const nameToId = buildNameToId(cat, kb);
        let formula = null;
        if (cat) formula = (cat.formulas || []).find(f => f.id === cat.primary_formula_id) || cat.formulas[0] || null;

        if (!formula) {
            // 通用兜底：信息不足以精准匹配典籍方剂（非「脾胃虚弱 / 四君子汤」干拔降级）
            return {
                retrieval_status: 'generic',
                knowledge_payload: {
                    matched_formula: {
                        formula_name: '辨证调理（信息待补）', source_book: '通用参考',
                        description: '当前信息尚不足以精准匹配某一典籍方剂，建议从整体辨证、调和气血方向了解，具体诊疗请遵医嘱。',
                        composition: []
                    },
                    matched_herbs: [],
                    dietary_and_lifestyle_advice: { fruit_guidance: '饮食宜清淡温和，避免生冷油腻。', habit_guidance: '保持规律作息，适度运动。' }
                }
            };
        }

        // 草本知识卡 = 组成药材 ∪ 类目草本（去重），并解析 herb_id 用于点击联动
        const names = new Set((formula.composition || []).concat((cat.herbs || []).map(h => h.name)));
        const herbs = Array.from(names).map(name => {
            const id = nameToId[name] || '';
            const openable = !!(id && (kb.herbs || []).some(h => h.id === id));
            const h = (kb.herbs || []).find(x => x.id === id) || { name: name, oneLiner: '', id: id };
            const toxic = TOXIC_HERBS.indexOf(id) >= 0;
            return {
                herb_name: name, herb_id: id, herb_detail_id: openable ? id : '',
                openable: openable, has_toxicity: toxic,
                description: h.oneLiner || '典籍组成药材，详见原方记载。',
                toxicity_warning: toxic ? '⚠ 本药材具毒性，古籍记载需经炮制并久煎以降低毒性，严禁生用或擅自抓药使用。' : undefined
            };
        });

        return {
            retrieval_status: 'success',
            knowledge_payload: {
                matched_formula: {
                    formula_name: formula.formula_name, source_book: formula.source_book,
                    description: formula.formula_desc || '', tcm_explanation: formula.tcm_explanation,
                    composition: formula.composition || [], doctor_brief_template: formula.doctor_brief_template,
                    fruit: formula.fruit, habit: formula.habit
                },
                matched_herbs: herbs,
                dietary_and_lifestyle_advice: { fruit_guidance: formula.fruit || '', habit_guidance: formula.habit || '' }
            }
        };
    }

    // 模板填充（{{onset}}/{{primary}}/{{aggravating_note}}）
    function fillTemplate(tpl, vars) {
        return (tpl || '').replace(/\{\{\s*onset\s*\}\}/g, vars.onset || '')
            .replace(/\{\{\s*primary\s*\}\}/g, vars.primary || '')
            .replace(/\{\{\s*aggravating_note\s*\}\}/g, vars.aggravating_note || '');
    }
    // 由已选信息推导「加重因素」叙述
    function buildAggravating(answered) {
        const trig = [];
        answered.forEach(a => {
            if (a.dim === 'trigger') (a.tags || []).forEach(t => { if (!isNegativeLabel(t)) trig.push(t); });
        });
        if (trig.length) return '通常在' + trig.join('、') + '时更为明显。';
        return '（具体加重因素我会在就诊时再和您说明）';
    }

    // Skill 5 · Formatter（深度报告：病机译释 + 第一人称面诊话术 + 组成药材联动 + 精确 RAG）
    function skillFormatter(ctx, input) {
        const synthText = input.synthesized_symptom_text || '';
        const kp = input.knowledge_payload || {};
        const fm = kp.matched_formula || {};
        const herbs = kp.matched_herbs || [];
        const advice = kp.dietary_and_lifestyle_advice || {};

        // 通俗译释：优先用 formula.tcm_explanation（病机，严禁重复表征）
        const tcm_explanation = fm.tcm_explanation ||
            ('根据您整理的身体表现，相关中医方向可参考「' + (fm.formula_name || '温和调理') + '」所涉思路。以下为知识性整理，供您与医生沟通时参考。');
        // 面诊话术：第一人称，填充模板
        let doctor_brief = synthText;
        if (fm.doctor_brief_template) {
            doctor_brief = fillTemplate(fm.doctor_brief_template, {
                onset: '一段时间', primary: (input.primary_symptom || ''), aggravating_note: buildAggravating(input.answered || [])
            });
        }
        const herbLine = herbs.map(h => h.herb_name + (h.has_toxicity ? '（毒性药材，需遵医嘱）' : '')).join('、');
        // 组成药材 chips（与下方草本知识卡 ID 级强联动）
        const compositionChips = (fm.composition || []).map(name => {
            const h = herbs.find(x => x.herb_name === name);
            return { name: name, herb_id: h ? h.herb_id : '' };
        });

        const sections = {
            tcm_explanation_section: tcm_explanation,
            doctor_communication_brief: doctor_brief,
            matched_formula_section: {
                formula_name: fm.formula_name, source_book: fm.source_book,
                description: fm.description, composition: fm.composition || []
            },
            composition_chips: compositionChips,
            herb_knowledge_section: herbs,
            dietary_guidance_section: { fruit_advice: advice.fruit_guidance || '', drink_advice: advice.habit_guidance || '' },
            lifestyle_guidance_section: { habits: (advice.habit_guidance || '').split('。').map(s => s.trim()).filter(Boolean) },
            plain_text_copy_payload: [tcm_explanation, doctor_brief,
                fm.formula_name ? ('参考方剂：' + fm.formula_name + '（' + fm.source_book + '）') : '',
                herbLine, advice.fruit_guidance, advice.habit_guidance, DISCLAIMER].filter(Boolean).join('\n'),
            disclaimer: DISCLAIMER
        };
        const report = {
            report_id: 'REP_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Math.floor(Math.random() * 900 + 100),
            created_at: new Date().toISOString(),
            ui_card_payload: { card_type: 'final_health_report_card', report_title: '身体信号整理报告', sections: sections, disclaimer: DISCLAIMER }
        };
        return report;
    }

    /* ============================ 3. LocalMockDriver（实现 SkillDriver 接口） ============================ */
    const SKILL_DISPATCH = {
        safety_shield: skillSafetyShield,
        extractor: skillExtractor,
        clarifier: skillClarifier,
        synthesizer: skillSynthesizer,
        retriever: skillRetriever,
        formatter: skillFormatter
    };

    function LocalMockDriver() { this.mode = 'mock'; }
    LocalMockDriver.prototype.invoke = function (skillId, ctx, input) {
        const fn = SKILL_DISPATCH[skillId];
        if (!fn) return { ok: false, data: {}, fallback_used: true, meta: { latency_ms: 0.01 } };
        try {
            const data = fn(ctx, input || {});
            return { ok: true, data: data, fallback_used: false, meta: { latency_ms: 0.01, model: 'local-mock' } };
        } catch (e) {
            // 任意 Skill 异常 → 降级，不阻断流程
            return { ok: false, data: {}, fallback_used: true, meta: { latency_ms: 0.01, error: String(e) } };
        }
    };

    /* ============================ 4. 可插拔接缝 getDriver ============================ */
    function getDriver(mode) {
        mode = mode || (typeof window !== 'undefined' && window.__AGENT_DRIVER__) || 'mock';
        if (mode === 'cloud') {
            // 未来实现：CloudAPIDriver（需 API Key + 极小后端代理，密钥不下发前端）
            throw new Error('CloudAPIDriver 尚未实现：需配置 API Key 与后端代理（详见 contracts/mock-driver.md §4）。');
        }
        return new LocalMockDriver();
    }

    /* ============================ 5. 状态机会话编排（S0~S6） ============================ */
    function SymptomSession(driver) {
        this.driver = driver || getDriver('mock');
        this.reset();
    }
    SymptomSession.prototype.reset = function () {
        this.state = 'S0';
        this.round = 0;
        this.desc = '';
        this.extracted = [];
        this.answered = [];           // [{dim, tags:[], negative}]
        this.coveredDimensions = [];
        this.categoryId = null;
        this.clarifyQueue = [];
        this.queueIndex = 0;
        this.currentDim = null;
        this.currentOptions = [];
        this.confirmation = null;
        this.knowledge = null;
        this.report = null;
        this.ctx = buildCtx(this.driver);
    };
    // S0 → S1：用户提交描述
    SymptomSession.prototype.submitDescription = function (text) {
        this.desc = (text || '').trim();
        this.extracted = [];
        this.answered = [];
        this.round = 0;
        this.queueIndex = 0;
        this.currentDim = null;
        this.currentOptions = [];
        // Safety Shield 前置硬拦截
        const shield = this.driver.invoke('safety_shield', this.ctx, { user_raw_input: this.desc }).data;
        if (shield.blocked) { this.state = 'SAFETY_CUTOFF'; return { state: 'SAFETY_CUTOFF', data: shield }; }
        // Skill 1 提取（口语映射 + 类目命中 + 维度覆盖）
        const ext = this.driver.invoke('extractor', this.ctx, { user_raw_input: this.desc, historical_symptoms: [] }).data;
        this.extracted = ext.extracted_symptoms;
        this.coveredDimensions = ext.covered_dimensions;
        this.categoryId = ext.detected_category;
        // 构建双轨追问队列
        this.clarifyQueue = buildClarifyQueue(ext, getRag());
        // 进入 S2，发起首轮追问
        this.round = 1;
        const cl = this.driver.invoke('clarifier', this.ctx, {
            covered_dimensions: this.coveredDimensions, current_round: this.round,
            clarify_queue: this.clarifyQueue, queue_index: this.queueIndex
        }).data;
        this.currentDim = cl.ask_dimension;
        this.currentOptions = cl.option_cards;
        this.state = 'S2';
        return { state: 'S2', data: cl };
    };
    // S2：用户多选提交（tags 为数组；兼容单字符串）
    SymptomSession.prototype.answer = function (tags) {
        if (typeof tags === 'string') tags = [tags];
        tags = (tags || []).slice();
        const hasNeg = tags.some(isNegativeLabel);
        this.answered.push({ dim: this.currentDim, tags: tags, negative: hasNeg });
        this.round += 1;
        this.queueIndex += 1;
        // 队列耗尽 或 到达 Max Rounds → 收敛进 S3
        if (this.queueIndex >= this.clarifyQueue.length || this.round >= MAX_ROUNDS) return this._synthesize();
        const cl = this.driver.invoke('clarifier', this.ctx, {
            covered_dimensions: this.coveredDimensions, current_round: this.round,
            clarify_queue: this.clarifyQueue, queue_index: this.queueIndex
        }).data;
        if (!cl.should_continue) return this._synthesize();
        this.currentDim = cl.ask_dimension;
        this.currentOptions = cl.option_cards;
        this.state = 'S2';
        return { state: 'S2', data: cl };
    };
    SymptomSession.prototype._synthesize = function () {
        const syn = this.driver.invoke('synthesizer', this.ctx, { extracted_symptoms: this.extracted, answered: this.answered }).data;
        this.confirmation = syn;
        this.state = 'S3';
        return { state: 'S3', data: syn };
    };
    // S2 → S1：返回修改描述（保留并回显上一轮文字，允许增删）
    SymptomSession.prototype.backToEdit = function () {
        this.state = 'S1';
        return { state: 'S1', data: { desc: this.desc } };
    };
    // S3 → S4 → S5：确认后检索 + 渲染（S4 为骨架屏瞬态，业务侧处理）
    SymptomSession.prototype.confirm = function () {
        const p = this.confirmation && this.confirmation.ui_card_payload;
        const ret = this.driver.invoke('retriever', this.ctx, { category_id: this.categoryId }).data;
        this.knowledge = ret;
        const fmt = this.driver.invoke('formatter', this.ctx, {
            synthesized_symptom_text: p.synthesized_symptom_text,
            primary_symptom: p.primary_symptom,
            answered: this.answered,
            knowledge_payload: ret.knowledge_payload
        }).data;
        this.report = fmt;
        this.state = 'S5'; // S4（检索加载）由 UI 瞬态表现
        return { state: 'S5', data: fmt };
    };
    SymptomSession.prototype.restart = function () { this.reset(); return { state: 'S0' }; };

    /* ============================ 6. 导出 ============================ */
    return {
        RED_FLAGS: RED_FLAGS,
        FORBIDDEN_WORDS: FORBIDDEN_WORDS,
        MAX_ROUNDS: MAX_ROUNDS,
        MIN_ROUNDS: MIN_ROUNDS,
        CONVERGENCE_PASS: CONVERGENCE_PASS,
        TOXIC_HERBS: TOXIC_HERBS,
        DISCLAIMER: DISCLAIMER,
        FALLBACK_LABEL: FALLBACK_LABEL,
        getRag: getRag,
        LocalMockDriver: LocalMockDriver,
        getDriver: getDriver,
        SymptomSession: SymptomSession
    };
});
