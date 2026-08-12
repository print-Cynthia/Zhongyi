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

    const DIMENSIONS = ['部位与主诉', '寒热与汗出', '饮食与消化', '二便特征', '睡眠与精神'];
    const MAX_ROUNDS = 5;
    const CONVERGENCE_PASS = 0.85;

    // 毒性药材名录（静态强预警，命中即插入 toxicity_warning，不依赖模型）
    const TOXIC_HERBS = ['banxia', 'fuzi', 'mahuang', 'zhenzhu', 'cantui'];

    /* ============================ 1. 五维关键词映射 ============================ */
    // [口语短语, 标准标签, 维度]
    const KEYWORD_MAP = [
        ['头痛', '头面不适', '部位与主诉'], ['头疼', '头面不适', '部位与主诉'],
        ['咽痛', '咽喉不适', '部位与主诉'], ['喉咙痛', '咽喉不适', '部位与主诉'],
        ['胃胀', '食后腹胀', '饮食与消化'], ['肚子胀', '食后腹胀', '饮食与消化'], ['腹胀', '食后腹胀', '饮食与消化'],
        ['胃痛', '腹部隐痛', '部位与主诉'], ['肚子痛', '腹部隐痛', '部位与主诉'], ['腹痛', '腹部隐痛', '部位与主诉'],
        ['腰痛', '腰部不适', '部位与主诉'], ['腰酸', '腰部不适', '部位与主诉'],
        ['口苦', '口干口苦', '饮食与消化'], ['口燥', '口干口苦', '饮食与消化'], ['口干', '口干口苦', '饮食与消化'],
        ['怕冷', '恶寒', '寒热与汗出'], ['怕热', '发热', '寒热与汗出'],
        ['手脚冰冷', '手足冰冷', '寒热与汗出'], ['手足冷', '手足冰冷', '寒热与汗出'],
        ['五心烦热', '五心烦热', '寒热与汗出'], ['盗汗', '盗汗', '寒热与汗出'], ['自汗', '自汗', '寒热与汗出'],
        ['食欲不振', '食欲不振', '饮食与消化'], ['没胃口', '食欲不振', '饮食与消化'], ['胃口差', '食欲不振', '饮食与消化'],
        ['消化不好', '消化不良', '饮食与消化'], ['消化不良', '消化不良', '饮食与消化'],
        ['喜热饮', '喜热饮', '饮食与消化'], ['喜冷饮', '喜冷饮', '饮食与消化'],
        ['大便干', '大便干结', '二便特征'], ['便秘', '大便干结', '二便特征'], ['大便干结', '大便干结', '二便特征'],
        ['大便稀', '大便溏薄', '二便特征'], ['便溏', '大便溏薄', '二便特征'], ['拉肚子', '大便溏薄', '二便特征'], ['大便溏', '大便溏薄', '二便特征'],
        ['大便黏', '大便黏腻', '二便特征'], ['黏腻', '大便黏腻', '二便特征'],
        ['小便黄', '小便黄赤', '二便特征'], ['尿黄', '小便黄赤', '二便特征'],
        ['夜尿', '夜尿频多', '二便特征'], ['起夜', '夜尿频多', '二便特征'],
        ['失眠', '入睡困难', '睡眠与精神'], ['睡不好', '入睡困难', '睡眠与精神'], ['睡不着', '入睡困难', '睡眠与精神'],
        ['多梦', '多梦易醒', '睡眠与精神'],
        ['易醒', '多梦易醒', '睡眠与精神'], ['容易醒', '多梦易醒', '睡眠与精神'],
        ['精神倦怠', '精神倦怠', '睡眠与精神'], ['没精神', '精神倦怠', '睡眠与精神'], ['疲倦', '精神倦怠', '睡眠与精神'],
        ['心烦', '易怒烦躁', '睡眠与精神'], ['烦躁', '易怒烦躁', '睡眠与精神'], ['容易烦躁', '易怒烦躁', '睡眠与精神'],
        ['乏力', '神疲乏力', '睡眠与精神'], ['没劲', '神疲乏力', '睡眠与精神'], ['没力气', '神疲乏力', '睡眠与精神'],
        ['气短', '气短', '睡眠与精神'], ['虚弱', '神疲乏力', '睡眠与精神'],
        ['上火', '热象', '寒热与汗出']
    ];

    // 选项标签 → 维度（用于收敛分累计）
    const OPTION_DIMENSION = {
        '怕冷': '寒热与汗出', '怕热': '寒热与汗出', '无明显偏向': '寒热与汗出',
        '偏干结': '二便特征', '偏稀溏': '二便特征', '黏腻': '二便特征', '正常': '二便特征',
        '入睡困难': '睡眠与精神', '容易醒': '睡眠与精神', '多梦': '睡眠与精神',
        '食欲不振': '饮食与消化', '食后腹胀': '饮食与消化',
        '头部': '部位与主诉', '胸胁': '部位与主诉', '脾胃/腹部': '部位与主诉', '腰肾': '部位与主诉'
    };

    // 维度 → 追问模板
    const CLARIFY_TEMPLATES = {
        '寒热与汗出': { q: '为了更准确，请问您平时更怕冷还是怕热？', opts: ['怕冷', '怕热', '无明显偏向'] },
        '二便特征': { q: '您的大便情况更接近哪一种？', opts: ['偏干结', '偏稀溏', '黏腻', '正常'] },
        '睡眠与精神': { q: '您的睡眠主要问题是？', opts: ['入睡困难', '容易醒', '多梦', '正常'] },
        '饮食与消化': { q: '您的胃口和消化情况如何？', opts: ['食欲不振', '食后腹胀', '正常'] },
        '部位与主诉': { q: '主要在哪些部位感到不适？', opts: ['头部', '胸胁', '脾胃/腹部', '腰肾'] }
    };

    // 倾向 → 方剂 / 食疗（古籍参考为知识性整理，非处方）
    const FORMULA_MAP = {
        '去火': { formula_name: '清胃散（参考）', source_book: '《医宗金鉴》', formula_desc: '常用于胃火炽盛、口苦咽痛等热象明显者的知识参考。', fruit: '当前偏热象，宜食梨、绿豆等清凉食材，少食辛辣油炸。', habit: '多饮水，避免熬夜与过度劳累。' },
        '补气': { formula_name: '四君子汤（参考）', source_book: '《太平惠民和剂局方》', formula_desc: '常用于脾胃气虚、乏力气短者的知识参考。', fruit: '宜食山药、小米等健脾益气食材。', habit: '适度运动，避免过度劳累。' },
        '安神': { formula_name: '酸枣仁汤（参考）', source_book: '《金匮要略》', formula_desc: '常用于虚烦不眠、心悸多梦者的知识参考。', fruit: '睡前宜温水泡脚，避免咖啡因与睡前刷手机。', habit: '规律作息，营造安静睡眠环境。' },
        '健脾': { formula_name: '参苓白术散（参考）', source_book: '《太平惠民和剂局方》', formula_desc: '常用于脾胃虚弱、食少便溏者的知识参考。', fruit: '宜食山药、薏苡仁等健脾食材，少食生冷黏腻。', habit: '餐后散步，注意腹部保暖。' }
    };

    const DISCLAIMER = '提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。';

    /* ============================ 2. 知识库读取 ============================ */
    function getKB() {
        return {
            symptom: (typeof SYMPTOM_DATA !== 'undefined') ? SYMPTOM_DATA : (globalThis.__TEST_SYMPTOM__ || []),
            herbs: (typeof HERB_DATA !== 'undefined') ? HERB_DATA : (globalThis.__TEST_HERB__ || [])
        };
    }

    /* ============================ 3. 工具函数 ============================ */
    function tendencyFromTags(tags) {
        const kb = getKB();
        let best = '健脾', bestScore = 0;
        (kb.symptom || []).forEach(g => {
            const overlap = (g.keywords || []).filter(k => tags.includes(k)).length;
            if (overlap > bestScore) { bestScore = overlap; best = g.name; }
        });
        return bestScore > 0 ? best : '健脾';
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
        const extracted = [];
        const hitDims = new Set();
        KEYWORD_MAP.forEach(([phrase, tag, dim]) => {
            if (text.indexOf(phrase) >= 0) {
                extracted.push({ raw_phrase: phrase, standard_tag: tag, category: dim, confidence: 0.9 });
                hitDims.add(dim);
            }
        });
        const missing = DIMENSIONS.filter(d => !hitDims.has(d));
        const completeness = extracted.length < 2 ? 'low' : (extracted.length <= 3 ? 'medium' : 'high');
        return { extracted_symptoms: extracted, missing_dimensions: missing, overall_completeness: completeness };
    }

    function skillClarifier(ctx, input) {
        const round = input.current_round;
        const answered = input.answered || [];
        const satisfied = new Set();
        (input.extracted_symptoms || []).forEach(s => satisfied.add(s.category));
        answered.forEach(a => { if (OPTION_DIMENSION[a]) satisfied.add(OPTION_DIMENSION[a]); });

        const missingOrder = DIMENSIONS.filter(d => !satisfied.has(d));
        const dimToAsk = missingOrder[0];
        let data;
        if (dimToAsk && CLARIFY_TEMPLATES[dimToAsk]) {
            const t = CLARIFY_TEMPLATES[dimToAsk];
            data = {
                should_continue: true,
                inference_hypothesis: tendencyFromTags((input.extracted_symptoms || []).map(s => s.standard_tag)),
                question_text: t.q,
                option_cards: t.opts.map(o => ({ label: o, tag: o }))
            };
        } else {
            data = {
                should_continue: true,
                inference_hypothesis: '',
                question_text: '为了更完整，是否还有其他想补充的身体表现？',
                option_cards: [{ label: '暂无其他', tag: '正常' }, { label: '怕冷', tag: '怕冷' }, { label: '睡眠差', tag: '多梦' }]
            };
        }
        const score = Math.min(1, 0.5 + 0.1 * round + 0.1 * satisfied.size);
        data.convergence_score = Number(score.toFixed(2));
        data.should_continue = score < CONVERGENCE_PASS && round < MAX_ROUNDS;
        return data;
    }

    function skillSynthesizer(ctx, input) {
        const all = input.all_collected_symptoms || [];
        const texts = all.map(s => s.standard_tag || s.raw_phrase).filter(Boolean);
        const primary = texts[0] || '相关身体表现';
        const secondary = texts.slice(1);
        const synthText = '主要表现为' + (texts.join('、') || '相关身体表现') + '。';
        return {
            summary_status: 'ready_for_confirmation',
            ui_card_payload: {
                card_type: 'symptom_summary_confirmation_card',
                card_title: '您的身体信号已整理完毕',
                synthesized_symptom_text: synthText,
                structured_tags: { primary_symptoms: [primary], secondary_symptoms: secondary },
                action_buttons: [
                    { label: '确认无误，生成报告', action: 'trigger_skill_4', type: 'primary' },
                    { label: '补充/修改描述', action: 'edit_symptoms', type: 'secondary' }
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
            const g = (kb.symptom || []).find(x => x.name === groupName);
            const herbIds = g ? g.herbs : [];
            const herbs = herbIds.map(id => {
                const h = (kb.herbs || []).find(x => x.id === id) || { name: id, oneLiner: '', id: id };
                const toxic = TOXIC_HERBS.indexOf(id) >= 0;
                return {
                    herb_name: h.name, herb_id: id, herb_detail_id: id,
                    router_path: '/herb-query/detail?id=' + id,
                    description: h.oneLiner || '',
                    has_toxicity: toxic,
                    toxicity_warning: toxic ? '⚠ 本药材具毒性，古籍记载需经炮制并久煎以降低毒性，严禁生用或擅自抓药使用。' : undefined
                };
            });
            payload = {
                matched_formula: { formula_name: fm.formula_name, source_book: fm.source_book, description: fm.formula_desc },
                matched_herbs: herbs,
                dietary_and_lifestyle_advice: { fruit_guidance: fm.fruit, habit_guidance: fm.habit }
            };
        } else {
            // 空数据兜底：通用温和调理方向
            payload = {
                matched_formula: { formula_name: '健脾理气（温和调理方向）', source_book: '通用参考', description: '未精准匹配特定古籍方剂时，建议从健脾理气、温和调理方向了解，具体请遵医嘱。' },
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
        this.answered = [];
        this.confirmation = null;
        this.knowledge = null;
        this.report = null;
        this.ctx = buildCtx(this.driver);
    };
    SymptomSession.prototype._buildCollected = function () {
        const arr = (this.extracted || []).map(s => ({ raw_phrase: s.raw_phrase, standard_tag: s.standard_tag, category: s.category, source: 'skill1' }));
        (this.answered || []).forEach((a, i) => arr.push({ raw_phrase: a, standard_tag: a, category: OPTION_DIMENSION[a] || '', source: 'skill2_round' + (i + 1) }));
        return arr;
    };
    // S0 → S1：用户提交描述
    SymptomSession.prototype.submitDescription = function (text) {
        this.desc = (text || '').trim();
        this.extracted = [];
        this.answered = [];
        this.round = 0;
        // Safety Shield 前置硬拦截
        const shield = this.driver.invoke('safety_shield', this.ctx, { user_raw_input: this.desc }).data;
        if (shield.blocked) { this.state = 'SAFETY_CUTOFF'; return { state: 'SAFETY_CUTOFF', data: shield }; }
        // Skill 1 提取
        const ext = this.driver.invoke('extractor', this.ctx, { user_raw_input: this.desc, historical_symptoms: [] }).data;
        this.extracted = ext.extracted_symptoms;
        // 进入 S2，发起首轮追问
        this.round = 1;
        const cl = this.driver.invoke('clarifier', this.ctx, { extracted_symptoms: this.extracted, current_round: this.round, answered: this.answered }).data;
        this.state = 'S2';
        return { state: 'S2', data: cl };
    };
    // S2：用户选择一项追问
    SymptomSession.prototype.answer = function (tag) {
        this.answered.push(tag);
        this.round += 1;
        // 硬停止：达到 Max Rounds 强制收敛到 S3（契约 state-machine.md：Max Rounds = 5 硬停）
        if (this.round >= MAX_ROUNDS) {
            const syn = this.driver.invoke('synthesizer', this.ctx, { all_collected_symptoms: this._buildCollected() }).data;
            this.confirmation = syn;
            this.state = 'S3';
            return { state: 'S3', data: syn };
        }
        const cl = this.driver.invoke('clarifier', this.ctx, { extracted_symptoms: this.extracted, current_round: this.round, answered: this.answered }).data;
        if (!cl.should_continue) {
            // Skill 3 收敛
            const syn = this.driver.invoke('synthesizer', this.ctx, { all_collected_symptoms: this._buildCollected() }).data;
            this.confirmation = syn;
            this.state = 'S3';
            return { state: 'S3', data: syn };
        }
        this.state = 'S2';
        return { state: 'S2', data: cl };
    };
    // S3 → S4 → S5：确认后检索 + 渲染（S4 为骨架屏瞬态，业务侧处理）
    SymptomSession.prototype.confirm = function () {
        const tags = []
            .concat((this.confirmation && this.confirmation.ui_card_payload.structured_tags.primary_symptoms) || [])
            .concat((this.confirmation && this.confirmation.ui_card_payload.structured_tags.secondary_symptoms) || []);
        const tendency = tendencyFromTags(this.extracted.map(s => s.standard_tag));
        const ret = this.driver.invoke('retriever', this.ctx, { zangfu_tendency: tendency, confirmed_tags: tags }).data;
        this.knowledge = ret;
        const fmt = this.driver.invoke('formatter', this.ctx, {
            synthesized_symptom_text: this.confirmation.ui_card_payload.synthesized_symptom_text,
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
        MAX_ROUNDS: MAX_ROUNDS,
        CONVERGENCE_PASS: CONVERGENCE_PASS,
        TOXIC_HERBS: TOXIC_HERBS,
        DISCLAIMER: DISCLAIMER,
        FORMULA_MAP: FORMULA_MAP,
        LocalMockDriver: LocalMockDriver,
        getDriver: getDriver,
        SymptomSession: SymptomSession
    };
});
