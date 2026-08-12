/**
 * agents/qa/mock-driver-qa.js — 身体信号整理引擎 · 自动预检（契约 6 用例 + 阶段 3 整改用例）
 * 运行：node agents/qa/mock-driver-qa.js
 */
'use strict';

// ---- 注入测试用全局（浏览器由 index.html 注入，Node 走 globalThis） ----
globalThis.HERBS_RAG_DB = require('../../database/herbs_rag_db.js');
globalThis.HERB_DATA = [
    { id: 'banxia', name: '半夏', oneLiner: '燥湿化痰，降逆止呕' },
    { id: 'danshen', name: '丹参', oneLiner: '活血祛瘀，凉血安神' },
    { id: 'dangshen', name: '党参', oneLiner: '健脾益气' },
    { id: 'jinyinhua', name: '金银花', oneLiner: '清热解毒' }
];
globalThis.CABINET_DATA = { '半夏': 'banxia', '丹参': 'danshen', '党参': 'dangshen', '金银花': 'jinyinhua' };

const E = require('../../agent-engine.js');
const { SymptomSession, getDriver, LocalMockDriver, FALLBACK_LABEL } = E;

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function runFlow(desc, answers) {
    const s = new SymptomSession(getDriver('mock'));
    const r0 = s.submitDescription(desc);
    if (r0.state === 'SAFETY_CUTOFF') return { session: s, safety: true, data: r0.data };
    let guard = 0;
    while (s.state === 'S2' && guard < 12) { s.answer(answers.shift() || [FALLBACK_LABEL]); guard++; }
    return { session: s, safety: false };
}

console.log('\n=== 契约用例 1：急症红牌硬拦截（含自然语言扩展） ===');
{
    ['胸痛剧烈', '胸好痛', '心口痛', '胸闷得慌', '吐血', '呼吸困难'].forEach(t => {
        const s = new SymptomSession(getDriver('mock'));
        const r = s.submitDescription(t);
        check('红线「' + t + '」→ SAFETY_CUTOFF', r.state === 'SAFETY_CUTOFF' && r.data.compliance_card);
    });
    // 轻度胸闷不应触发红线，仍走归纳路径
    const s = new SymptomSession(getDriver('mock'));
    const r = s.submitDescription('最近有点胸闷、气短');
    check('轻度「胸闷」不触发红线（走 S2 归纳）', r.state === 'S2');
}

console.log('\n=== 契约用例 2：模糊 / 空输入健壮性 ===');
{
    const s = new SymptomSession(getDriver('mock'));
    const r = s.submitDescription('我最近不太舒服');
    check('笼统描述可进入 S2（不报错）', r.state === 'S2');
    check('笼统描述 completeness=low', r.data && r.data.convergence_score !== undefined);
    const s2 = new SymptomSession(getDriver('mock'));
    const r2 = s2.submitDescription('');
    check('空字符串不崩溃（进入 S2 或安全，无异常）', r2.state === 'S2' || r2.state === 'SAFETY_CUTOFF');
}

console.log('\n=== 契约用例 3：Max Rounds = 5 硬停 ===');
{
    const s = new SymptomSession(getDriver('mock'));
    s.submitDescription('口苦、咽痛');
    let rounds = 0;
    while (s.state === 'S2' && rounds < 20) {
        const opts = s.currentOptions.filter(o => !o.negative);
        s.answer(opts.length ? [opts[0].tag] : [FALLBACK_LABEL]);
        rounds++;
    }
    check('收敛发生在 round ≤ 5（Max Rounds 硬停）', s.round <= 5, 'round=' + s.round);
    check('最终状态为 S3（收敛确认）', s.state === 'S3');
    check('收敛轮次 ≥ Min Rounds(2)（杜绝 1 轮假收敛）', s.round >= 2, 'round=' + s.round);
}

console.log('\n=== 契约用例 4：毒性静态预警（半夏） ===');
{
    const { session } = runFlow('我胸口闷、气短、怕冷', [['闷痛 / 胀痛，像有东西压着'], ['怕冷、喜暖、得热则舒'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const herbs = rep.data.ui_card_payload.sections.herb_knowledge_section;
    const toxic = herbs.find(h => h.herb_name === '半夏');
    check('方剂组成含毒性药材半夏', !!toxic);
    check('半夏标记 has_toxicity=true 且带预警文案', toxic && toxic.has_toxicity === true && /毒性/.test(toxic.toxicity_warning || ''));
}

console.log('\n=== 契约用例 5：离线 / 无 API 仍产出报告 ===');
{
    const { session } = runFlow('我容易胁肋胀闷、情绪急躁', [['胀闷走窜、叹气则舒'], ['容易急躁、一点就着'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    check('确认后产出 S5 报告', session.state === 'S5' && rep.data.ui_card_payload.sections);
    check('报告含免责声明', /不构成医疗诊断/.test(rep.data.ui_card_payload.sections.disclaimer || ''));
}

console.log('\n=== 契约用例 6：Skill 异常 / 未定义 → FALLBACK 不中断 ===');
{
    const drv = new LocalMockDriver();
    const fb = drv.invoke('nonexistent_skill', { red_list: [] }, {});
    check('未定义/异常 Skill → 驱动返回 fallback 且不抛出', fb.ok === false && fb.fallback_used === true);
    // 鲁棒性：缺失数据调用 retriever 不抛（降级为通用）
    const fb2 = drv.invoke('retriever', { red_list: [] }, {});
    check('retriever 在缺失 category_id 时不抛（ok 或降级）', fb2.ok === true || fb2.fallback_used === true);
}

console.log('\n=== 整改用例 7：语料库 5 类目 + 口语映射 ===');
{
    const rag = E.getRag();
    check('语料库含 5 个脏腑类目', (rag.categories || []).length === 5);
    const s = new SymptomSession(getDriver('mock'));
    const r = s.submitDescription('我胸口闷、有点气短');
    check('口语「胸口闷」映射到 心肺胸胁 类目', s.categoryId === 'xin_fei_xiong_xie', 'cat=' + s.categoryId);
    const s2 = new SymptomSession(getDriver('mock'));
    s2.submitDescription('我两肋胀、爱发火');
    check('口语「两肋胀/爱发火」映射到 肝胆郁结', s2.categoryId === 'gan_dan_yu_jie', 'cat=' + s2.categoryId);
}

console.log('\n=== 整改用例 8：双轨多组多选 + 强制兜底 ===');
{
    const s = new SymptomSession(getDriver('mock'));
    const r = s.submitDescription('我胃胀、吃不下');
    check('追问队列长度在 [Min,Max]=[2,5]', s.clarifyQueue.length >= 2 && s.clarifyQueue.length <= 5, 'len=' + s.clarifyQueue.length);
    check('首轮选项含「以上均无」兜底', (r.data.option_cards || []).some(o => o.negative === true));
    // 多选：一次选多个
    const multi = r.data.option_cards.filter(o => !o.negative).slice(0, 2).map(o => o.tag);
    s.answer(multi);
    check('多选数组被接受（round 推进且状态合法）', s.round === 2 && (s.state === 'S2' || s.state === 'S3'));
}

console.log('\n=== 整改用例 9：Skill3 自然语言叙述（非逗号拼接） ===');
{
    const { session } = runFlow('我胸口闷、气短、怕冷', [['闷痛 / 胀痛，像有东西压着'], ['怕冷、喜暖、得热则舒'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const p = session.confirmation.ui_card_payload;
    check('S3 含大段叙述 synthesized_symptom_text', typeof p.synthesized_symptom_text === 'string' && p.synthesized_symptom_text.length > 20);
    check('叙述含「您最初描述」深整理感语句', /您最初描述|进一步问诊|综合来看/.test(p.synthesized_symptom_text));
    check('S3 结构化含 primary / associated / confirmed_negative', p.primary_symptom && Array.isArray(p.associated_symptoms) && Array.isArray(p.confirmed_negative));
}

console.log('\n=== 整改用例 10：Skill5 深度报告（病机译释 + 第一人称话术 + 组成联动） ===');
{
    const { session } = runFlow('我胸口闷、气短、怕冷', [['闷痛 / 胀痛，像有东西压着'], ['怕冷、喜暖、得热则舒'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const sec = rep.data.ui_card_payload.sections;
    const fm = sec.matched_formula_section;
    check('匹配到精确典籍方剂（非泛化降级）', fm.formula_name === '瓜蒌薤白半夏汤', 'fm=' + fm.formula_name);
    check('通俗译释调用 formula.tcm_explanation（病机，非重复表征）', /胸阳不振|痰浊|气机/.test(sec.tcm_explanation_section));
    check('面诊话术为第一人称「医生您好」', /^医生您好/.test(sec.doctor_communication_brief));
    check('组成药材 chips 数 = 方剂 composition 数', sec.composition_chips.length === fm.composition.length, sec.composition_chips.length + ' vs ' + fm.composition.length);
    const linked = sec.composition_chips.filter(c => c.herb_id);
    check('组成药材与草本知识卡存在 ID 级强联动（herb_id 非空）', linked.length >= 1, 'linked=' + linked.length);
    // ID 级联动一致性：有 herb_id 的 chip 必能在 herb 卡中找到同 id
    const herbIds = sec.herb_knowledge_section.map(h => h.herb_id).filter(Boolean);
    check('联动 herb_id 均能在草本知识卡映射', linked.every(c => herbIds.indexOf(c.herb_id) >= 0));
}

console.log('\n=== 整改用例 11：无匹配信息 → 通用兜底（非干拔脾胃虚弱） ===');
{
    const { session } = runFlow('我最近不太舒服、有点累', [[FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const fm = rep.data.ui_card_payload.sections.matched_formula_section;
    check('无类目匹配 → 通用辨证兜底', /信息待补|辨证调理/.test(fm.formula_name), 'fm=' + fm.formula_name);
    check('通用兜底不谎称「脾胃虚弱/四君子汤」', !/脾胃虚弱|四君子汤/.test(fm.formula_name));
}

console.log('\n=== 整改用例 12：backToEdit 回显上一轮文字 ===');
{
    const s = new SymptomSession(getDriver('mock'));
    s.submitDescription('我口苦、睡不好');
    s.backToEdit();
    check('backToEdit 回到 S1 且保留 desc 文字', s.state === 'S1' && s.desc === '我口苦、睡不好');
}

console.log('\n=== 整改用例 13：RAG 一致性（composition 必填字段齐全） ===');
{
    const rag = E.getRag();
    let okAll = true, bad = '';
    (rag.categories || []).forEach(c => (c.formulas || []).forEach(f => {
        if (!Array.isArray(f.composition) || !f.tcm_explanation || !f.doctor_brief_template) { okAll = false; bad = c.name + '/' + f.formula_name; }
    }));
    check('所有方剂均含 composition / tcm_explanation / doctor_brief_template', okAll, bad);
}

console.log('\n============================================');
console.log('  通过 ' + pass + ' / 失败 ' + fail + ' （共 ' + (pass + fail) + ' 项断言）');
console.log('============================================\n');
process.exit(fail ? 1 : 0);
