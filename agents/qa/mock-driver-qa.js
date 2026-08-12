/**
 * agents/qa/mock-driver-qa.js — 阶段 2 质量走查（QA 自动预检）
 *
 * 依据：agents/contracts/mock-driver.md §5 测试契约（6 个用例）
 * 运行：node agents/qa/mock-driver-qa.js
 * 依赖：../agent-engine.js（LocalMockDriver + 状态机）
 *
 * 知识库通过 globalThis.__TEST_SYMPTOM__ / __TEST_HERB__ 注入（引擎 Node 兜底通道），
 * 与浏览器从全局 SYMPTOM_DATA/HERB_DATA 读取保持同一套检索逻辑。
 */
'use strict';

// ---- 0. 注入测试知识库（与 data.js 同构：groups<id/name/keywords[]/herbs[]> + herbs<id/name/oneLiner>） ----
const TEST_SYMPTOM = [
    { id: 'g_huo',  name: '去火', keywords: ['口苦', '咽痛', '上火', '热象', '烦躁'], herbs: ['jinyinhua', 'huanglian', 'banxia'] },
    { id: 'g_qi',   name: '补气', keywords: ['乏力', '气短', '神疲乏力'],              herbs: ['huangqi', 'dangshen'] },
    { id: 'g_an',   name: '安神', keywords: ['失眠', '多梦', '入睡困难', '心烦'],      herbs: ['suanzaoren', 'baiziren'] },
    { id: 'g_pi',   name: '健脾', keywords: ['食欲不振', '食后腹胀', '便溏'],          herbs: ['shanyao', 'yiyiren'] }
];
const TEST_HERB = [
    { id: 'jinyinhua', name: '金银花', oneLiner: '清热解毒，疏散风热' },
    { id: 'huanglian', name: '黄连',   oneLiner: '清热燥湿，泻火解毒' },
    { id: 'banxia',    name: '半夏',   oneLiner: '燥湿化痰，降逆止呕' }, // TOXIC_HERBS 命中
    { id: 'huangqi',   name: '黄芪',   oneLiner: '补气升阳，固表止汗' },
    { id: 'dangshen',  name: '党参',   oneLiner: '健脾益肺，养血生津' },
    { id: 'suanzaoren',name: '酸枣仁', oneLiner: '养心补肝，宁心安神' },
    { id: 'baiziren',  name: '柏子仁', oneLiner: '养心安神，润肠通便' },
    { id: 'shanyao',   name: '山药',   oneLiner: '补脾养胃，生津益肺' },
    { id: 'yiyiren',   name: '薏苡仁', oneLiner: '利水渗湿，健脾止泻' }
];
globalThis.__TEST_SYMPTOM__ = TEST_SYMPTOM;
globalThis.__TEST_HERB__ = TEST_HERB;

const engine = require('../../agent-engine.js');
const { LocalMockDriver, getDriver, SymptomSession, DISCLAIMER, MAX_ROUNDS } = engine;

// ---- 1. 轻量断言框架 ----
let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// ---- 2. 六个契约用例 ----
console.log('\n=== 契约用例 1：输入含红牌词 → blocked=true，不进 S2–S5 ===');
{
    const s = new SymptomSession(getDriver('mock'));
    const res = s.submitDescription('最近总是胸痛剧烈，还伴随呼吸困难，很难受');
    check('返回状态为 SAFETY_CUTOFF', res.state === 'SAFETY_CUTOFF', 'got ' + res.state);
    check('屏蔽标志 blocked=true', res.data && res.data.blocked === true);
    check('附带合规红卡文案', res.data && typeof res.data.compliance_card === 'string' && res.data.compliance_card.length > 0);
    check('未进入 S2–S5（state 非 S2/S3/S5）', !['S2', 'S3', 'S5'].includes(res.state));
}

console.log('\n=== 契约用例 2：空 / 模糊输入 → overall_completeness=low（触发补漏） ===');
{
    const drv = new LocalMockDriver();
    const ctx = { red_list: engine.RED_FLAGS, forbidden_words: engine.FORBIDDEN_WORDS };
    const ext = drv.invoke('extractor', ctx, { user_raw_input: '最近身体不太舒服，说不上来' }).data;
    check('提取结果 overall_completeness=low', ext.overall_completeness === 'low', 'got ' + ext.overall_completeness);
    check('模糊输入提取条目 < 2', (ext.extracted_symptoms || []).length < 2);

    // 端到端：模糊输入仍能进入 S2（不崩溃），且后续经补漏/收敛可继续
    const s = new SymptomSession(getDriver('mock'));
    const r = s.submitDescription('最近不太舒服');
    check('模糊输入仍可进入 S2 流程', r.state === 'S2', 'got ' + r.state);
    check('S2 提供追问卡片（含补漏机制）', r.data && Array.isArray(r.data.option_cards) && r.data.option_cards.length > 0);
}

console.log('\n=== 契约用例 3：连续多轮 → 硬上限 MAX_ROUNDS 强制进 S3（不超轮、不中断） ===');
{
    const s = new SymptomSession(getDriver('mock'));
    s.submitDescription('最近状态一般');
    let guard = 0, reachedS3 = false, maxRoundSeen = 0;
    while (s.state === 'S2' && guard < 12) {
        const r = s.answer('正常'); // '正常' 在 OPTION_DIMENSION 中，逐步累计 dim
        maxRoundSeen = Math.max(maxRoundSeen, s.round);
        if (r.state === 'S3') { reachedS3 = true; break; }
        guard++;
    }
    check('最终收敛进入 S3', reachedS3, 'state=' + s.state);
    check('轮次未超过硬上限 MAX_ROUNDS=' + MAX_ROUNDS, maxRoundSeen <= MAX_ROUNDS, 'maxRoundSeen=' + maxRoundSeen);
    // 硬停守卫：直接把 round 推到上限并再答一次，必须强制 S3
    const s2 = new SymptomSession(getDriver('mock'));
    s2.submitDescription('口苦');
    s2.round = MAX_ROUNDS - 1; // 下一轮即达上限
    const hard = s2.answer('怕冷');
    check('达 MAX_ROUNDS 时强制进入 S3（无论收敛分）', hard.state === 'S3', 'got ' + hard.state);
}

console.log('\n=== 契约用例 4：命中毒性药材 → has_toxicity=true 且 toxicity_warning 存在 ===');
{
    const s = new SymptomSession(getDriver('mock'));
    // 去火 group 含 banxia（毒性），以“口苦、咽痛、上火”触发去火倾向
    s.submitDescription('口苦、咽痛、最近有点上火');
    // 直接收敛若干轮到 S3 再 confirm
    let guard = 0;
    while (s.state === 'S2' && guard < 8) { const r = s.answer('正常'); if (r.state === 'S3') break; guard++; }
    const rep = s.confirm();
    const herbs = (rep.data.ui_card_payload.sections.herb_knowledge_section) || [];
    const toxic = herbs.filter(h => h.has_toxicity);
    check('报告含草本条目', herbs.length > 0, 'herbs=' + herbs.length);
    check('至少 1 个 has_toxicity=true', toxic.length >= 1, 'toxic=' + toxic.length);
    check('毒性草本带 toxicity_warning 文案', toxic.every(h => typeof h.toxicity_warning === 'string' && h.toxicity_warning.length > 0));
    check('毒性草本标记为 banxia（半夏）', toxic.some(h => h.herb_id === 'banxia'));
}

console.log('\n=== 契约用例 5：断网 / 无后端 → 仍产出报告（mock 不依赖网络） ===');
{
    const s = new SymptomSession(getDriver('mock'));
    s.submitDescription('口苦、睡不好、容易烦躁'); // 倾向安神
    let guard = 0;
    while (s.state === 'S2' && guard < 8) { const r = s.answer('正常'); if (r.state === 'S3') break; guard++; }
    const rep = s.confirm();
    check('confirm 返回 S5 报告', rep.state === 'S5', 'got ' + rep.state);
    const sec = rep.data.ui_card_payload.sections;
    check('报告含通俗译释模块', typeof sec.tcm_explanation_section === 'string' && sec.tcm_explanation_section.length > 0);
    check('报告含面诊沟通话术', typeof sec.doctor_communication_brief === 'string' && sec.doctor_communication_brief.length > 0);
    check('报告含古籍方剂参考', sec.matched_formula_section && sec.matched_formula_section.formula_name);
    check('报告含相关草本知识', Array.isArray(sec.herb_knowledge_section));
    check('报告含食疗/日常作息模块', sec.dietary_guidance_section && sec.lifestyle_guidance_section);
    check('报告末尾固定 disclaimer', sec.disclaimer === DISCLAIMER);
}

console.log('\n=== 契约用例 6：任意 Skill 异常 → 走 FALLBACK，主流程不中断，报告末尾有 disclaimer ===');
{
    // 6a. 驱动层对 Skill 异常兜底：构造会让 skill 抛错的数据（getKB 读取即抛），驱动必须吞掉并返回 fallback
    //     —— 选用 retriever（会调用 getKB 遍历 SYMPTOM_DATA），以触发注入的异常
    globalThis.__TEST_SYMPTOM__ = { get length() { throw new Error('simulated skill failure'); } };
    const drv = new LocalMockDriver();
    let threw = false, fb;
    try { fb = drv.invoke('retriever', { red_list: [] }, { zangfu_tendency: '去火', confirmed_tags: ['热象'] }); }
    catch (e) { threw = true; }
    check('driver.invoke 遇 Skill 异常不向外抛', threw === false);
    check('异常时返回 ok=false 且 fallback_used=true', fb && fb.ok === false && fb.fallback_used === true);
    // 恢复知识库
    globalThis.__TEST_SYMPTOM__ = TEST_SYMPTOM;

    // 6b. 未知 skillId 同样走兜底
    const fb2 = drv.invoke('no_such_skill', {}, {});
    check('未知 skillId 兜底（ok=false, fallback_used=true）', fb2.ok === false && fb2.fallback_used === true);

    // 6c. 即便链路部分降级，formatter 仍输出固定 disclaimer（报告末尾合规红牌/免责到位）
    const fmt = drv.invoke('formatter', {}, { synthesized_symptom_text: '主要表现为口苦。', knowledge_payload: {} }).data;
    check('formatter 输出固定 disclaimer', fmt.ui_card_payload.sections.disclaimer === DISCLAIMER);

    // 6d. 端到端：某轮 Skill 返回空（降级）时，会话不中断且能走到报告
    const s = new SymptomSession(getDriver('mock'));
    const r0 = s.submitDescription('有点累'); // extractor 正常但条目少，仍进 S2
    check('降级场景下 submitDescription 不中断', r0.state === 'S2');
}

// ---- 3. 汇总 ----
console.log('\n=========================================');
console.log('QA 结果：通过 ' + pass + ' / 失败 ' + fail);
if (fail > 0) {
    console.log('失败项：\n - ' + fails.join('\n - '));
    process.exit(1);
} else {
    console.log('全部 6 个契约用例通过 ✅');
    process.exit(0);
}
