/**
 * drivers/cloud-driver.js — 身体信号整理 · 云端大模型驱动（CloudAPIDriver）v1.49
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ 安全红线（CPO 综合架构指令，严格执行）                                    │
 * │ 1. 源码绝对零凭证：任何 API Key / 账号敏感信息均不得硬编码、不得写入     │
 * │    注释或 Mock 数据。本地凭证仅由前端界面手动输入，存于浏览器            │
 * │    localStorage（键名 tcm_api_key）。本文件不含任何真实密钥。            │
 * │ 2. Payload 脱敏：每次请求体仅包含「主诉文本 / 会话文本」与「检索命中的  │
 * │    静态知识」（典籍方剂、草本，属公开知识库，非用户 PII）。严禁附加设备  │
 * │    信息、IP、姓名、年龄等任何个人标识。                                  │
 * │ 3. 设计取舍说明：CPO 指令明确采用「前端输入 + localStorage」方案以支撑   │
 * │    个人 / 本地验证。浏览器直连厂商会令密钥暴露给客户端，仅适用于个人    │
 * │    本地使用；若上线为多用户生产环境，须按契约 mock-driver.md §4 改为    │
 * │    「极小后端代理」模式（密钥不下发前端）。本文件已将此约束以注释固化。  │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * 架构：Selective LLM（大模型负责抽取与润色，确定性引擎负责检索与安全）
 *   - Skill 1 Extractor   → 真大模型语义抽取（自然语言 → 标准 JSON，对齐标准症状词表 + 候选 tag）
 *   - Skill 2 Clarifier   → 真大模型动态追问（基于主诉与已答历史，动态生成具象化问题，选项 tag 出自数据库字典）
 *   - Skill 5 Formatter   → 真大模型生成「通俗译释」+「第一人称面诊建议」
 *   - Skill 0/3/4         → 确定性 LocalMockDriver（Safety / Synthesizer / Retriever）
 *                          （Retrieval First：方剂组成 / 出处 / 毒性 100% 来自本地库，LLM 仅做语意组装）
 *   - 任意 LLM 失败（无密钥 / 超时 / 网络异常 / 解析失败）→ 静默降级到 LocalMockDriver，
 *     永不中断主流程，报告末尾仍有免责声明。
 *
 * 双模：浏览器挂到 window.CloudAPIDriver；Node 下 module.exports（供冒烟测试）。
 */

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CloudAPIDriver = factory().CloudAPIDriver;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ============================ 0. 配置（源码零凭证，密钥仅来自 localStorage） ============================ */
    var PROVIDER = 'aliyun-dashscope';
    var BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    var DEFAULT_MODEL = 'qwen-turbo';
    var API_KEY_STORAGE_KEY = 'tcm_api_key';     // 仅此一处声明键名，密钥值运行时从 localStorage 读取
    var DEFAULT_TIMEOUT_MS = 15000;              // 超时即降级，保证演示/测试环境永不卡死
    // 兜底负向选项（与 agent-engine.js 的 FALLBACK_LABEL 保持一致）
    var FALLBACK_LABEL = '以上均无 / 无上述情况';

    // 5 个标准脏腑方向（与 agent-engine.js 的 FEATURE_TAXONOMY / herbs_rag_db 的 category.id 对齐）
    // 大模型仅从这 6 个取值中选，确定性引擎据此映射到内部 category.id，确保下游 5D 矩阵无缝衔接。
    var NAME_TO_ID = {
        '心肺胸胁': 'xin_fei_xiong_xie',
        '肝胆疏泄': 'gan_dan_yu_jie',
        '脾胃运化': 'pi_wei_yun_hua',
        '肾系水液': 'shen_xi_shui_ye',
        '外感表证': 'biao_zheng_wai_gan'
        // '待归经' → 无对应 id（detected_category = null），走全局十问补漏
    };
    var DISCLAIMER = '提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。';

    /* ============================ 1. 引擎 / 确定性委派 ============================ */
    function getEngine() {
        if (typeof window !== 'undefined' && window.SymptomAgentEngine) return window.SymptomAgentEngine;
        if (typeof globalThis !== 'undefined' && globalThis.SymptomAgentEngine) return globalThis.SymptomAgentEngine;
        try { if (typeof SymptomAgentEngine !== 'undefined') return SymptomAgentEngine; } catch (e) {}
        return null;
    }
    // 复用确定性 LocalMockDriver 处理非 LLM 技能与降级（保证 Schema 与合规红线完全一致）
    function getLocalMock() {
        var eng = getEngine();
        if (!eng || !eng.LocalMockDriver) {
            throw new Error('LocalMockDriver 未加载：CloudAPIDriver 依赖于 agent-engine.js');
        }
        return new eng.LocalMockDriver();
    }

    /* ============================ 2. 密钥读取（仅 localStorage） ============================ */
    function getApiKey() {
        try {
            if (typeof localStorage !== 'undefined') {
                return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
            }
        } catch (e) { /* 隐私模式 / 不可用时视为未配置 */ }
        return '';
    }
    function hasConfig() { return !!getApiKey(); }

    /* ============================ 3. 脱敏的 Chat Completions 调用 ============================ */
    // 仅向厂商发送「主诉/对话文本 + 检索知识」，不附带任何设备/IP/PII 字段。
    function chatComplete(opts) {
        opts = opts || {};
        var apiKey = getApiKey();
        if (!apiKey) throw new Error('NO_API_KEY');
        if (typeof fetch !== 'function') throw new Error('NO_FETCH');

        var url = BASE_URL + '/chat/completions';
        var timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
        var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var body = {
            model: opts.model || DEFAULT_MODEL,
            messages: opts.messages,
            temperature: (opts.temperature != null) ? opts.temperature : 0.3
        };
        // JSON 模式：提升结构化输出的稳定性（qwen 系列兼容 OpenAI response_format）
        if (opts.jsonMode) body.response_format = { type: 'json_object' };

        var fetchPromise = fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
                // 注意：不发送任何自定义设备/用户标识头，满足脱敏红线
            },
            body: JSON.stringify(body),
            signal: controller ? controller.signal : undefined
        }).then(function (resp) {
            if (!resp.ok) {
                return resp.text().catch(function () { return ''; }).then(function (txt) {
                    throw new Error('API_HTTP_' + resp.status + ': ' + String(txt).slice(0, 200));
                });
            }
            return resp.json();
        }).then(function (json) {
            var content = json && json.choices && json.choices[0] && json.choices[0].message
                && json.choices[0].message.content;
            if (!content) throw new Error('EMPTY_CONTENT');
            return content;
        });

        // 保证请求一定会结束：即使 AbortController 不可用或请求永久挂起，超时后也 reject → 触发降级（不再卡在「待验证」）
        var timeoutPromise = new Promise(function (_, reject) {
            setTimeout(function () {
                if (controller) { try { controller.abort(); } catch (e) {} }
                reject(new Error('TIMEOUT_' + timeoutMs));
            }, timeoutMs);
        });
        return Promise.race([fetchPromise, timeoutPromise]);
    }

    // 容错 JSON 解析：兼容模型偶发用 ```json 代码块包裹的情况
    function extractJSON(text) {
        if (!text) return null;
        var s = String(text).trim();
        var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) s = fence[1].trim();
        var start = s.indexOf('{');
        var end = s.lastIndexOf('}');
        if (start >= 0 && end > start) s = s.slice(start, end + 1);
        try { return JSON.parse(s); } catch (e) { return null; }
    }

    // 让 chatComplete(Promise) → 解析 JSON；失败时 reject 触发降级
    function extractJSONSafe(promise) {
        return promise.then(function (text) {
            var j = extractJSON(text);
            if (!j) throw new Error('LLM_JSON_PARSE_FAIL');
            return j;
        });
    }

    /* ============================ 3.5 数据库标签字典（运行时从 rag 提取，供 LLM 对齐） ============================ */
    // 从 rag 提取两类字典，注入抽取 / 追问的 prompt，使 LLM 输出与确定性检索词表对齐：
    //   - stdVocab：规范症状词表（standard_keywords + oral_synonyms.standard 去重）
    //   - tagVocab：全部可选 tag → 中文 label（depth_prompts.options ∪ global_inquiry.options）
    //   - validTags：tag → label 映射（用于追问选项校验，丢弃 LLM 自创的非法 tag）
    // 不硬编码任何方剂/映射数据，随 database/herbs_rag_db.js 更新自动同步。
    function buildTagDictionary(rag) {
        rag = rag || { categories: [], global_inquiry: {} };
        var tagLines = [];
        var stdSet = {};
        var validTags = {};
        var tagDim = {};   // tag → dimension（供追问选项不足时按维度补齐）
        (rag.categories || []).forEach(function (c) {
            (c.standard_keywords || []).forEach(function (k) { if (k && !stdSet[k]) stdSet[k] = 1; });
            (c.oral_synonyms || []).forEach(function (s) { if (s && s.standard && !stdSet[s.standard]) stdSet[s.standard] = 1; });
            Object.keys(c.depth_prompts || {}).forEach(function (k) {
                var dim = c.depth_prompts[k].dimension;
                (c.depth_prompts[k].options || []).forEach(function (o) {
                    if (o && o.tag && !validTags[o.tag]) {
                        validTags[o.tag] = o.label || o.tag;
                        tagDim[o.tag] = dim;
                        tagLines.push(o.tag + ' → ' + (o.label || o.tag));
                    }
                });
            });
        });
        Object.keys(rag.global_inquiry || {}).forEach(function (k) {
            var gi = rag.global_inquiry[k];
            var dim = gi.dimension;
            (gi.options || []).forEach(function (o) {
                if (o && o.tag && !validTags[o.tag]) {
                    validTags[o.tag] = o.label || o.tag;
                    tagDim[o.tag] = dim;
                    tagLines.push(o.tag + ' → ' + (o.label || o.tag));
                }
            });
        });
        return {
            stdVocab: Object.keys(stdSet).join('、'),
            tagVocab: tagLines.join('\n'),
            validTags: validTags,
            tagDim: tagDim
        };
    }

    /* ============================ 4. Skill 1 · Extractor（大模型语义抽取） ============================ */
    var EXTRACTOR_SYSTEM_PROMPT = [
        '你是一名中医「身体信号结构化抽取器」。任务：对用户用自然语言描述的不适主诉进行语义理解，',
        '抽取其中的症状信号，并将其归类到下列 6 个标准脏腑方向之一（如无法确定则归为「待归经」），',
        '同时给出整体置信度，并推断 1~3 个建议进一步追问的专科问题。',
        '',
        'primary_category 必须严格从下列取值之一（多一个字/少一个字都错误）：',
        '心肺胸胁 / 肝胆疏泄 / 脾胃运化 / 肾系水液 / 外感表证 / 待归经',
        '注意：「胃气上逆」「肝郁气滞」等是症状或证型，不能作为 primary_category；它们应写入 extracted_symptoms 的 standard_tag。',
        '',
        '硬性约束：',
        '1. 仅做「理解与抽取」，绝不给出诊断结论或处方建议。',
        '2. 只输出一个 JSON 对象，不要任何多余解释或代码块标记。',
        '3. 若主诉信息过少或指向不明，primary_category 使用「待归经」，confidence 取较低值（0.1~0.3）。',
        '4. 每条 extracted_symptoms 含：',
        '   - raw_phrase：用户原话片段；',
        '   - standard_tag：规范中医表述，必须尽量从下方【标准症状词表】中选取；词表无对应时再用最贴近的规范术语；',
        '   - category：该症状大致维度（如 消化/寒热/睡眠/情志/体表/疼痛/二便 等）；',
        '   - confidence（0~1）；',
        '   - candidate_tags：从下方【候选 tag 字典】中选出与本症状最相关的 1~5 个 tag（精确匹配字符串，严禁自创），用于辅助后续方剂检索。',
        '5. candidate_tags 必须优先选能命中典籍方剂的「专病 tag」与「十问 tag」，不要选宽泛词。',
        '',
        '输出 JSON 结构示例：',
        '{',
        '  "primary_category": "脾胃运化",',
        '  "confidence": 0.82,',
        '  "extracted_symptoms": [',
        '    {"raw_phrase": "吃完饭肚子涨", "standard_tag": "脘腹胀满", "category": "消化", "confidence": 0.9, "candidate_tags": ["pw_bloat"]}',
        '  ],',
        '  "inferred_specialty_questions": ["平时大便情况如何？", "是否怕冷或喜热饮？"]',
        '}'
    ].join('\n');

    // 本地收集全部维度（与 agent-engine.collectAllDims 等价，避免跨文件依赖私有函数）
    function collectAllDims(rag) {
        var set = {};
        (rag.categories || []).forEach(function (c) {
            Object.keys(c.depth_prompts || {}).forEach(function (k) {
                var d = c.depth_prompts[k].dimension; if (d) set[d] = 1;
            });
        });
        Object.keys(rag.global_inquiry || {}).forEach(function (k) {
            var g = rag.global_inquiry[k]; if (g && g.dimension) set[g.dimension] = 1;
        });
        return Object.keys(set);
    }

    // 将 LLM 语义抽取结果适配为确定性引擎下游（Clarifier / Retriever）所需的统一 Shape，
    // 从而「无缝传递」到 5D 方剂矩阵与 L2 草本检索，无需改动业务编排。
    function adaptExtractorLLM(llm, rag) {
        var primary = llm.primary_category;
        var detectedCategory = NAME_TO_ID[primary] || null;
        var detectedName = null;
        if (detectedCategory) {
            var cat = (rag.categories || []).filter(function (c) { return c.id === detectedCategory; })[0];
            detectedName = cat ? cat.name : primary;
        } else { detectedName = primary || null; }

        // covered_dimensions：由归经类目的 depth_prompts 维度数 + 「body」推导，供双轨追问队列构建
        var covered = [];
        if (detectedCategory) {
            var c2 = (rag.categories || []).filter(function (c) { return c.id === detectedCategory; })[0];
            if (c2 && c2.depth_prompts) {
                Object.keys(c2.depth_prompts).forEach(function (k) {
                    var d = c2.depth_prompts[k].dimension; if (d && covered.indexOf(d) < 0) covered.push(d);
                });
            }
            covered.push('body');
        }
        var allDims = collectAllDims(rag);
        var missing = allDims.filter(function (d) { return covered.indexOf(d) < 0; });
        var completeness = covered.length < 2 ? 'low' : (covered.length <= 3 ? 'medium' : 'high');

        // 透传 candidate_tags（LLM 预测的检索辅助 tag），并汇总到顶层供检索增强
        var candidateTags = [];
        var extracted = (llm.extracted_symptoms || []).map(function (s) {
            var std = s.standard_tag || s.standard || '';
            var cand = Array.isArray(s.candidate_tags) ? s.candidate_tags.slice() : [];
            cand.forEach(function (t) { if (candidateTags.indexOf(t) < 0) candidateTags.push(t); });
            return {
                raw: s.raw_phrase || '',
                standard: std,                 // 下游 skillSynthesizer 读取 e.standard
                standard_tag: std,
                category: s.category || '',
                dimension: s.dimension || null,
                confidence: s.confidence,
                candidate_tags: cand
            };
        });

        return {
            detected_category: detectedCategory,
            detected_category_name: detectedName,
            category_status: detectedCategory ? 'detected' : 'pending',
            extracted_symptoms: extracted,
            covered_dimensions: covered,
            missing_dimensions: missing,
            overall_completeness: completeness,
            candidate_tags: candidateTags,     // 检索增强：Session.confirm 时并入 selected_tags
            // —— LLM 增强字段（附加、对确定性下游安全，可忽略）——
            llm_confidence: llm.confidence,
            inferred_specialty_questions: llm.inferred_specialty_questions || [],
            primary_category_label: primary
        };
    }

    async function extractViaLLM(ctx, input) {
        var rag = (ctx && ctx.knowledge_base) || (getEngine() && getEngine().getRag && getEngine().getRag()) || { categories: [], global_inquiry: {} };
        var userText = (input && input.user_raw_input) || '';
        // 注入数据库真实字典，让 LLM 的 standard_tag / candidate_tags 与确定性检索词表对齐
        var dict = buildTagDictionary(rag);
        var system = EXTRACTOR_SYSTEM_PROMPT
            + '\n\n【标准症状词表（standard_tag 尽量从此选取，用顿号分隔）】\n' + (dict.stdVocab || '（空）')
            + '\n\n【候选 tag 字典（candidate_tags 必须从此精确选取，格式：tag → 中文说明）】\n' + (dict.tagVocab || '（空）');
        // 注意：extractJSONSafe 返回 Promise，必须 await 得到解析后的对象
        var content = await extractJSONSafe(chatComplete({
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: '请抽取以下主诉的身体信号：' + userText }
            ],
            jsonMode: true,
            temperature: 0.2
        }));
        var allowedCats = Object.keys(NAME_TO_ID).concat(['待归经']);
        if (!content || typeof content !== 'object' || !content.primary_category || allowedCats.indexOf(content.primary_category) < 0) {
            throw new Error('LLM_EXTRACT_INVALID');
        }
        return adaptExtractorLLM(content, rag);
    }

    /* ============================ 4.5 Skill 2 · Clarifier（大模型动态追问） ============================ */
    // 与确定性 skillClarifier 同 Shape：{ should_continue, ask_dimension, ask_track, ask_key, question_text, option_cards:[{label,tag,negative}], convergence_score }
    // 但问题由 LLM 依据「用户真实主诉 + 已抽症状 + 已答历史」动态生成，而非固定队列；
    // 且每个选项 tag 必须出自数据库字典，确保用户勾选后能命中 5D 方剂矩阵。
    var CLARIFIER_SYSTEM_PROMPT = [
        '你是一名中医问诊助手，负责根据用户主诉和已答历史，动态生成下一轮「具象化追问」。',
        '',
        '核心原则（违反任何一条都是错误输出）：',
        '1. 每轮必须聚焦一个**尚未问过**的维度（见输入中的 asked_dimensions）。绝对禁止反复问同一个维度。',
        '2. 优先从以下线索挑选本轮维度（按优先级）：',
        '   - 已抽取症状给出的 candidate_tags 所对应的维度；',
        '   - 输入中的 missing_dimensions（未覆盖维度）；',
        '   - 能直接收窄辨证方向的关键细节（疼痛性质、诱因、伴随症状、时间规律、寒热偏好、二便睡眠等）。',
        '3. 每个选项的 tag 必须严格出自下方【候选 tag 字典】（精确匹配，绝不自创）；label 是面向用户的中文，要具体、口语化、不带医学黑话。',
        '4. 问题必须紧扣用户真实描述，不要问与本次主诉无关的固定套路问题。',
        '5. 每轮只问 1 个关键维度，给出 3~5 个具象化选项（可多选）。严禁只给 1~2 个选项：若当前维度下可枚举的合法选项不足 3 个，必须从其他未覆盖维度补充选项，或（当信息已充分时）直接返回 should_continue=false 进入收敛，绝不允许输出仅含 1 个有效选项的追问。',
        '6. 若关键信息已足够，或当前轮次已接近 max_rounds，输出 should_continue=false 并给出较高收敛分（≥0.85）。',
        '7. 仅做信息收集，不涉及诊断结论与处方建议。',
        '8. 只输出一个 JSON 对象，不要任何多余解释或代码块标记。',
        '',
        '输出 JSON 结构：',
        '{',
        '  "should_continue": true,',
        '  "ask_dimension": "property" | "trigger" | "emotion" | "ten_wen" | "body" | "other",',
        '  "question_text": "针对用户具体情况的问题（可多选）",',
        '  "option_cards": [',
        '    {"label": "刺痛，位置固定不移", "tag": "xf_ci_tong"},',
        '    {"label": "闷痛、像有东西压着", "tag": "xf_men_zhang"}',
        '  ],',
        '  "convergence_score": 0.5,',
        '  "reasoning": "为什么选这个维度、这些选项（调试用）"',
        '}'
    ].join('\n');

    async function clarifyViaLLM(ctx, input) {
        var rag = (ctx && ctx.knowledge_base) || (getEngine() && getEngine().getRag && getEngine().getRag()) || { categories: [], global_inquiry: {} };
        var dict = buildTagDictionary(rag);
        var userText = (input && input.user_raw_input) || '';
        var extracted = (input && input.extracted) || [];
        var answered = (input && input.answered) || [];
        var askedDims = (input && input.asked_dimensions) || [];
        var candidateTags = (input && input.candidate_tags) || [];
        var missingDims = (input && input.missing_dimensions) || [];
        var round = (input && input.current_round) || 1;
        var maxRounds = (input && input.max_rounds) || 5;

        // 收集已勾选的非负向 tag，避免再次作为选项出现
        var selectedTags = new Set();
        answered.forEach(function (a) {
            (a.tags || []).forEach(function (t) { if (!isNegativeTag(t)) selectedTags.add(t); });
        });

        var extSummary = extracted.map(function (s) {
            var base = s.standard || s.standard_tag || s.raw || '';
            var cands = (s.candidate_tags && s.candidate_tags.length) ? (' [候选tag:' + s.candidate_tags.join(',') + ']') : '';
            return base + cands;
        }).join('；') || '（未抽取到明确症状）';

        var ansSummary = answered.map(function (a) {
            var dim = a.dim || '-';
            return dim + ':' + (a.tags || []).join('/');
        }).join('；') || '（暂无）';

        var userMsg = [
            '【用户原始主诉】' + userText,
            '【已抽取症状】' + extSummary,
            '【候选 tag（优先围绕这些问）】' + candidateTags.join('、'),
            '【未覆盖维度（建议补问）】' + missingDims.join('、'),
            '【已问过维度（绝对禁止再问）】' + askedDims.join('、'),
            '【已回答历史（维度:tag）】' + ansSummary,
            '【当前轮次】' + round + ' / ' + maxRounds,
            '请生成下一轮具象化追问：必须选一个未问过维度，选项 tag 出自字典，且不要重复已勾选的 tag。若信息充分则 should_continue=false。'
        ].join('\n');

        var content = await extractJSONSafe(chatComplete({
            messages: [
                { role: 'system', content: CLARIFIER_SYSTEM_PROMPT + '\n\n【候选 tag 字典（option_cards 的 tag 必须从中精确选取）】\n' + dict.tagVocab },
                { role: 'user', content: userMsg }
            ],
            jsonMode: true,
            temperature: 0.35
        }));
        if (!content || typeof content !== 'object' || !Array.isArray(content.option_cards)) {
            throw new Error('LLM_CLARIFY_INVALID');
        }

        // 归一 option_cards：仅保留 tag 出自字典、且未被用户选过的合法项；过滤与已问维度重复的维度（如果 AI 仍返回了重复维度）
        var askDim = content.ask_dimension || 'ai';
        var cards = (content.option_cards || []).map(function (o) {
            return { label: o.label || o.tag, tag: o.tag || o.label, negative: false };
        }).filter(function (c) {
            if (!dict.validTags[c.tag]) return false;
            if (selectedTags.has(c.tag)) return false;
            return true;
        });
        // 去重 label/tag
        var seen = new Set();
        cards = cards.filter(function (c) {
            if (seen.has(c.tag)) return false;
            seen.add(c.tag);
            return true;
        }).slice(0, 5);

        // 最低 3 个有效选项的兜底补齐：若 AI 给的合法选项 < 3，从「同维度 / 未覆盖维度」的字典里补充，
        // 排除已选 tag，直到 ≥3（最多 5）。避免用户只看到 1 个选项 + 兜底。
        if (cards.length < 3) {
            var backfillPool = Object.keys(dict.tagDim).filter(function (t) {
                if (selectedTags.has(t) || seen.has(t)) return false;
                var d = dict.tagDim[t];
                if (d === askDim) return true;
                return missingDims.indexOf(d) >= 0;
            });
            backfillPool.forEach(function (t) {
                if (cards.length >= 3) return;
                var lbl = dict.validTags[t] || t;
                cards.push({ label: lbl, tag: t, negative: false });
                seen.add(t);
            });
        }

        cards.push({ label: FALLBACK_LABEL, tag: FALLBACK_LABEL, negative: true });
        // 自定义补充入口：勾选后可在 UI 输入自由文本（不计入矩阵评分，仅用于 S3 摘要回显）
        cards.push({ label: '我有其他情况要补充（可输入）', tag: '__CUSTOM__', custom: true, negative: false });

        // 如果 AI 返回了已问过维度，视为收敛信号之一
        var dimAlreadyAsked = askedDims.indexOf(askDim) >= 0;
        var shouldContinue = !dimAlreadyAsked && (content.should_continue !== false) && (round < maxRounds) && (cards.length > 4);
        return {
            should_continue: shouldContinue,
            ask_dimension: askDim,
            ask_track: 'T_AI',
            ask_key: 'ai_' + round,
            question_text: content.question_text || '请补充以下信息（可多选）：',
            option_cards: cards,
            convergence_score: (typeof content.convergence_score === 'number') ? content.convergence_score : (shouldContinue ? 0.5 : 0.85),
            reasoning: content.reasoning || ''
        };
    }

    function isNegativeTag(t) { return t === FALLBACK_LABEL; }

    /* ============================ 5. Skill 5 · Formatter（大模型通俗报告生成） ============================ */
    var SYNTHESIZER_EMPTY_PROMPT = [
        '你是一名中医科普撰稿人。当前检索未命中具体典籍方剂，因此你的任务是基于用户已整理的身体表现摘要，',
        '生成两段温和、通俗、非诊断性的文字，帮助用户理解自身信号并为就医沟通做准备。',
        '',
        '任务：',
        '1. tcm_explanation_section（通俗译释）：用生活化比喻解释这些身体信号可能对应的大致中医调理思路',
        '   （如脾胃气机不畅、肝郁、气血不足等方向），强调仅为知识性整理，不替代医生诊断。',
        '2. doctor_communication_brief（第一人称面诊建议）：以「医生您好，我想咨询一下我最近的情况。」开头，',
        '   把用户的身体表现自然地组织成一段可对医生当面口述的话，语气诚恳、条理清晰。',
        '',
        '硬性约束：',
        '1. 严格只输出一个 JSON 对象，不要任何多余解释或代码块标记。',
        '2. 严禁编造任何具体药材、方剂、诊断结论或剂量。',
        '3. 保持「知识科普 + 沟通辅助」的非诊断口吻。',
        '4. 输出 JSON 结构：',
        '{',
        '  "tcm_explanation_section": "……",',
        '  "doctor_communication_brief": "医生您好，我想咨询一下我最近的情况。……"',
        '}'
    ].join('\n');

    var SYNTHESIZER_SYSTEM_PROMPT = [
        '你是一名中医科普「通俗译释与面诊话术生成器」。你会收到两部分内容：',
        'A.【用户已整理的身体表现摘要】（用户自己的话，仅作背景理解）',
        'B.【检索命中的典籍方剂与草本知识】（来自中医典籍数据库的事实依据，是权威来源）',
        '',
        '你的任务：基于 B 的事实依据，生成两段温和、通俗、面向普通人的文字：',
        '1. tcm_explanation_section（通俗译释）：用生活化比喻解释该方向的大致病机/调理思路，避免生涩古籍术语，帮助患者理解。',
        '2. doctor_communication_brief（第一人称面诊建议）：以「医生您好，我想咨询一下我最近的情况。」开头，',
        '   把用户的身体表现自然地组织成一段可对医生当面口述的话，语气诚恳、条理清晰。',
        '',
        '硬性约束：',
        '1. 严格只输出一个 JSON 对象，不要任何多余解释或代码块标记。',
        '2. 不得编造、添加 B 中未提及的任何药材、成分、方剂或诊断结论（Retrieval First）。',
        '3. 保持「知识科普 + 沟通辅助」的非诊断口吻，明确不替代医生诊断。',
        '4. 输出 JSON 结构：',
        '{',
        '  "tcm_explanation_section": "……",',
        '  "doctor_communication_brief": "医生您好，我想咨询一下我最近的情况。……"',
        '}'
    ].join('\n');

    // 判断检索是否未命中真实方剂（仅整体调理方向 / 空）
    function isEmptyKnowledge(kp) {
        kp = kp || {};
        var fm = kp.matched_formula || {};
        return !fm.formula_name || fm.formula_name === '整体辨证调理方向' || !fm.composition || !fm.composition.length;
    }

    async function formatViaLLM(ctx, input) {
        // 先由确定性引擎产出完整 8 模块报告（保证 Schema / 毒性强预警 / 草本联动 100% 合规）
        var localMock = getLocalMock();
        var det = localMock.invoke('formatter', ctx, input);
        var detData = det && det.data;
        if (!detData || !detData.ui_card_payload || !detData.ui_card_payload.sections) {
            throw new Error('DET_FORMATTER_FAIL');
        }
        var sec = detData.ui_card_payload.sections;

        // —— 脱敏上下文：仅含检索知识（公开典籍库）+ 用户自身整理文本，绝不含 PII ——
        var kp = input.knowledge_payload || {};
        var fm = kp.matched_formula || {};
        var emptyK = isEmptyKnowledge(kp);
        var herbs = (kp.matched_herbs || []).map(function (h) {
            return '- ' + h.herb_name + (h.has_toxicity ? '（毒性药材，需遵医嘱）' : '') + '：' + (h.description || '');
        }).join('\n');
        var comp = (fm.composition || []).join('、');
        var advice = kp.dietary_and_lifestyle_advice || {};
        var bias = kp.bias_conclusion || {};

        var userMsg;
        if (emptyK) {
            // 未命中具体方剂：让 AI 基于用户摘要生成通用科普解释与就诊沟通话术，严禁编造药材/方剂
            userMsg = [
                '【用户已整理的身体表现摘要】',
                input.synthesized_symptom_text || '（未提供）',
                '',
                '【检索结果】未匹配到明确的典籍方剂与专属草本（当前信息较笼统或较特殊）。',
                '',
                '请基于上述摘要，生成：',
                '1. 通俗译释：用生活化语言解释这些身体信号可能对应的中医整体调理思路（如脾胃气机、肝郁、气血不足等方向），强调仅为知识科普。',
                '2. 面诊建议：以「医生您好，我想咨询一下我最近的情况。」开头，把用户表现组织成一段对医生当面说的话，语气诚恳、条理清晰。',
                '约束：严禁编造任何具体药材、方剂、诊断结论；保持温和、非诊断口吻。'
            ].join('\n');
        } else {
            var ctxText = [
                '【检索命中的典籍方剂与草本（事实依据，不得增删药材）】',
                '方剂名：' + (fm.formula_name || '无') + '（出处：' + (fm.source_book || '无') + '）',
                '方剂说明：' + (fm.description || '无'),
                '组成药材：' + (comp || '无'),
                '相关草本：\n' + (herbs || '无'),
                '食疗建议：' + (advice.fruit_guidance || '无'),
                '作息建议：' + (advice.habit_guidance || '无'),
                '辨证倾向：' + (bias.conclusion_text || '无')
            ].join('\n');
            userMsg = '【用户已整理的身体表现摘要】\n' + (input.synthesized_symptom_text || '') + '\n\n' + ctxText;
        }

        var sysPrompt = emptyK ? SYNTHESIZER_EMPTY_PROMPT : SYNTHESIZER_SYSTEM_PROMPT;

        // 注意：extractJSONSafe 返回 Promise，必须 await
        var parsed = await extractJSONSafe(chatComplete({
            messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userMsg }
            ],
            jsonMode: true,
            temperature: 0.5
        }));
        if (!parsed || typeof parsed !== 'object' || !parsed.tcm_explanation_section || !parsed.doctor_communication_brief) {
            throw new Error('LLM_FORMAT_INVALID');
        }

        // 仅覆盖两大叙事模块，其余 6 模块保持确定性产出（合规 & 联动不变）
        sec.tcm_explanation_section = parsed.tcm_explanation_section;
        sec.doctor_communication_brief = parsed.doctor_communication_brief;
        sec.llm_enhanced = true;

        // 重建纯文本复制载荷（含新生成的两段），保持与确定性版一致的结构
        var herbLine = (kp.matched_herbs || []).map(function (h) {
            return h.herb_name + (h.has_toxicity ? '（毒性药材，需遵医嘱）' : '');
        }).join('、');
        sec.plain_text_copy_payload = [
            parsed.tcm_explanation_section,
            parsed.doctor_communication_brief,
            bias ? ('辨证倾向：' + bias.conclusion_text) : '',
            fm.formula_name ? ('参考方剂：' + fm.formula_name + '（' + fm.source_book + '）') : '',
            herbLine,
            advice.fruit_guidance,
            advice.habit_guidance,
            DISCLAIMER
        ].filter(Boolean).join('\n');

        return detData;
    }

    /* ============================ 6. CloudAPIDriver 实现 ============================ */
    function CloudAPIDriver(opts) {
        opts = opts || {};
        this.mode = 'cloud';
        this.async = true;                 // 关键：会话层据此判断走同步/异步双分支
        this.model = opts.model || DEFAULT_MODEL;
        this.provider = PROVIDER;
        this.baseUrl = opts.baseUrl || BASE_URL;
        this.timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
    }

    CloudAPIDriver.prototype.hasConfig = hasConfig;

    // SkillDriver.invoke(skillId, ctx, input): Promise<SkillResult>
    // 统一返回 { ok, data, fallback_used, meta:{latency_ms, model} }（与 LocalMockDriver 同构）
    CloudAPIDriver.prototype.invoke = function (skillId, ctx, input) {
        var self = this;
        var start = Date.now();
        var localMock = getLocalMock();

        // 无密钥：extractor/clarifier/formatter 全部静默退回确定性实现（与 mock 行为一致），保证演示可用
        if (!hasConfig() && (skillId === 'extractor' || skillId === 'clarifier' || skillId === 'formatter')) {
            var det = localMock.invoke(skillId, ctx, input || {});
            if (det && det.meta) det.meta.model = 'local-mock';
            return Promise.resolve(det);
        }

        // Skill 1 / Skill 2 / Skill 5：大模型抽取 / 动态追问 / 润色；失败静默降级到确定性实现
        if (skillId === 'extractor' || skillId === 'clarifier' || skillId === 'formatter') {
            var llmFn = (skillId === 'extractor') ? extractViaLLM
                : (skillId === 'clarifier') ? clarifyViaLLM
                    : formatViaLLM;
            return Promise.resolve()
                .then(function () { return llmFn(ctx, input || {}); })
                .then(function (data) {
                    return {
                        ok: true,
                        data: data,
                        fallback_used: false,
                        meta: { latency_ms: Date.now() - start, model: self.model, provider: self.provider }
                    };
                })
                .catch(function (err) {
                    // 静默降级：无缝退回确定性产出，主流程不中断
                    var fb = localMock.invoke(skillId, ctx, input || {});
                    fb.fallback_used = true;
                    fb.meta = fb.meta || {};
                    fb.meta.latency_ms = Date.now() - start;
                    fb.meta.cloud_error = String((err && err.message) || err);
                    return fb;
                });
        }

        // Skill 0/3/4：确定性引擎（检索与安全），不调用大模型
        var det2 = localMock.invoke(skillId, ctx, input || {});
        if (det2 && det2.meta) det2.meta.model = 'local-mock';
        return Promise.resolve(det2);
    };

    /* ============================ 7. 导出 ============================ */
    return {
        CloudAPIDriver: CloudAPIDriver,
        PROVIDER: PROVIDER,
        BASE_URL: BASE_URL,
        DEFAULT_MODEL: DEFAULT_MODEL,
        API_KEY_STORAGE_KEY: API_KEY_STORAGE_KEY,
        NAME_TO_ID: NAME_TO_ID,
        FALLBACK_LABEL: FALLBACK_LABEL,
        hasConfig: hasConfig,
        getApiKey: getApiKey,
        // 暴露给冒烟测试的内部工具
        _extractJSON: extractJSON,
        _adaptExtractorLLM: adaptExtractorLLM,
        _collectAllDims: collectAllDims,
        _buildTagDictionary: buildTagDictionary
    };
});
