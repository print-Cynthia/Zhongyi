/**
 * agent-engine.js — 身体信号整理 · 可插拔本地引擎（LocalMockDriver）
 *
 * 本文件实现《契约 1/2/3》（agents/contracts/）规定的：
 *   - 5 Skill + Safety Shield 的本地规则驱动（零 API / 零成本 / 强 Schema 合规）
 *   - 状态机 S0~S6 的编排（收敛分≥0.85 熔断、Max Rounds=5、红线切断、降级）
 *   - getDriver('mock'|'cloud') 可插拔接缝：未来切 CloudAPIDriver 业务代码零改动
 *
 * 双模：浏览器挂到 window.SymptomAgentEngine；Node 下 module.exports（供 QA 走查）。
 * 知识库：浏览器从全局 SYMPTOM_DATA / HERB_DATA 读取；Node 测试用 globalThis.__TEST_* 注入。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SymptomAgentEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ============================ 0. 红线 / 红牌 / 配置 ============================ */
    // 急症红牌词（compliance-rules.md §2，含少量常用同义以兜底）
    const RED_FLAGS = ['胸痛剧烈', '胸痛', '吐血', '呼吸困难', '剧烈头痛', '头痛伴呕吐', '昏迷', '大出血', '严重外伤', '急性中毒'];
    // 红线词（compliance-rules.md §3，用于检索时二次校验，本驱动仅记录）
    const FORBIDDEN_WORDS = ['确诊', '开方', '处方', '剂量', '治愈', '包好', '保证有效'];

    // 五维通用字典键（顺序即追问优先级）：[部位 | 性质寒热 | 饮食 | 二便 | 睡眠]
    const DIMENSIONS = ['body', 'property', 'diet', 'excretion', 'sleep'];
    const MAX_ROUNDS = 5;
    const MIN_ROUNDS = 2;            // 收敛硬下限：至少追问 2 轮，杜绝「1 轮假收敛」
    const CONVERGENCE_PASS = 0.85;

    // 毒性药材名录（静态强预警，命中即插入 toxicity_warning，不依赖模型）
    const TOXIC_HERBS = ['banxia', 'fuzi', 'mahuang', 'zhenzhu', 'cantui'];

    /* ============================ 1. 五维通用字典（零硬编码追问） ============================ */
    // 每个维度：detect=Extractor 扫描词；question=Clarifier 动态拼装问题；options=动态拼装选项卡。
    // 通用兜底选项 FALLBACK_OPTION 由 Clarifier 强制追加到每个追问卡片，绝不强求硬选。
    const DIMENSION_DICT = [
        {
            key: 'body', label: '部位',
            detect: ['头', '脑', '咽', '喉', '颈', '肩', '胸', '腹', '胃', '腰', '背', '腿', '膝', '关节', '皮肤', '眼', '鼻', '耳', '牙', '心', '肋'],
            question: '主要在哪些部位感到不适？',
            options: [
                { tag: 'dim_body_head', label: '头面（头痛 / 头晕 / 头胀）' },
                { tag: 'dim_body_throat', label: '咽喉（咽痛 / 异物感 / 干）' },
                { tag: 'dim_body_chest', label: '胸腹（胸闷 / 腹胀 / 隐痛）' },
                { tag: 'dim_body_limb', label: '腰膝肢体（酸沉 / 无力 / 关节）' },
                { tag: 'dim_body_skin', label: '皮肤（干 / 痒 / 疹）' }
            ]
        },
        {
            key: 'property', label: '性质寒热',
            detect: ['隐痛', '胀痛', '刺痛', '灼痛', '冷痛', '喜热', '喜冷', '怕冷', '怕热', '发热', '上火', '灼热', '酸痛', '重坠', '烦热', '口干', '口苦', '燥'],
            question: '这些不适的性质更偏向哪一种？',
            options: [
                { tag: 'dim_prop_cold', label: '喜暖喜按（怕冷怕凉、得热则舒）' },
                { tag: 'dim_prop_hot', label: '喜凉喜冷（怕热上火、得凉则舒）' },
                { tag: 'dim_prop_distend', label: '胀痛 / 闷胀为主' },
                { tag: 'dim_prop_fixed', label: '刺痛 / 固定痛为主' }
            ]
        },
        {
            key: 'diet', label: '饮食',
            detect: ['食欲', '胃口', '纳差', '挑食', '油腻', '辛辣', '生冷', '腹胀', '反酸', '恶心', '消化', '没胃口', '吃不下', '偏食', '贪凉'],
            question: '最近的饮食与消化情况如何？',
            options: [
                { tag: 'dim_diet_poor', label: '食欲不振 / 吃不多' },
                { tag: 'dim_diet_greasy', label: '喜辛辣油腻、易上火' },
                { tag: 'dim_diet_cold', label: '喜生冷凉饮' },
                { tag: 'dim_diet_bloat', label: '食后腹胀 / 不消化 / 反酸' }
            ]
        },
        {
            key: 'excretion', label: '二便',
            detect: ['大便', '便秘', '干结', '便溏', '腹泻', '拉肚子', '小便', '尿频', '尿黄', '黏腻', '排便'],
            question: '二便情况更接近哪一种？',
            options: [
                { tag: 'dim_exc_constip', label: '大便干结 / 便秘' },
                { tag: 'dim_exc_loose', label: '大便稀溏 / 腹泻' },
                { tag: 'dim_exc_urine_yellow', label: '小便黄少 / 尿黄' },
                { tag: 'dim_exc_urine_clear', label: '小便清长 / 夜尿多' }
            ]
        },
        {
            key: 'sleep', label: '睡眠',
            detect: ['失眠', '多梦', '入睡', '早醒', '睡不', '易醒', '嗜睡', '心烦睡不着', '睡不好', '睡不稳'],
            question: '睡眠与精神状况怎样？',
            options: [
                { tag: 'dim_sleep_hard', label: '入睡困难 / 睡不好' },
                { tag: 'dim_sleep_dream', label: '多梦易醒' },
                { tag: 'dim_sleep_early', label: '早醒 / 醒后难再睡' },
                { tag: 'dim_sleep_tired', label: '精神倦怠 / 乏力嗜睡' }
            ]
        }
    ];
    // 选项 tag → 展示文案（供 Synthesizer 结构化输出）
    const DIM_OPTION_LABEL = {};
    DIMENSION_DICT.forEach(d => d.options.forEach(o => { DIM_OPTION_LABEL[o.tag] = o.label; }));
    // 选项 tag → 脏腑倾向（供 Retriever 方剂选择，增强智能度）
    const DIM_TO_TENDENCY = {
        dim_prop_hot: '去火', dim_prop_distend: '去火', dim_prop_fixed: '去火',
        dim_body_head: '去火', dim_body_throat: '去火', dim_body_skin: '去火', dim_exc_constip: '去火', dim_exc_urine_yellow: '去火', dim_diet_greasy: '去火',
        dim_prop_cold: '补气', dim_diet_poor: '补气', dim_sleep_tired: '补气', dim_body_limb: '补气',
        dim_diet_bloat: '健脾', dim_diet_cold: '健脾', dim_exc_loose: '健脾', dim_exc_urine_clear: '健脾', dim_body_chest: '健脾',
        dim_sleep_hard: '安神', dim_sleep_dream: '安神', dim_sleep_early: '安神'
    };
    // 通用兜底选项（强制追加到每个追问卡片，绝不强迫硬选）
    const FALLBACK_OPTION = { tag: 'dim_none', label: '以上均无 / 无上述情况', negative: true };

    // 倾向 → 方剂 / 食疗（古籍参考为知识性整理，非处方）。
    // composition = 典籍组成药材（string[]），用于前端「组成药材」强联动映射（Cpo 阶段 2 整改要求）。
    const FORMULA_MAP = {
        '去火': {
            formula_name: '半夏泻心汤（参考）', source_book: '《伤寒论》',
            formula_desc: '常用于寒热错杂、心下痞满、口苦恶心等方向的知识参考（含毒性药材半夏，须炮制久煎）。',
            composition: ['半夏', '黄芩', '黄连', '干姜', '人参', '大枣', '甘草'],
            fruit: '当前偏热象，宜食梨、绿豆等清凉食材，少食辛辣油炸。', habit: '多饮水，避免熬夜与过度劳累。'
        },
        '补气': {
            formula_name: '四君子汤（参考）', source_book: '《太平惠民和剂局方》',
            formula_desc: '常用于脾胃气虚、乏力气短者的知识参考。',
            composition: ['党参', '白术', '茯苓', '甘草'],
            fruit: '宜食山药、小米等健脾益气食材。', habit: '适度运动，避免过度劳累。'
        },
        '安神': {
            formula_name: '酸枣仁汤（参考）', source_book: '《金匮要略》',
            formula_desc: '常用于虚烦不眠、心悸多梦者的知识参考。',
            composition: ['酸枣仁', '茯苓', '知母', '川芎', '甘草'],
            fruit: '睡前宜温水泡脚，避免咖啡因与睡前刷手机。', habit: '规律作息，营造安静睡眠环境。'
        },
        '健脾': {
            formula_name: '参苓白术散（参考）', source_book: '《太平惠民和剂局方》',
            formula_desc: '常用于脾胃虚弱、食少便溏者的知识参考。',
            composition: ['党参', '茯苓', '白术', '山药', '薏苡仁', '莲子'],
            fruit: '宜食山药、薏苡仁等健脾食材，少食生冷黏腻。', habit: '餐后散步，注意腹部保暖。'
        }
    };

    const DISCLAIMER = '提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。';

    /* ============================ 2. 知识库读取 ============================ */
    function getKB() {
        return {
            symptom: (typeof SYMPTOM_DATA !== 'undefined') ? SYMPTOM_DATA : (globalThis.__TEST_SYMPTOM__ || []),
            herbs: (typeof HERB_DATA !== 'undefined') ? HERB_DATA : (globalThis.__TEST_HERB__ || []),
            nameToId: (typeof CABINET_DATA !== 'undefined') ? CABINET_DATA : (globalThis.__TEST_NAME_TO_ID__ || {})
        };
    }

    /* ============================ 3. 工具函数 ============================ */
    // 脏腑倾向推断：综合「自由描述命中的症状关键词」+「追问阶段选中的维度选项」，评分取最高 group。
    function inferTendency(extracted, answered) {
        const kb = getKB();
        const score = {};
        (extracted || []).forEach(s => { score[s.standard_tag] = (score[s.standard_tag] || 0) + 2; });
        (answered || []).forEach(a => { const g = DIM_TO_TENDENCY[a.tag]; if (g) score[g] = (score[g] || 0) + 1; });
        let best = '健脾', bestScore = 0;
        Object.keys(score).forEach(g => { if (score[g] > bestScore) { bestScore = score[g]; best = g; } });
        return (kb.symptom || []).some(x => x.name === best) ? best : (bestScore > 0 ? best : '健脾');
    }

    function buildCtx(driver) {
        return {
            session_id: 'sess_' + Math.random().toString(36).slice(2, 10),
            round: 0,
            max_rounds: MAX_ROUNDS,
            driver: 'mock',
            knowledge_base: getKB(),
            red_list: RED_FLAGS,
            forbidden_words: FORBIDDEN_WORDS
        };
    }

    /* ============================ 4. 各 Skill 的 Mock 实现 ============================ */
    function skillSafetyShield(ctx, input) {
        const text = input.user_raw_input || '';
        const matched = RED_FLAGS.filter(f => text.indexOf(f) >= 0);
        if (matched.length) {
            return {
                blocked: true, matched_red_flags: matched,
                compliance_card: '⚠ 安全提示：检测到您描述的症状可能属于急性或重症健康风险。本系统仅作轻量级健康整理，无法提供急救或临床诊断。请立即拨打急救电话或前往最近的医院急诊科就医！'
            };
        }
        return { blocked: false, matched_red_flags: [] };
    }

    function skillExtractor(ctx, input) {
        const text = input.user_raw_input || '';
        const kb = getKB();
        // 1) 症状关键词 → 标准标签 + 脏腑倾向（去重到 group 粒度）
        const extracted = [];
        const seenGroup = new Set();
        (kb.symptom || []).forEach(g => {
            (g.keywords || []).forEach(k => {
                if (text.indexOf(k) >= 0 && !seenGroup.has(g.name)) {
                    extracted.push({ raw_phrase: k, standard_tag: g.name, detail: k, confidence: 0.9 });
                    seenGroup.add(g.name);
                }
            });
        });
        // 2) 五维覆盖扫描：标记已覆盖维度
        const covered = [];
        DIMENSION_DICT.forEach(d => { if (d.detect.some(k => text.indexOf(k) >= 0)) covered.push(d.key); });
        const missing = DIMENSION_DICT.filter(d => covered.indexOf(d.key) < 0).map(d => d.key);
        const completeness = covered.length < 2 ? 'low' : (covered.length <= 3 ? 'medium' : 'high');
        return { extracted_symptoms: extracted, covered_dimensions: covered, missing_dimensions: missing, overall_completeness: completeness };
    }

    function skillClarifier(ctx, input) {
        const round = input.current_round;
        const answered = input.answered || [];
        // 已满足维度 = 初始文本覆盖维度 + 已被追问作答的维度（作答即视为已处理，含「以上均无」）
        const satisfied = new Set(input.covered_dimensions || []);
        answered.forEach(a => { if (a.dim && satisfied.has(a.dim) === false) satisfied.add(a.dim); });

        const missingOrder = DIMENSION_DICT.filter(d => !satisfied.has(d.key));
        const coveredCount = satisfied.size;
        // 收敛分：0.3 + 0.15*已覆盖维度数 + 0.1*轮次（Cpo 阶段 2 整改公式）
        const score = Math.min(1, 0.3 + 0.15 * coveredCount + 0.1 * round);
        // 硬下限：round < MIN_ROUNDS 必继续；否则需 score≥0.85 且未达上限才收敛
        const shouldContinue = (round < MIN_ROUNDS) ? true : (round < MAX_ROUNDS && score < CONVERGENCE_PASS);

        let dimToAsk = missingOrder[0];
        let question, options;
        if (dimToAsk) {
            question = dimToAsk.question;
            options = dimToAsk.options.concat([FALLBACK_OPTION]);
        } else {
            // 五维全已处理，仍须补足最小轮次 → 通用补漏追问（含兜底）
            dimToAsk = null;
            question = '为了更完整，是否还有其他想补充的身体表现？';
            options = [FALLBACK_OPTION, { tag: 'dim_prop_hot', label: '还有怕热 / 上火' }, { tag: 'dim_sleep_dream', label: '还有睡眠差 / 多梦' }];
        }
        return {
            should_continue: shouldContinue,
            ask_dimension: dimToAsk ? dimToAsk.key : null,
            question_text: question,
            option_cards: options.map(o => ({ label: o.label, tag: o.tag, negative: !!o.negative })),
            convergence_score: Number(score.toFixed(2))
        };
    }

    function skillSynthesizer(ctx, input) {
        const extracted = input.extracted_symptoms || [];
        const answered = input.answered || [];
        const posFromText = [];
        extracted.forEach(s => { if (posFromText.indexOf(s.standard_tag) < 0) posFromText.push(s.standard_tag); });
        const posFromAns = answered.filter(a => !a.negative).map(a => DIM_OPTION_LABEL[a.tag] || a.tag);
        const negFromAns = answered.filter(a => a.negative).map(a => DIM_OPTION_LABEL[a.tag] || a.dim);
        const primary = posFromText[0] || posFromAns[0] || '相关身体表现';
        const associated = posFromText.slice(1).concat(posFromAns.slice(1));
        const confirmed_negative = negFromAns;
        const parts = ['主要表现为' + primary];
        if (associated.length) parts.push('伴 ' + associated.join('、'));
        if (confirmed_negative.length) parts.push(confirmed_negative.join('、') + '（已排除 / 无异常）');
        const synthText = parts.join('；') + '。';
        return {
            summary_status: 'ready_for_confirmation',
            ui_card_payload: {
                card_type: 'symptom_summary_confirmation_card',
                card_title: '您的身体信号已整理完毕',
                primary_symptom: primary,
                associated_symptoms: associated,
                confirmed_negative: confirmed_negative,
                synthesized_symptom_text: synthText,
                action_buttons: [
                    { label: '确认无误，生成报告', action: 'trigger_skill_4', type: 'primary' },
                    { label: '补充 / 修改描述', action: 'edit_symptoms', type: 'secondary' }
                ]
            }
        };
    }

    function skillRetriever(ctx, input) {
        const kb = getKB();
        const tags = input.confirmed_tags || [];
        let groupName = input.zangfu_tendency || '';
        if (!FORMULA_MAP[groupName]) {
            const g = (kb.symptom || []).find(x => (x.keywords || []).some(k => tags.indexOf(k) >= 0));
            groupName = g ? g.name : '';
        }
        let payload;
        if (FORMULA_MAP[groupName]) {
            const fm = FORMULA_MAP[groupName];
            const nameToId = kb.nameToId || {};
            // 组成药材 → 草本知识卡（ID 级强联动：composition 名称解析为 herb_id）
            const herbs = (fm.composition || []).map(name => {
                const id = nameToId[name] || ('hb_' + name);
                const h = (kb.herbs || []).find(x => x.id === id) || { name: name, oneLiner: '', id: id };
                const toxic = TOXIC_HERBS.indexOf(id) >= 0;
                const openable = !!((kb.herbs || []).find(x => x.id === id));
                return {
                    herb_name: name, herb_id: id, herb_detail_id: openable ? id : '',
                    router_path: openable ? ('/herb-query/detail?id=' + id) : '',
                    description: h.oneLiner || '典籍组成药材，详见原方记载。',
                    has_toxicity: toxic, openable: openable,
                    toxicity_warning: toxic ? '⚠ 本药材具毒性，古籍记载需经炮制并久煎以降低毒性，严禁生用或擅自抓药使用。' : undefined
                };
            });
            payload = {
                matched_formula: { formula_name: fm.formula_name, source_book: fm.source_book, description: fm.formula_desc, composition: fm.composition || [] },
                matched_herbs: herbs,
                dietary_and_lifestyle_advice: { fruit_guidance: fm.fruit, habit_guidance: fm.habit }
            };
        } else {
            // 空数据兜底：通用温和调理方向
            payload = {
                matched_formula: { formula_name: '健脾理气（温和调理方向）', source_book: '通用参考', description: '未精准匹配特定古籍方剂时，建议从健脾理气、温和调理方向了解，具体请遵医嘱。', composition: [] },
                matched_herbs: [],
                dietary_and_lifestyle_advice: { fruit_guidance: '饮食宜清淡温和，避免生冷油腻。', habit_guidance: '保持规律作息，适度运动。' }
            };
        }
        return { retrieval_status: 'success', knowledge_payload: payload };
    }

    function skillFormatter(ctx, input) {
        const synthText = input.synthesized_symptom_text || '';
        const kp = input.knowledge_payload || {};
        const fm = kp.matched_formula || {};
        const herbs = kp.matched_herbs || [];
        const advice = kp.dietary_and_lifestyle_advice || {};

        const tcm_explanation = '根据您整理的身体表现（' + synthText + '），相关中医方向可参考「' + (fm.formula_name || '温和调理') + '」所涉思路。以下为知识性整理，供您与医生沟通时参考。';
        const doctor_brief = '医生您好，我近期的主要表现是：' + synthText + ' 想请医生结合专业检查进一步判断。';
        const herbLine = herbs.map(h => h.herb_name + (h.has_toxicity ? '（毒性药材，需遵医嘱）' : '')).join('、');

        const sections = {
            tcm_explanation_section: tcm_explanation,
            doctor_communication_brief: doctor_brief,
            matched_formula_section: fm,
            herb_knowledge_section: herbs,
            dietary_guidance_section: { fruit_advice: advice.fruit_guidance || '', drink_advice: advice.habit_guidance || '' },
            lifestyle_guidance_section: { habits: (advice.habit_guidance || '').split('。').map(s => s.trim()).filter(Boolean) },
            plain_text_copy_payload: [tcm_explanation, doctor_brief, fm.formula_name ? ('参考方剂：' + fm.formula_name + '（' + fm.source_book + '）') : '', herbLine, advice.fruit_guidance, advice.habit_guidance, DISCLAIMER].filter(Boolean).join('\n'),
            disclaimer: DISCLAIMER
        };
        const report = {
            report_id: 'REP_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '_' + Math.floor(Math.random() * 900 + 100),
            created_at: new Date().toISOString(),
            ui_card_payload: { card_type: 'final_health_report_card', report_title: '身体信号整理报告', sections: sections, disclaimer: DISCLAIMER }
        };
        return report;
    }

    /* ============================ 5. LocalMockDriver（实现 SkillDriver 接口） ============================ */
    const SKILL_DISPATCH = {
        safety_shield: skillSafetyShield,
        extractor: skillExtractor,
        clarifier: skillClarifier,
        synthesizer: skillSynthesizer,
        retriever: skillRetriever,
        formatter: skillFormatter
    };

    function LocalMockDriver() {
        this.mode = 'mock';
    }
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

    /* ============================ 6. 可插拔接缝 getDriver ============================ */
    function getDriver(mode) {
        mode = mode || (typeof window !== 'undefined' && window.__AGENT_DRIVER__) || 'mock';
        if (mode === 'cloud') {
            // 未来实现：CloudAPIDriver（需 API Key + 极小后端代理，密钥不下发前端）
            throw new Error('CloudAPIDriver 尚未实现：需配置 API Key 与后端代理（详见 contracts/mock-driver.md §4）。');
        }
        return new LocalMockDriver();
    }

    /* ============================ 7. 状态机会话编排（S0~S6） ============================ */
    function SymptomSession(driver) {
        this.driver = driver || getDriver('mock');
        this.reset();
    }
    SymptomSession.prototype.reset = function () {
        this.state = 'S0';
        this.round = 0;
        this.desc = '';
        this.extracted = [];
        this.answered = [];           // [{tag, dim, negative}]
        this.coveredDimensions = [];
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
        this.currentDim = null;
        this.currentOptions = [];
        // Safety Shield 前置硬拦截
        const shield = this.driver.invoke('safety_shield', this.ctx, { user_raw_input: this.desc }).data;
        if (shield.blocked) { this.state = 'SAFETY_CUTOFF'; return { state: 'SAFETY_CUTOFF', data: shield }; }
        // Skill 1 提取（五维覆盖 + 脏腑倾向）
        const ext = this.driver.invoke('extractor', this.ctx, { user_raw_input: this.desc, historical_symptoms: [] }).data;
        this.extracted = ext.extracted_symptoms;
        this.coveredDimensions = ext.covered_dimensions;
        // 进入 S2，发起首轮追问
        this.round = 1;
        const cl = this.driver.invoke('clarifier', this.ctx, { covered_dimensions: this.coveredDimensions, current_round: this.round, answered: this.answered }).data;
        this.currentDim = cl.ask_dimension;
        this.currentOptions = cl.option_cards;
        this.state = 'S2';
        return { state: 'S2', data: cl };
    };
    // S2：用户选择一项追问（带防重复点击由前端负责）
    SymptomSession.prototype.answer = function (tag) {
        const opt = (this.currentOptions || []).find(o => o.tag === tag) || { tag: tag, negative: false };
        this.answered.push({ tag: tag, dim: this.currentDim, negative: !!opt.negative });
        this.round += 1;
        // 硬停止：达到 Max Rounds 强制收敛到 S3（契约 state-machine.md：Max Rounds = 5 硬停）
        if (this.round >= MAX_ROUNDS) return this._synthesize();
        const cl = this.driver.invoke('clarifier', this.ctx, { covered_dimensions: this.coveredDimensions, current_round: this.round, answered: this.answered }).data;
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
        const tags = []
            .concat(p && p.primary_symptom ? [p.primary_symptom] : [])
            .concat(p && p.associated_symptoms ? p.associated_symptoms : []);
        const tendency = inferTendency(this.extracted, this.answered);
        const ret = this.driver.invoke('retriever', this.ctx, { zangfu_tendency: tendency, confirmed_tags: tags }).data;
        this.knowledge = ret;
        const fmt = this.driver.invoke('formatter', this.ctx, {
            synthesized_symptom_text: p.synthesized_symptom_text,
            confirmed_tags: tags, knowledge_payload: ret.knowledge_payload
        }).data;
        this.report = fmt;
        this.state = 'S5'; // S4（检索加载）由 UI 瞬态表现
        return { state: 'S5', data: fmt };
    };
    SymptomSession.prototype.restart = function () { this.reset(); return { state: 'S0' }; };

    /* ============================ 8. 导出 ============================ */
    return {
        RED_FLAGS: RED_FLAGS,
        FORBIDDEN_WORDS: FORBIDDEN_WORDS,
        DIMENSIONS: DIMENSIONS,
        DIMENSION_DICT: DIMENSION_DICT,
        MAX_ROUNDS: MAX_ROUNDS,
        MIN_ROUNDS: MIN_ROUNDS,
        CONVERGENCE_PASS: CONVERGENCE_PASS,
        TOXIC_HERBS: TOXIC_HERBS,
        DISCLAIMER: DISCLAIMER,
        FORMULA_MAP: FORMULA_MAP,
        LocalMockDriver: LocalMockDriver,
        getDriver: getDriver,
        SymptomSession: SymptomSession
    };
});
