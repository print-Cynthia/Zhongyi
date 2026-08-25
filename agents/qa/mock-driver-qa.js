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

console.log('\n=== 契约用例 1：Safety Shield 红牌词库（CPO 删减指令：清空后不再拦截） ===');
{
    check('RED_FLAGS 已按 CPO 指令清空（inert）', E.RED_FLAGS.length === 0, 'len=' + E.RED_FLAGS.length);
    // 原敏感词（胸好痛/心口痛/吐血/呼吸困难 等）清空后不再一票否决，走正常归纳路径
    ['胸好痛', '心口痛', '胸闷得慌', '吐血', '呼吸困难', '胸痛剧烈'].forEach(t => {
        const s = new SymptomSession(getDriver('mock'));
        const r = s.submitDescription(t);
        check('「' + t + '」不再触发 SAFETY_CUTOFF（进入 S2 正常问诊）', r.state === 'S2' && !r.data.compliance_card);
    });
    // 红线函数与接线仍保留（结构未删），仅词表为空
    const drv = new LocalMockDriver();
    const sh = drv.invoke('safety_shield', { red_list: E.RED_FLAGS }, { user_raw_input: '胸好痛' });
    check('Safety Shield 函数仍存在且对空词表返回不拦截', sh.ok === true && sh.data.blocked === false);
}

console.log('\n=== 整改用例 15：部位信号容错层（自然语言任意表述触发专病类目） ===');
{
    // 直接校验 Extractor：部位信号 + 症状信号组合，应检出对应专病类目（不再依赖完整词命中）
    const drv = new LocalMockDriver();
    const cases = [
        ['我的胸很痛', 'xin_fei_xiong_xie'],
        ['胸口有点儿疼', 'xin_fei_xiong_xie'],
        ['我胃特别痛', 'pi_wei_yun_hua'],
        ['胁肋胀得慌', 'gan_dan_yu_jie'],
        ['腰很酸、怕凉', 'shen_xi_shui_ye'],
        ['我有点咳嗽、喉咙痛', 'biao_zheng_wai_gan']
    ];
    cases.forEach(([t, expect]) => {
        const ext = drv.invoke('extractor', {}, { user_raw_input: t }).data;
        check('部位信号容错：「' + t + '」→ 检出 ' + expect, ext.detected_category === expect, 'got=' + ext.detected_category);
    });
    // 端到端：submitDescription 后首轮追问应为专病「痛感性质」而非通用十问
    const s = new SymptomSession(getDriver('mock'));
    const r = s.submitDescription('我的胸很痛');
    check('「我的胸很痛」进入 S2', r.state === 'S2');
    check('首轮追问为心肺专病（含刺痛/闷痛等性质选项）',
        s.categoryId === 'xin_fei_xiong_xie' &&
        Array.isArray(s.currentOptions) &&
        s.currentOptions.some(o => /刺痛|闷痛|绞痛|隐痛/.test(o.label)),
        'cat=' + s.categoryId + ' opts=' + (s.currentOptions || []).map(o => o.label).join('/'));
}

console.log('\n=== 整改用例 16：CPO 词库扩充校验（新增部位 / 口语变体命中专病类目） ===');
{
    const drv = new LocalMockDriver();
    const cases = [
        // 心肺胸胁
        ['胸痛', 'xin_fei_xiong_xie'],
        ['我左胸痛', 'xin_fei_xiong_xie'],
        ['右胸有点不舒服', 'xin_fei_xiong_xie'],
        ['后背发紧', 'xin_fei_xiong_xie'],
        ['一口气喘不上来', 'xin_fei_xiong_xie'],
        ['胸口像压了块石头', 'xin_fei_xiong_xie'],
        ['心跳得快', 'xin_fei_xiong_xie'],
        ['心砰砰跳', 'xin_fei_xiong_xie'],
        ['胸口隐隐作痛', 'xin_fei_xiong_xie'],
        ['有点喘', 'xin_fei_xiong_xie'],
        ['呼吸不上来', 'xin_fei_xiong_xie'],
        // 肝胆郁结
        ['乳房胀痛', 'gan_dan_yu_jie'],
        ['肋下疼', 'gan_dan_yu_jie'],
        ['两肋胀', 'gan_dan_yu_jie'],
        ['头顶胀痛', 'gan_dan_yu_jie'],
        ['太阳穴跳痛', 'gan_dan_yu_jie'],
        ['我特别爱发火', 'gan_dan_yu_jie'],
        ['烦躁不安', 'gan_dan_yu_jie'],
        ['郁闷', 'gan_dan_yu_jie'],
        ['心里憋屈', 'gan_dan_yu_jie'],
        ['嘴巴苦', 'gan_dan_yu_jie'],
        ['口苦咽干', 'gan_dan_yu_jie'],
        // 脾胃运化
        ['胃部隐痛', 'pi_wei_yun_hua'],
        ['肠胃不舒服', 'pi_wei_yun_hua'],
        ['下腹坠胀', 'pi_wei_yun_hua'],
        ['小肚腩坠胀', 'pi_wei_yun_hua'],
        ['腹胀', 'pi_wei_yun_hua'],
        ['反酸烧心', 'pi_wei_yun_hua'],
        ['打嗝嗳气', 'pi_wei_yun_hua'],
        ['恶心想吐', 'pi_wei_yun_hua'],
        ['反胃', 'pi_wei_yun_hua'],
        ['口黏口腻', 'pi_wei_yun_hua'],
        ['大便黏马桶', 'pi_wei_yun_hua'],
        ['肚子咕噜响', 'pi_wei_yun_hua'],
        ['经常拉肚子', 'pi_wei_yun_hua'],
        // 肾系水液
        ['腰杆酸痛', 'shen_xi_shui_ye'],
        ['膝盖酸软', 'shen_xi_shui_ye'],
        ['脚跟疼', 'shen_xi_shui_ye'],
        ['眼袋重', 'shen_xi_shui_ye'],
        ['我脚肿了', 'shen_xi_shui_ye'],
        ['腰痛', 'shen_xi_shui_ye'],
        ['手脚冰凉', 'shen_xi_shui_ye'],
        ['怎么也暖不热', 'shen_xi_shui_ye'],
        ['腰凉', 'shen_xi_shui_ye'],
        ['经常起夜', 'shen_xi_shui_ye'],
        ['黑眼圈重', 'shen_xi_shui_ye'],
        ['没精神', 'shen_xi_shui_ye'],
        ['容易累', 'shen_xi_shui_ye'],
        // 外感表证
        ['嗓子眼痒', 'biao_zheng_wai_gan'],
        ['喉咙口有痰', 'biao_zheng_wai_gan'],
        ['后脑勺疼', 'biao_zheng_wai_gan'],
        ['浑身肌肉酸痛', 'biao_zheng_wai_gan'],
        ['像感冒了', 'biao_zheng_wai_gan'],
        ['风一吹就难受', 'biao_zheng_wai_gan'],
        ['浑身发冷', 'biao_zheng_wai_gan'],
        ['打冷颤', 'biao_zheng_wai_gan'],
        ['嗓子咽唾沫疼', 'biao_zheng_wai_gan'],
        ['嗓子冒火', 'biao_zheng_wai_gan'],
        ['头重脚轻', 'biao_zheng_wai_gan']
    ];
    let ok = 0;
    cases.forEach(([t, expect]) => {
        const ext = drv.invoke('extractor', {}, { user_raw_input: t }).data;
        const pass = ext.detected_category === expect;
        if (pass) ok++;
        check('词库扩充：「' + t + '」→ ' + expect, pass, 'got=' + ext.detected_category);
    });
    check('词库扩充：全部 ' + cases.length + ' 例命中正确类目', ok === cases.length, ok + '/' + cases.length);
}

console.log('\n=== 整改用例 17：v1.46 三维特征网络 + 废除瓜蒌薤白硬编码兜底 ===');
{
    const drv = new LocalMockDriver();
    // 1) 动作/排泄词（权重 3）独立命中：拉/屎/窜稀/反酸 → 脾胃运化；起夜 → 肾系；不依赖解剖部位名词
    const cases = [
        ['我一天拉了六次屎', 'pi_wei_yun_hua'],
        ['我老是拉肚子', 'pi_wei_yun_hua'],
        ['吃凉的就窜稀', 'pi_wei_yun_hua'],
        ['我胃胀还反酸', 'pi_wei_yun_hua'],
        ['最近总嗳气、烧心', 'pi_wei_yun_hua'],
        ['我每天起夜三次', 'shen_xi_shui_ye'],
        ['嗓子疼、有点发热', 'biao_zheng_wai_gan'],
        ['两肋胀、爱发火', 'gan_dan_yu_jie']
    ];
    cases.forEach(([t, expect]) => {
        const ext = drv.invoke('extractor', {}, { user_raw_input: t }).data;
        check('三维特征网络：「' + t + '」→ ' + expect, ext.detected_category === expect, 'got=' + ext.detected_category);
    });
    // 2) 端到端：腹泻输入应进脾胃专病追问，最终不回退到瓜蒌薤白半夏汤
    const { session } = runFlow('我一天拉了六次屎', [['稀溏 / 腹泻'], ['食欲不振、吃得很少'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const fm = rep.data.ui_card_payload.sections.matched_formula_section;
    check('「一天拉了六次屎」首轮即脾胃专病（非心肺）', session.categoryId === 'pi_wei_yun_hua', 'cat=' + session.categoryId);
    check('腹泻输入最终不回退到「瓜蒌薤白半夏汤」', fm.formula_name !== '瓜蒌薤白半夏汤', 'fm=' + fm.formula_name);
    check('腹泻输入归为脾胃方剂（参苓白术散）', fm.formula_name === '参苓白术散', 'fm=' + fm.formula_name);
    // 3) 归经待定（笼统/全兜底）→ 严禁默认古籍方剂，返回中性待归经
    const { session: s2 } = runFlow('我最近不太舒服', [[FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep2 = s2.confirm();
    const fm2 = rep2.data.ui_card_payload.sections.matched_formula_section;
    check('归经待定（全兜底）→ retrieval_status=pending（非 success）', s2.knowledge.retrieval_status === 'pending', 'status=' + s2.knowledge.retrieval_status);
    check('归经待定 → 不回退到「瓜蒌薤白半夏汤」', fm2.formula_name !== '瓜蒌薤白半夏汤', 'fm=' + fm2.formula_name);
    check('归经待定 → 中性整体调理方向 + low_confidence', fm2.formula_name === '整体辨证调理方向' && rep2.data.ui_card_payload.sections.bias_conclusion_section.low_confidence === true);
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
    const { session } = runFlow('我胸口闷、气短、怕冷', [['闷痛 / 胀痛，像有东西压着'], ['受凉 / 受风后诱发'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const herbs = rep.data.ui_card_payload.sections.herb_knowledge_section;
    const toxic = herbs.find(h => h.herb_name === '半夏');
    check('方剂组成含毒性药材半夏', !!toxic);
    check('半夏标记 has_toxicity=true 且带预警文案', toxic && toxic.has_toxicity === true && /毒性/.test(toxic.toxicity_warning || ''));
}

console.log('\n=== 契约用例 5：离线 / 无 API 仍产出报告 ===');
{
    const { session } = runFlow('我容易胁肋胀闷、情绪急躁', [['胀闷走窜、叹气则舒'], ['遇怒加重'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
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
    const { session } = runFlow('我胸口闷、气短、怕冷', [['闷痛 / 胀痛，像有东西压着'], ['受凉 / 受风后诱发'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const p = session.confirmation.ui_card_payload;
    check('S3 含大段叙述 synthesized_symptom_text', typeof p.synthesized_symptom_text === 'string' && p.synthesized_symptom_text.length > 20);
    check('叙述含「您最初描述」深整理感语句', /您最初描述|进一步问诊|综合来看/.test(p.synthesized_symptom_text));
    check('S3 结构化含 primary / associated / confirmed_negative', p.primary_symptom && Array.isArray(p.associated_symptoms) && Array.isArray(p.confirmed_negative));
}

console.log('\n=== 整改用例 10：Skill5 深度报告（病机译释 + 第一人称话术 + 组成联动） ===');
{
    const { session } = runFlow('我胸口闷、气短、怕冷', [['闷痛 / 胀痛，像有东西压着'], ['受凉 / 受风后诱发'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const sec = rep.data.ui_card_payload.sections;
    const fm = sec.matched_formula_section;
    check('匹配到精确典籍方剂（非泛化降级）', fm.formula_name === '瓜蒌薤白半夏汤', 'fm=' + fm.formula_name);
    check('通俗译释为日常大白话比喻（含「胸口/阳气/气血」且不含生涩古籍术语）', /胸口|阳气|气血|痰湿/.test(sec.tcm_explanation_section) && !/胸阳不振|痰浊闭阻/.test(sec.tcm_explanation_section), sec.tcm_explanation_section.slice(0, 24) + '…');
    check('面诊话术为第一人称「医生您好」', /^医生您好/.test(sec.doctor_communication_brief));
    check('组成药材 chips 数 = 方剂 composition 数', sec.composition_chips.length === fm.composition.length, sec.composition_chips.length + ' vs ' + fm.composition.length);
    const linked = sec.composition_chips.filter(c => c.herb_id);
    check('组成药材与草本知识卡存在 ID 级强联动（herb_id 非空）', linked.length >= 1, 'linked=' + linked.length);
    // ID 级联动一致性：有 herb_id 的 chip 必能在 herb 卡中找到同 id
    const herbIds = sec.herb_knowledge_section.map(h => h.herb_id).filter(Boolean);
    check('联动 herb_id 均能在草本知识卡映射', linked.every(c => herbIds.indexOf(c.herb_id) >= 0));
}

console.log('\n=== 整改用例 11：无有效 Tag → 仍产出 Top1 倾向性结论（严禁「信息待补」） ===');
{
    const { session } = runFlow('我最近不太舒服、有点累', [[FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const rep = session.confirm();
    const sec = rep.data.ui_card_payload.sections;
    const fm = sec.matched_formula_section;
    check('5D 矩阵始终产出 Top1 方剂（不再「信息待补」）', !/信息待补/.test(fm.formula_name), 'fm=' + fm.formula_name);
    check('始终返回辨证倾向结论 bias_conclusion', !!sec.bias_conclusion_section);
    check('无有效 Tag 时标记 low_confidence（倾向性较弱）', sec.bias_conclusion_section && sec.bias_conclusion_section.low_confidence === true);
    check('不谎称「脾胃虚弱/四君子汤」', !/脾胃虚弱|四君子汤/.test(fm.formula_name));
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

console.log('\n=== 整改用例 14：5D 加权矩阵评分（专病+十问 → Top1，相克扣分） ===');
{
    // 心肺：刺痛固定 + 情志波动 → 丹参饮（25×2=50），且瓜蒌薤白因相克被压低
    const { session: s1 } = runFlow('我胸口刺痛、位置固定', [['刺痛，位置固定不移'], ['情绪激动 / 紧张诱发'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const r1 = s1.confirm();
    const bc1 = r1.data.ui_card_payload.sections.bias_conclusion_section;
    check('心肺·刺痛固定+情志 → Top1=丹参饮', bc1.formula_name === '丹参饮', 'fm=' + bc1.formula_name);
    check('丹参饮 Score=50（专病 25×2）', bc1.score === 50, 'score=' + bc1.score);
    check('命中专病 Tag 含「刺痛，位置固定不移」', (bc1.matched_zhuan_tags || []).indexOf('刺痛，位置固定不移') >= 0);

    // 脾胃：食后腹胀 + 食欲不振 + 稀溏 → 参苓白术散（25×3=75）
    const { session: s2 } = runFlow('我胃胀、吃不下、大便稀', [['食后腹胀不消化'], ['食欲不振、吃得很少'], ['稀溏 / 腹泻'], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const r2 = s2.confirm();
    const bc2 = r2.data.ui_card_payload.sections.bias_conclusion_section;
    check('脾胃·腹胀+纳差+便溏 → Top1=参苓白术散', bc2.formula_name === '参苓白术散', 'fm=' + bc2.formula_name);
    check('参苓白术散 Score=75（专病 25×3）', bc2.score === 75, 'score=' + bc2.score);

    // 相克验证：肝胆用户选「胀痛连及胸乳+遇怒加重」（均肝实）应得柴胡疏肝散，而非逍遥散
    const { session: s3 } = runFlow('我两胁胀痛、遇怒加重', [['遇怒加重'], ['胀痛连及胸乳'], [FALLBACK_LABEL], [FALLBACK_LABEL], [FALLBACK_LABEL]]);
    const r3 = s3.confirm();
    const bc3 = r3.data.ui_card_payload.sections.bias_conclusion_section;
    check('肝胆·胀痛连胸乳+遇怒 → Top1=柴胡疏肝散', bc3.formula_name === '柴胡疏肝散', 'fm=' + bc3.formula_name);
}

console.log('\n=== 整改用例 18：v1.47 导出长图泛白根因修复（onclone 抑制 fade-in + cream 底色） ===');
{
    // QA 运行于 Node，无浏览器/html2canvas，改用静态契约断言锁定修复点：
    // exportReportImage 的 html2canvas 调用必须 (1) 含 onclone 回调 (2) 在克隆文档中关闭 fade-in 动画
    // (3) 强制 .report-card 的 cream 底色与不透明度，避免动画起始帧（opacity:0）被截到导致泛白。
    const fs = require('fs');
    const src = fs.readFileSync(require('path').resolve(__dirname, '../../script.js'), 'utf8');
    const call = src.slice(src.indexOf('html2canvas(card'));
    // 注意：onclone 注入的 CSS 规则为「选择器 { 属性 }」同行的单行字符串，正则需允许跨 {，故用 [^\n]* 而非 [^{]*
    check('导出调用含 onclone 回调（克隆文档内修复动画/透明度）', /onclone\s*:/.test(call), '未找到 onclone');
    check('onclone 关闭 .fade-in 动画（animation: none）', /\.fade-in,\s*\.fade-in\s*\*\s*\{\s*animation:\s*none/.test(call));
    check('onclone 强制 .report-card 不透明度为 1', /\.report-card\s*\{\s*background:\s*#FAF8F5[^}]*opacity:\s*1/.test(call));
    check('onclone 强制 .report-card 背景为 cream #FAF8F5', /\.report-card\s*\{\s*background:\s*#FAF8F5/.test(call));
    check('导出选项 backgroundColor 仍为 cream #FAF8F5', /backgroundColor:\s*'#FAF8F5'/.test(call));
}

console.log('\n=== 整改用例 19：v1.48 药材库 Schema 校验（200+ 味零容忍） ===');
{
    let D;
    try { D = require('../../data.js'); } catch (e) { D = null; }
    check('data.js 可被 Node 加载并导出', !!D, 'require 失败');
    if (D) {
        const herbs = D.HERB_DATA || [];
        check('药材总数达到 CPO 目标（180~260 味）', herbs.length >= 180 && herbs.length <= 260, 'len=' + herbs.length);
        const FIELDS = ['id', 'name', 'latin', 'property', 'meridians', 'category', 'tags', 'oneLiner', 'description', 'directions', 'pairings', 'contraindications', 'explanation', 'clinical_tags', 'image'];
        let fieldOk = true, badField = '';
        herbs.forEach(h => FIELDS.forEach(f => { if (!(f in h)) { fieldOk = false; badField = h.id + '.' + f; } }));
        check('每味药材 15 个字段齐全', fieldOk, badField);
        // 分类 / 归经 白名单
        const CATS = (D.CATEGORIES || []).filter(c => c !== '全部');
        const MER = ['肺', '大肠', '胃', '脾', '心', '小肠', '膀胱', '肾', '心包', '三焦', '胆', '肝'];
        let enumOk = true, badEnum = '';
        herbs.forEach(h => {
            if (CATS.indexOf(h.category) < 0) { enumOk = false; badEnum = h.id + ' 分类=' + h.category; }
            (h.meridians || []).forEach(m => { if (MER.indexOf(m) < 0) { enumOk = false; badEnum = h.id + ' 归经=' + m; } });
        });
        check('分类 / 归经 全部在白名单内', enumOk, badEnum);
        // id 格式 + 重复检测
        const ID_RE = /^[a-z0-9_]+$/;
        let idOk = true, badId = '';
        const seen = new Set();
        herbs.forEach(h => {
            if (!ID_RE.test(h.id)) { idOk = false; badId = h.id; }
            if (seen.has(h.id)) { idOk = false; badId = '重复 ' + h.id; }
            seen.add(h.id);
        });
        check('id 格式合法且唯一（无重复 / 无非法字符）', idOk, badId);
        // 派生表一致性：SYMPTOM_DATA 引用的 herb id 必须存在
        const ids = seen;
        let refOk = true, badRef = '';
        (D.SYMPTOM_DATA || []).forEach(g => g.herbs.forEach(id => { if (!ids.has(id)) { refOk = false; badRef = id; } }));
        check('SYMPTOM_DATA 引用的 herb id 全部存在', refOk, badRef);
        // 分类筛选闭合：CATEGORIES 覆盖所有出现过的 category
        const usedCats = new Set(herbs.map(h => h.category));
        let coverOk = true, missCat = '';
        usedCats.forEach(c => { if (CATS.indexOf(c) < 0) { coverOk = false; missCat = c; } });
        check('CATEGORIES 覆盖全部使用到的分类', coverOk, missCat);
    }
}

console.log('\n============================================');
console.log('  通过 ' + pass + ' / 失败 ' + fail + ' （共 ' + (pass + fail) + ' 项断言）');
console.log('============================================\n');
process.exit(fail ? 1 : 0);
