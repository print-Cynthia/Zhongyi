/**
 * agent-engine.js — 身体信号整理 · 可插拔本地引擎（LocalMockDriver） v2.1
 *
 * 本文件实现《契约 1/2/3》（agents/contracts/）规定的：
 *   - 5 Skill + Safety Shield 的本地规则驱动（零 API / 零成本 / 强 Schema 合规）
 *   - 状态机 S0~S6 的编排（Min Rounds=2 硬下限 / Max Rounds=5 硬停 / 红线切断 / 降级）
 *   - getDriver('mock'|'cloud') 可插拔接缝：未来切 CloudAPIDriver 业务代码零改动
 *
 * 5D 推理矩阵（CPO 终极指令 v1.43 注入）+ 部位信号容错层（v1.44：region_keywords×symptom_signals 自然语言容错）+ 词库全量扩充（v1.45：CPO 指令补齐 5 类 region_keywords/oral_synonyms，覆盖程度副词/方言/俗语变体，语料库 version 1.3）+ 全量三层特征网络（v1.46：FEATURE_TAXONOMY 三维加权归经，废除部位名词单一逻辑与瓜蒌薤白半夏汤硬编码兜底）：
 *   - 双轨追问：轨1 主诉专病细化（depth_prompts）→ 完备度<0.85 平滑进入轨2《十问篇》(global_inquiry)
 *   - 加权矩阵：Score = Σ专病Tag×25 + Σ十问Tag×15 − Σ相克Tag×20，遍历全部方剂取 Top1 与脏腑方向
 *   - 永远产出倾向性结论（严禁「信息待补」），score<25 标记 low_confidence
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
    // 急症红牌词（compliance-rules.md §2）：CPO 安全规则调优指令——原词库（胸痛剧烈 / 胸痛 / 胸好痛 /
    // 心口痛 / 胸口痛 / 胸疼 / 胸闷得慌 / 吐血 / 呼吸困难 / 剧烈头痛 / 头痛伴呕吐 / 昏迷 / 大出血 /
    // 严重外伤 / 急性中毒 / 休克 共 18 条）对正常问诊体验过于敏感（如“胸好痛”被直接拦截），
    // 经 CPO “全部去掉” 删减指令后此处清空：Safety Shield 函数与接线保留（red_list=[]），仅不再拦截，
    // 后续若需恢复重症拦截，直接回填词表即可，业务代码零改动。
    // 注：红线二次校验词 FORBIDDEN_WORDS（确诊/开方/处方/剂量/治愈/包好/保证有效）仍保留，仅做检索标注，不参与拦截。
    const RED_FLAGS = [];
    // 红线词（compliance-rules.md §3，用于检索时二次校验，本驱动仅记录）
    const FORBIDDEN_WORDS = ['确诊', '开方', '处方', '剂量', '治愈', '包好', '保证有效'];

    const MAX_ROUNDS = 5;
    const MIN_ROUNDS = 2;            // 收敛硬下限：至少追问 2 轮，杜绝「1 轮假收敛」
    const CONVERGENCE_PASS = 0.85;   // 收敛分展示阈值（仅展示，主约束为轮次）
    // 5D 推理矩阵 · 加权评分权重（CPO 终极指令）：Score = Σ专病Tag×25 + Σ十问Tag×15 − Σ相克Tag×20
    const W_ZHUAN = 25;     // 专病 Tag（来自本类目 depth_prompts）
    const W_SHIWEN = 15;    // 十问 Tag（来自 global_inquiry）
    const W_INCOMPAT = 20;  // 相克 Tag（与本病机相左）
    const COMPLETENESS_GATE = 0.85; // 专病追问后完备度阈值，低于此值才进入《十问篇》基础盘查
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
    // 构建 Tag 双向映射（tag ↔ 人类 label），覆盖全部 depth_prompts / global_inquiry 选项
    function buildTagMaps(rag) {
        const tagToLabel = {}, labelToTag = {};
        const absorb = (opts) => (opts || []).forEach(o => {
            if (o && typeof o === 'object' && o.tag) { tagToLabel[o.tag] = o.label || o.tag; labelToTag[o.label || o.tag] = o.tag; }
        });
        (rag.categories || []).forEach(c => { Object.keys(c.depth_prompts || {}).forEach(k => absorb(c.depth_prompts[k].options)); });
        Object.keys(rag.global_inquiry || {}).forEach(k => absorb(rag.global_inquiry[k].options));
        return { tagToLabel: tagToLabel, labelToTag: labelToTag };
    }
    // 归一化入参：UI 回传 tag，QA/旧链路可能回传 label，统一成 tag（兜底项保留 FALLBACK_LABEL）
    function normalizeTags(raw, maps) {
        return (raw || []).map(t => {
            if (t === FALLBACK_LABEL) return FALLBACK_LABEL;
            if (maps.tagToLabel[t]) return t;            // 已是 tag
            if (maps.labelToTag[t]) return maps.labelToTag[t]; // 是 label → 转 tag
            return t;                                    // 未知值原样保留
        });
    }
    // tag → 人类可读 label（供叙述 / 结论回显）
    function tagLabel(tag, maps) {
        if (typeof tag === 'string' && tag.indexOf('custom:') === 0) return tag.slice('custom:'.length); // 剥离自定义前缀，回显用户原话
        return (maps && maps.tagToLabel[tag]) || tag;
    }

    function buildCtx(driver) {
        return {
            session_id: 'sess_' + Math.random().toString(36).slice(2, 10),
            round: 0,
            max_rounds: MAX_ROUNDS,
            driver: 'mock',
            knowledge_base: getRag(),
            tag_maps: buildTagMaps(getRag()),
            red_list: RED_FLAGS,
            forbidden_words: FORBIDDEN_WORDS,
            driver: (driver && driver.mode) || 'mock'
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

    // ===================== 全量三层特征网络 · FEATURE_TAXONOMY（v1.46 CPO 指令） =====================
    // 废除「过度依赖解剖部位名词」的单一逻辑：每类目三维特征（解剖部位 / 动作·排泄·官能 / 全身·感知），
    // 加权计分：动作·排泄词(3) + 部位词(2) + 全身感知词(1)。初筛全 0 → 归经标记 pending（不硬绑任何类目）。
    // 注：原始指令心肺解剖含裸字「心」，因其极易误触（如「心情」），已收敛为心口/心前/心脏/心窝/胸骨等
    //     身体特异性部位词（仍覆盖「心口痛」等表达），属工程取舍，已在汇报中标注。
    const FT_W_ACTION = 3, FT_W_ANATOMY = 2, FT_W_SOMATIC = 1;
    const FEATURE_TAXONOMY = {
        xin_fei_xiong_xie: {
            name: '心肺胸胁',
            anatomy: ['胸', '心口', '心前', '胸口', '胸前', '胸腔', '膻中', '心脏', '左胸', '右胸', '胸口窝', '后背', '心窝', '胸骨', '肺'],
            action: ['喘', '咳', '痰', '气短', '气促', '喘息', '心慌', '心跳', '心悸', '绞痛', '压迫', '胸口发紧', '胸闷憋气', '心前区不适', '心烦不宁', '一口气上不来', '呼吸不上来', '砰砰跳'],
            somatic: ['一口气上不来', '呼吸不上来', '胸口发紧', '胸闷憋气', '心前区不适', '心烦不宁']
        },
        gan_dan_yu_jie: {
            name: '肝胆疏泄',
            anatomy: ['胁', '肋', '肝', '胆', '少腹', '乳房', '两肋', '侧腹', '头顶', '太阳穴', '肋下', '两胁'],
            action: ['叹气', '善太息', '发火', '易怒', '急躁', '烦躁', '郁闷', '憋屈', '口苦', '咽干', '嘴巴苦', '胀', '胀痛'],
            somatic: ['情绪激动', '两胁胀满', '情绪低落', '夜间情志不舒', '烦热']
        },
        pi_wei_yun_hua: {
            name: '脾胃运化',
            anatomy: ['胃', '腹', '肠', '脾', '脘', '肚', '脐', '中焦', '心下', '下腹', '小肚', '胃脘', '胃部', '肠胃', '小肚腩'],
            action: ['拉', '泻', '泄', '排便', '便', '屎', '大便', '溏', '窜稀', '跑厕所', '吐', '呕', '反酸', '烧心', '打嗝', '嗳气', '呃逆', '胀', '消化', '纳呆', '吃不下', '食少', '不思饮食', '恶心', '反胃', '咕噜'],
            somatic: ['口黏', '口甜', '口淡', '肢体困重', '便溏', '完谷不化', '大便粘']
        },
        shen_xi_shui_ye: {
            name: '肾系水液',
            anatomy: ['腰', '膝', '肾', '下肢', '腿', '脚', '足', '命门', '腰骶', '小腿', '眼皮', '脸', '眼袋'],
            action: ['尿', '夜尿', '起夜', '小便', '遗尿', '尿频', '浮肿', '水肿', '肿', '酸软', '无力', '腰酸'],
            somatic: ['畏寒', '怕冷', '手足冰冷', '手脚凉', '腰酸背痛', '动则气喘', '精神萎靡', '怎么也暖不热', '黑眼圈重', '没精神', '容易累']
        },
        biao_zheng_wai_gan: {
            name: '外感表证',
            anatomy: ['头', '额', '太阳穴', '后脑勺', '鼻', '咽', '喉', '嗓子', '皮毛', '骨节', '喉咙', '感冒', '着凉', '受风', '风一吹'],
            action: ['发热', '发烧', '恶寒', '恶风', '怕风', '打喷嚏', '喷嚏', '流涕', '鼻塞', '咽痛', '喉痛', '咳嗽', '出汗', '无汗', '浑身酸痛', '骨节酸疼', '嗓子干疼', '头痛', '头重如裹', '发冷打战', '肌肉酸痛', '发冷', '冷颤', '头重脚轻'],
            somatic: ['浑身酸痛', '骨节酸疼', '头重如裹', '发冷打战', '嗓子干疼', '头重脚轻']
        }
    };

    // Skill 1 · Extractor（三维特征矩阵加权归经 + 口语标准映射）
    function skillExtractor(ctx, input) {
        const text = input.user_raw_input || '';
        const rag = getRag();
        const matchedStandards = [];   // [{standard, dimension, raw}]（供叙述 / 维度覆盖）
        const covered = new Set();
        let bestCat = null, bestScore = 0, bestMaxLen = 0, bestStatus = 'pending';
        (rag.categories || []).forEach(cat => {
            // 1) 口语同义词 → 标准症状映射（轻量，仅用于叙述与维度覆盖）
            (cat.oral_synonyms || []).forEach(syn => {
                const hit = syn.oral.find(o => text.indexOf(o) >= 0);
                if (hit) {
                    matchedStandards.push({ standard: syn.standard, dimension: syn.dimension, raw: hit });
                    if (syn.dimension) covered.add(syn.dimension);
                }
            });
            // 2) 三维特征矩阵加权（核心归经逻辑）：动作/排泄(3) + 部位(2) + 全身感知(1)
            const ft = FEATURE_TAXONOMY[cat.id];
            let score = 0, maxLen = 0;
            if (ft) {
                ft.action.forEach(w => { if (text.indexOf(w) >= 0) { score += FT_W_ACTION; if (w.length > maxLen) maxLen = w.length; } });
                ft.anatomy.forEach(w => { if (text.indexOf(w) >= 0) { score += FT_W_ANATOMY; if (w.length > maxLen) maxLen = w.length; } });
                ft.somatic.forEach(w => { if (text.indexOf(w) >= 0) { score += FT_W_SOMATIC; if (w.length > maxLen) maxLen = w.length; } });
            }
            if (score > 0) covered.add('body');
            // 平局裁决：总分更高优先；同分则「最长匹配词」优先（避免裸单字抢占具体复合词，如「郁闷」归于肝胆而非心肺的裸「闷」）
            if (score > bestScore || (score === bestScore && score > 0 && maxLen > bestMaxLen)) {
                bestScore = score; bestMaxLen = maxLen; bestCat = cat; bestStatus = 'detected';
            }
        });
        const allDims = collectAllDims(rag);
        const missing = allDims.filter(d => !covered.has(d));
        const completeness = covered.size < 2 ? 'low' : (covered.size <= 3 ? 'medium' : 'high');
        return {
            detected_category: bestCat ? bestCat.id : null,
            detected_category_name: bestCat ? bestCat.name : null,
            category_status: bestStatus,   // 'detected' | 'pending'
            extracted_symptoms: matchedStandards,
            covered_dimensions: Array.from(covered),
            missing_dimensions: missing,
            overall_completeness: completeness
        };
    }

    // 构建双轨多组追问队列：轨1 主诉深度细化（类目 depth_prompts）→ 轨2 《十问篇》基础盘查（完备度<0.85 时进入）→ 补位
    function buildClarifyQueue(ext, rag) {
        const queue = [];
        const cat = (rag.categories || []).find(c => c.id === ext.detected_category) || null;
        if (cat) {
            Object.keys(cat.depth_prompts || {}).forEach(k => {
                const dp = cat.depth_prompts[k];
                queue.push({ track: 'T1', key: k, dim: dp.dimension, question: dp.question, options: dp.options });
            });
        }
        // 计算专病追问后的临时完备度（已覆盖维度 ∪ T1 维度）/ 全维度
        const allDims = collectAllDims(rag);
        const coveredNow = new Set(ext.covered_dimensions || []);
        queue.forEach(q => { if (q.dim) coveredNow.add(q.dim); });
        const completeness = allDims.length ? coveredNow.size / allDims.length : 1;
        // 轨2：仅当完备度仍低于阈值时，平滑进入《十问篇》基础盘查（盘查初始未覆盖维度，避免与轨1重复）
        if (completeness < COMPLETENESS_GATE) {
            const gOrder = ['寒热', '二便', '睡眠', '饮食'];
            gOrder.forEach(gk => {
                const gi = (rag.global_inquiry || {})[gk];
                if (gi && gi.dimension && !coveredNow.has(gi.dimension)) {
                    queue.push({ track: 'T2', key: gk, dim: gi.dimension, question: gi.question, options: gi.options });
                    coveredNow.add(gi.dimension);
                }
            });
        }
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
        // 每个选项独立成 tag：兼容 {label,tag} 对象与纯字符串；强制追加兜底（负向）+ 自定义补充入口
        const option_cards = (current.options || []).map(o => {
            if (o && typeof o === 'object') return { label: o.label || o.tag, tag: o.tag || o.label, negative: false };
            return { label: o, tag: o, negative: false };
        }).concat([{ label: FALLBACK_LABEL, tag: FALLBACK_LABEL, negative: true }])
          .concat([{ label: '我有其他情况要补充（可输入）', tag: '__CUSTOM__', custom: true, negative: false }]);
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
        const seenSel = new Set();
        answered.forEach(a => {
            const tags = a.tags || [];
            const hasNeg = tags.some(isNegativeLabel);
            tags.forEach(t => {
                if (!isNegativeLabel(t) && !seenSel.has(t)) {
                    seenSel.add(t);
                    posSelections.push(tagLabel(t, ctx.tag_maps));
                }
            });
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

    // Skill 4 · Retriever（5D 加权矩阵：遍历全部方剂 → Top1 倾向性结论，绝不「信息待补」）
    function skillRetriever(ctx, input) {
        const rag = getRag();
        const kb = getKB();
        const maps = ctx.tag_maps || buildTagMaps(rag);
        const selected = (input.selected_tags || []).filter(t => t !== FALLBACK_LABEL);
        const selectedSet = new Set(selected);
        const candidates = (input.candidate_tags || []).filter(t => t !== FALLBACK_LABEL && !selectedSet.has(t));
        const candidateSet = new Set(candidates);
        const detectedCat = input.category_id || null;

        // —— 5D 加权矩阵：Score = Σ专病Tag×25 + Σ十问Tag×15 − Σ相克Tag×20 ——
        let best = null;
        (rag.categories || []).forEach(cat => {
            (cat.formulas || []).forEach(f => {
                const zhuanSel = (f.zhuan_tags || []).filter(t => selectedSet.has(t));
                const shiwenSel = (f.shiwen_tags || []).filter(t => selectedSet.has(t));
                const incompatSel = (f.incompatible_tags || []).filter(t => selectedSet.has(t));
                // 候选 tag（LLM 预测但未直接勾选）作为软命中，权重降低，用于提升未精准归经时的召回
                const zhuanCand = (f.zhuan_tags || []).filter(t => candidateSet.has(t));
                const shiwenCand = (f.shiwen_tags || []).filter(t => candidateSet.has(t));
                const score = zhuanSel.length * W_ZHUAN + shiwenSel.length * W_SHIWEN - incompatSel.length * W_INCOMPAT
                    + zhuanCand.length * (W_ZHUAN / 2) + shiwenCand.length * (W_SHIWEN / 2);
                const cand = {
                    cat: cat, formula: f, score: score,
                    zhuan: zhuanSel, shiwen: shiwenSel, incompat: incompatSel,
                    zhuan_candidate: zhuanCand, shiwen_candidate: shiwenCand,
                    inDetected: (cat.id === detectedCat),
                    primary: (cat.primary_formula_id === f.id)
                };
                if (!best) { best = cand; return; }
                // 排序：score 降序；同分处理见下
                if (cand.score > best.score) { best = cand; return; }
                if (cand.score === best.score) {
                    if (detectedCat) {
                        // 有归经：脏腑亲和（detected）优先 → primary_formula 优先
                        if (cand.inDetected && !best.inDetected) { best = cand; return; }
                        if (cand.inDetected === best.inDetected && cand.primary && !best.primary) { best = cand; return; }
                    } else {
                        // 归经待定：废除「任意具体方剂默认胜出」，按命中 Tag 数更多优先（真·Tag 矩阵加权）
                        const cCnt = cand.zhuan.length + cand.shiwen.length + cand.incompat.length;
                        const bCnt = best.zhuan.length + best.shiwen.length + best.incompat.length;
                        if (cCnt > bCnt) { best = cand; return; }
                    }
                }
            });
        });

        // 废除硬编码兜底：归经待定（category_id 为 null）且加权矩阵无任何命中（score=0）时，
        // 严禁默认回退到具体古籍方剂（如「瓜蒌薤白半夏汤」），仅给中性整体调理方向 + low_confidence
        const noSignal = (detectedCat === null && best.score === 0);
        if (!best || !best.formula || noSignal) {
            return {
                retrieval_status: 'pending',
                knowledge_payload: {
                    matched_formula: {
                        formula_name: '整体辨证调理方向', source_book: '通用参考',
                        description: '当前信息尚不足以精准归经到某一脏腑方向，建议从整体调和气血、顾护脾胃方向了解，具体诊疗请遵医嘱。',
                        composition: []
                    },
                    matched_herbs: [],
                    bias_conclusion: {
                        category_id: null, category_name: '待归经', formula_name: '整体辨证调理方向',
                        score: 0, matched_zhuan_tags: [], matched_shiwen_tags: [], low_confidence: true,
                        conclusion_text: '当前描述信息较少，暂无法确定明确的脏腑方向与具体典籍方剂。建议补充更多身体表现后，由医生进一步辨证。'
                    },
                    dietary_and_lifestyle_advice: { fruit_guidance: '饮食宜清淡温和，避免生冷油腻。', habit_guidance: '保持规律作息，适度运动。' }
                }
            };
        }

        const cat = best.cat, formula = best.formula;
        const nameToId = buildNameToId(cat, kb);
        const lowConfidence = best.score < W_ZHUAN; // 无有效专病/十问命中 → 倾向性弱

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

        // 辨证倾向结论（供前端展示与话术参考）
        const matchedZhuan = best.zhuan.map(t => tagLabel(t, maps));
        const matchedShiwen = best.shiwen.map(t => tagLabel(t, maps));
        let conclusion;
        if (lowConfidence) {
            conclusion = '当前勾选的有效信号较少，下列为与您描述最接近的经典方向参考（倾向性较弱，建议补充问诊后由医生进一步辨证）。';
        } else if (matchedZhuan.length) {
            conclusion = '综合您勾选的专病特征（' + matchedZhuan.join('、') +
                (matchedShiwen.length ? '）与基础表现（' + matchedShiwen.join('、') + '）' : '）') +
                '，系统加权推理（Score=' + best.score + '）将其归为「' + cat.name + '」方向，最贴近典籍方剂「' + formula.formula_name + '」。';
        } else {
            conclusion = '依据您勾选的基础表现（' + matchedShiwen.join('、') +
                '），加权推理（Score=' + best.score + '）将其归为「' + cat.name + '」方向，最贴近「' + formula.formula_name + '」。';
        }

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
                bias_conclusion: {
                    category_id: cat.id, category_name: cat.name,
                    formula_name: formula.formula_name, source_book: formula.source_book,
                    score: best.score, matched_zhuan_tags: matchedZhuan, matched_shiwen_tags: matchedShiwen,
                    low_confidence: lowConfidence, conclusion_text: conclusion
                },
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
    // 由已选信息推导「加重因素」叙述（tag → 人类 label）
    function buildAggravating(answered, maps) {
        const trig = [];
        answered.forEach(a => {
            if (a.dim === 'trigger') (a.tags || []).forEach(t => { if (!isNegativeLabel(t)) trig.push(tagLabel(t, maps)); });
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
                onset: '一段时间', primary: (input.primary_symptom || ''), aggravating_note: buildAggravating(input.answered || [], ctx.tag_maps)
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
            bias_conclusion_section: kp.bias_conclusion || null,
            matched_formula_section: {
                formula_name: fm.formula_name, source_book: fm.source_book,
                description: fm.description, composition: fm.composition || []
            },
            composition_chips: compositionChips,
            herb_knowledge_section: herbs,
            dietary_guidance_section: { fruit_advice: advice.fruit_guidance || '', drink_advice: advice.habit_guidance || '' },
            lifestyle_guidance_section: { habits: (advice.habit_guidance || '').split('。').map(s => s.trim()).filter(Boolean) },
            plain_text_copy_payload: [tcm_explanation, doctor_brief,
                (kp.bias_conclusion ? ('辨证倾向：' + kp.bias_conclusion.conclusion_text) : ''),
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
            // CloudAPIDriver 由 drivers/cloud-driver.js 注入（window/globalThis），
            // 密钥仅来自前端 localStorage（tcm_api_key），源码零硬编码。
            var CloudDriver =
                (typeof window !== 'undefined' && window.CloudAPIDriver) ||
                (typeof globalThis !== 'undefined' && globalThis.CloudAPIDriver) ||
                (typeof CloudAPIDriver !== 'undefined' ? CloudAPIDriver : null);
            if (!CloudDriver) {
                throw new Error('CloudAPIDriver 未加载：请确认 drivers/cloud-driver.js 已在 agent-engine.js 之后引入。');
            }
            return new CloudDriver();
        }
        return new LocalMockDriver();
    }

    /* ============================ 5. 状态机会话编排（S0~S6） ============================ */
    function SymptomSession(driver) {
        this.driver = driver || getDriver('mock');
        this.async = !!(this.driver && this.driver.async);   // CloudAPIDriver=true；LocalMockDriver 不存在该字段 → 同步
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
        // 云端连接状态（仅 CloudAPIDriver 有意义）：'unknown' | 'ok' | 'degraded'
        this.cloudStatus = 'unknown';
        this.cloudError = '';
        this.askedDimensions = [];    // 云端动态追问：已问过的维度，避免重复
        this.ctx = buildCtx(this.driver);
    };
    // 记录一次 LLM 技能（extractor/formatter）的调用结果，供前端展示「接通 / 降级」状态
    SymptomSession.prototype._recordCloud = function (result) {
        if (!result || typeof result !== 'object') return;
        if (result.fallback_used) {
            this.cloudStatus = 'degraded';
            this.cloudError = (result.meta && result.meta.cloud_error) || '未知错误';
        } else if (result.ok) {
            if (this.cloudStatus !== 'degraded') this.cloudStatus = 'ok';
        }
    };
    // S0 → S1：用户提交描述
    SymptomSession.prototype.submitDescription = function (text) {
        if (this.async) return this._submitAsync(text);
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
    // 异步分支（CloudAPIDriver）：每个 invoke 返回 Promise，统一 await
    SymptomSession.prototype._submitAsync = async function (text) {
        this.desc = (text || '').trim();
        this.extracted = [];
        this.answered = [];
        this.round = 0;
        this.queueIndex = 0;
        this.currentDim = null;
        this.currentOptions = [];
        const shield = (await this.driver.invoke('safety_shield', this.ctx, { user_raw_input: this.desc })).data;
        if (shield.blocked) { this.state = 'SAFETY_CUTOFF'; return { state: 'SAFETY_CUTOFF', data: shield }; }
        const ext = await this.driver.invoke('extractor', this.ctx, { user_raw_input: this.desc, historical_symptoms: [] });
        this._recordCloud(ext);
        this.extracted = ext.data.extracted_symptoms;
        this.coveredDimensions = ext.data.covered_dimensions;
        this.missingDimensions = ext.data.missing_dimensions || [];
        this.candidateTags = ext.data.candidate_tags || [];
        this.categoryId = ext.data.detected_category;
        this.clarifyQueue = buildClarifyQueue(ext.data, getRag());
        this.round = 1;
        this.askedDimensions = [];
        const cl = (await this.driver.invoke('clarifier', this.ctx, {
            covered_dimensions: this.coveredDimensions, current_round: this.round,
            clarify_queue: this.clarifyQueue, queue_index: this.queueIndex,
            user_raw_input: this.desc, extracted: this.extracted, answered: [], max_rounds: MAX_ROUNDS,
            asked_dimensions: this.askedDimensions,
            candidate_tags: (ext.data && ext.data.candidate_tags) || [],
            missing_dimensions: (ext.data && ext.data.missing_dimensions) || []
        })).data;
        this.currentDim = cl.ask_dimension;
        this.currentOptions = cl.option_cards;
        this.state = 'S2';
        return { state: 'S2', data: cl };
    };
    // S2：用户多选提交（tags 为数组；兼容单字符串 / 标签或 tag 混用）
    SymptomSession.prototype.answer = function (tags) {
        if (this.async) return this._answerAsync(tags);
        if (typeof tags === 'string') tags = [tags];
        tags = normalizeTags((tags || []).slice(), this.ctx.tag_maps);
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
    SymptomSession.prototype._answerAsync = async function (tags) {
        if (typeof tags === 'string') tags = [tags];
        tags = normalizeTags((tags || []).slice(), this.ctx.tag_maps);
        const hasNeg = tags.some(isNegativeLabel);
        this.answered.push({ dim: this.currentDim, tags: tags, negative: hasNeg });
        if (this.currentDim && this.askedDimensions.indexOf(this.currentDim) < 0) this.askedDimensions.push(this.currentDim);
        this.round += 1;
        this.queueIndex += 1;
        if (this.round >= MAX_ROUNDS) return await this._synthesizeAsync();
        const cl = (await this.driver.invoke('clarifier', this.ctx, {
            covered_dimensions: this.coveredDimensions, current_round: this.round,
            clarify_queue: this.clarifyQueue, queue_index: this.queueIndex,
            user_raw_input: this.desc, extracted: this.extracted, answered: this.answered, max_rounds: MAX_ROUNDS,
            asked_dimensions: this.askedDimensions,
            candidate_tags: this.candidateTags || [],
            missing_dimensions: this.missingDimensions || []
        })).data;
        if (!cl.should_continue) return await this._synthesizeAsync();
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
    SymptomSession.prototype._synthesizeAsync = async function () {
        // 云端动态追问可能导致同类 tag 被重复勾选，收敛前按 (dim, tag) 去重，保证报告不重复罗列
        const seenTag = new Set();
        const seenNegDim = new Set();
        const deduped = [];
        (this.answered || []).forEach(a => {
            const dim = a.dim || '_';
            const tags = [];
            (a.tags || []).forEach(t => {
                if (isNegativeLabel(t)) {
                    if (!seenNegDim.has(dim)) {
                        seenNegDim.add(dim);
                        tags.push(t);
                    }
                } else {
                    const key = dim + ':' + t;
                    if (!seenTag.has(key)) {
                        seenTag.add(key);
                        tags.push(t);
                    }
                }
            });
            if (tags.length) deduped.push({ dim: dim, tags: tags, negative: tags.some(isNegativeLabel) });
        });
        const syn = (await this.driver.invoke('synthesizer', this.ctx, { extracted_symptoms: this.extracted, answered: deduped })).data;
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
        if (this.async) return this._confirmAsync();
        const p = this.confirmation && this.confirmation.ui_card_payload;
        // 汇总已选有效 Tag（排除兜底项），供 5D 加权矩阵评分
        const selectedTags = [];
        this.answered.forEach(a => { if (!a.negative) (a.tags || []).forEach(t => { if (t !== FALLBACK_LABEL) selectedTags.push(t); }); });
        // 检索增强：把抽取阶段 LLM 预测的候选 tag 作为软命中字段传入，不混入用户已选标签
        const candidateTags = [];
        (this.extracted || []).forEach(function (e) {
            (e.candidate_tags || []).forEach(function (t) {
                if (t !== FALLBACK_LABEL && candidateTags.indexOf(t) < 0) candidateTags.push(t);
            });
        });
        const ret = this.driver.invoke('retriever', this.ctx, { category_id: this.categoryId, selected_tags: selectedTags, candidate_tags: candidateTags }).data;
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
    SymptomSession.prototype._confirmAsync = async function () {
        const p = this.confirmation && this.confirmation.ui_card_payload;
        const selectedTags = [];
        this.answered.forEach(a => { if (!a.negative) (a.tags || []).forEach(t => { if (t !== FALLBACK_LABEL) selectedTags.push(t); }); });
        // 检索增强：把抽取阶段 LLM 预测的候选 tag 作为软命中字段传入，不混入用户已选标签
        const candidateTags = [];
        (this.extracted || []).forEach(function (e) {
            (e.candidate_tags || []).forEach(function (t) {
                if (t !== FALLBACK_LABEL && candidateTags.indexOf(t) < 0) candidateTags.push(t);
            });
        });
        const ret = (await this.driver.invoke('retriever', this.ctx, { category_id: this.categoryId, selected_tags: selectedTags, candidate_tags: candidateTags })).data;
        this.knowledge = ret;
        const fmt = await this.driver.invoke('formatter', this.ctx, {
            synthesized_symptom_text: p.synthesized_symptom_text,
            primary_symptom: p.primary_symptom,
            answered: this.answered,
            knowledge_payload: ret.knowledge_payload
        });
        this._recordCloud(fmt);
        this.report = fmt.data;
        this.state = 'S5';
        return { state: 'S5', data: fmt.data };
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
