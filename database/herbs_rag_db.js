/**
 * database/herbs_rag_db.js — 中医语料库（PRD §3.3 三大层级）运行期载体
 *
 * 与 database/herbs_rag_db.json 内容完全一致，是本语料库在浏览器 / Node 下的
 * 同步访问入口（window.HERBS_RAG_DB / module.exports）。引擎只读此对象，
 * 不内嵌任何方剂 / 映射数据，实现「数据 / 逻辑解耦」。
 *
 * 5D 推理矩阵（CPO 终极指令）数据约定：
 *   - depth_prompts / global_inquiry 的 options 为 {label, tag} 对象；
 *     label=面向用户展示，tag=机器可识别的稳定标识，供加权矩阵评分与叙述回显。
 *   - 每个 formula 含：
 *       zhuan_tags       专病 Tag（命中 ×25，来自本类目 depth_prompts 的 tag）
 *       shiwen_tags      十问 Tag（命中 ×15，来自 global_inquiry 的 tag）
 *       incompatible_tags 相克 Tag（命中 ×−20，与本病机相左的 tag）
 *   评分公式：Score = Σ(专病Tag×25) + Σ(十问Tag×15) − Σ(相克Tag×20)，遍历全部方剂取 Top1。
 *
 * 自然语言容错层（CPO 词库扩充指令）：
 *   - 每类新增 region_keywords（部位信号：胸/胁/胃/腰/感冒…），Extractor 命中即 +2 并标记 body 维度，
 *     使「胸很痛 / 胸口有点疼 / 胃特别痛」等任意自然表述都能触发对应专病类目，不再依赖完整词命中。
 *   - 全局 symptom_signals（痛/疼/胀/闷…）与部位信号组合时再 +1，强化专病指向。
 *   - oral_synonyms 已扩充程度副词（很/好/有点/特别/十分）× 症状同义（痛/疼/酸痛…）× 部位变体（胸/胸口/胸腔…）。
 *
 * 如需修改语料，请以 .json 为准（人工可读、供 CPO 评审），并保证本文件与之同步，
 * 质量组 QA 会校验两者一致性（agents/qa/mock-driver-qa.js）。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.HERBS_RAG_DB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';
    return {
        version: "1.2",
        desc: "身体信号整理模块 · 中医语料库（PRD §3.3 三大层级 + 5D 推理矩阵 Tag + 部位信号容错层）。Layer1 体征标准化规范表、Layer2 问诊推导逻辑表（十问篇）、Layer3 结构化归纳与草本映射表。",
        // 全局症状信号词：与部位信号（region_keywords）组合判定专病类目，提升自然语言容错
        symptom_signals: ["痛", "疼", "胀", "闷", "堵", "酸", "麻", "木", "晕", "鸣", "慌", "悸", "促", "短", "乏", "疲", "沉", "肿", "咳", "喘", "呛", "痒", "烧", "坠"],
        categories: [
            {
                id: "xin_fei_xiong_xie",
                name: "心肺胸胁",
                standard_keywords: ["胸胁胀痛", "胸胁刺痛", "胸闷", "心悸", "气短", "咳喘", "心前区不适"],
                region_keywords: ["胸", "心口", "心前", "胸口", "胸前", "胸腔", "膻中", "心脏", "左胸", "右胸", "后背", "心窝", "心口窝"],
                oral_synonyms: [
                    { oral: ["胸好痛", "胸口痛", "心口痛", "胸痛", "胸疼", "胸口闷", "胸闷得慌", "心口堵", "胸口像压着", "胸口像压了块石头"], standard: "胸胁胀痛", dimension: "body" },
                    { oral: ["胸很痛", "胸特别痛", "胸好痛", "胸口很痛", "胸腔痛", "前胸痛", "胸前痛", "胸疼", "胸口疼", "胸部痛", "胸有点痛", "胸有点儿疼", "胸特别疼", "胸部胀痛", "胸刺痛", "胸隐痛", "胸很疼", "胸口隐隐作痛"], standard: "胸胁胀痛", dimension: "body" },
                    { oral: ["胸很闷", "胸口很闷", "胸闷", "胸口闷", "胸腔闷", "胸堵得慌", "胸口堵", "胸胀", "胸口像压着", "胸口闷得慌", "胸前堵", "胸发闷"], standard: "胸胁胀痛", dimension: "body" },
                    { oral: ["心口痛", "心口疼", "心前痛", "心窝痛", "心脏痛", "心口闷", "心口堵", "心口像压着", "心口发闷", "心口刺痛"], standard: "胸胁胀痛", dimension: "body" },
                    { oral: ["喘不上气", "气不够用", "上不来气", "出气费劲", "气短", "喘气急", "一口气喘不上来", "有点喘", "呼吸不上来"], standard: "气短", dimension: "body" },
                    { oral: ["心慌", "心跳快", "心里发慌", "心突突", "心惊", "心悸", "心跳得快", "心砰砰跳"], standard: "心悸", dimension: "body" }
                ],
                depth_prompts: {
                    pain_nature: {
                        question: "胸痛 / 胸闷的具体性质更接近哪一种？（可多选）",
                        options: [
                            { label: "刺痛，位置固定不移", tag: "xf_ci_tong" },
                            { label: "闷痛 / 胀痛，像有东西压着", tag: "xf_men_zhang" },
                            { label: "隐痛，劳累后明显", tag: "xf_yin_tong" },
                            { label: "绞痛，伴冷汗", tag: "xf_jiao_tong" },
                            { label: "放射到肩背或手臂", tag: "xf_fang_she" }
                        ],
                        dimension: "property"
                    },
                    trigger: {
                        question: "通常在什么情况下加重或诱发？（可多选）",
                        options: [
                            { label: "劳累 / 活动后加重", tag: "xf_trig_laolei" },
                            { label: "情绪激动 / 紧张诱发", tag: "xf_trig_qingzhi" },
                            { label: "受凉 / 受风后诱发", tag: "xf_trig_shoulang" },
                            { label: "伴心慌 / 气短", tag: "xf_trig_xinhuan" }
                        ],
                        dimension: "trigger"
                    }
                },
                primary_formula_id: "gualou_xiebai_banxia",
                formulas: [
                    {
                        id: "gualou_xiebai_banxia",
                        formula_name: "瓜蒌薤白半夏汤",
                        source_book: "《金匮要略》",
                        composition: ["瓜蒌", "薤白", "半夏", "白酒"],
                        tcm_explanation: "胸阳不振、痰浊闭阻，气机不通则胸胁闷痛、喘息不畅。该思路重在通阳散结、豁痰下气，是针对“胸痹”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我最近（约{{onset}}前）开始觉得{{primary}}，尤其劳累或情绪紧张时明显，有时像有东西压着、喘不上气。{{aggravating_note}}想请您看看是不是胸阳不振、气滞痰阻的问题。",
                        fruit: "痰浊偏盛者宜食白萝卜、陈皮等理气化痰食材，少食肥甘厚味。",
                        habit: "避免过劳与情绪剧烈波动，注意保暖，戒烟限酒。",
                        zhuan_tags: ["xf_men_zhang", "xf_fang_she", "xf_trig_shoulang"],
                        shiwen_tags: ["han_cold", "excretion_tang"],
                        incompatible_tags: ["xf_ci_tong", "xf_trig_qingzhi"]
                    },
                    {
                        id: "danshen_yin",
                        formula_name: "丹参饮",
                        source_book: "《时方歌括》",
                        composition: ["丹参", "檀香", "砂仁"],
                        tcm_explanation: "气滞血瘀、心胃不和，故胸脘刺痛、固定不移。该思路重在活血化瘀、行气止痛，是针对“瘀阻心胃”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我容易心口刺痛、位置比较固定，时常嗳气或胃脘不适（约{{onset}}前开始）。{{aggravating_note}}想请您判断是否为气滞血瘀所致。",
                        fruit: "血瘀体质可适量食山楂、黑木耳等活血食材，避免油腻。",
                        habit: "规律起居，适度舒展运动，避免久坐与情志郁结。",
                        zhuan_tags: ["xf_ci_tong", "xf_trig_qingzhi", "xf_yin_tong"],
                        shiwen_tags: ["emotion_irritable", "han_hot"],
                        incompatible_tags: ["xf_men_zhang", "xf_fang_she", "xf_trig_shoulang"]
                    }
                ],
                herbs: [{ id: "banxia", name: "半夏" }, { id: "danshen", name: "丹参" }]
            },
            {
                id: "gan_dan_yu_jie",
                name: "肝胆郁结",
                standard_keywords: ["胁肋胀痛", "肝郁气滞", "善太息", "情绪抑郁", "急躁易怒", "乳房胀痛"],
                region_keywords: ["胁", "肋", "肝", "乳", "两胁", "胁肋", "肋骨", "肝区", "右胁", "少腹", "乳房", "胸两侧", "肋下", "两肋", "头顶", "太阳穴"],
                oral_synonyms: [
                    { oral: ["脾气急", "爱发火", "生闷气", "胸口堵得慌", "两肋胀", "肋骨处胀", "胁肋胀", "胸闷想发火"], standard: "胁肋胀痛", dimension: "body" },
                    { oral: ["胁肋很胀", "两肋胀", "肋骨处胀", "胁肋胀痛", "胁肋有点胀", "肋部疼", "胁痛", "右胁痛", "肝区胀", "乳房胀", "两胁胀痛", "胁肋胀闷", "右胁胀痛", "胁肋刺痛"], standard: "胁肋胀痛", dimension: "body" },
                    { oral: ["老想叹气", "叹气舒服点", "善太息", "总想叹气", "叹气"], standard: "善太息", dimension: "body" },
                    { oral: ["心情压抑", "高兴不起来", "闷闷不乐", "情绪抑郁", "郁闷", "心里憋屈"], standard: "情绪抑郁", dimension: "emotion" },
                    { oral: ["脾气很急", "特别爱发火", "容易急躁", "老生气", "肝气不舒", "情志不舒", "一点就着", "急脾气", "动不动就发火", "烦躁不安"], standard: "急躁易怒", dimension: "emotion" },
                    { oral: ["嘴巴苦", "口苦咽干", "口苦"], standard: "口苦咽干", dimension: "body" }
                ],
                depth_prompts: {
                    emotion: {
                        question: "近期的情绪状态更接近哪一种？（可多选）",
                        options: [
                            { label: "容易急躁、一点就着", tag: "gd_irritable" },
                            { label: "生闷气、压抑不舒", tag: "gd_depressed" },
                            { label: "遇事思虑过多", tag: "gd_overthink" },
                            { label: "无明显情绪问题", tag: "gd_none" }
                        ],
                        dimension: "emotion"
                    },
                    pain_nature: {
                        question: "胁肋部位的不适性质？（可多选）",
                        options: [
                            { label: "胀闷走窜、叹气则舒", tag: "gd_zhang_zou" },
                            { label: "刺痛固定", tag: "gd_ci_tong" },
                            { label: "胀痛连及胸乳", tag: "gd_zhang_ru" },
                            { label: "遇怒加重", tag: "gd_yu_nu" }
                        ],
                        dimension: "property"
                    }
                },
                primary_formula_id: "xiaoyao_san",
                formulas: [
                    {
                        id: "xiaoyao_san",
                        formula_name: "逍遥散",
                        source_book: "《太平惠民和剂局方》",
                        composition: ["柴胡", "当归", "白芍", "白术", "茯苓", "甘草", "薄荷", "生姜"],
                        tcm_explanation: "肝郁血虚、脾失健运，故胁胀、情绪不舒、神疲食少。该思路重在疏肝解郁、养血健脾，是针对“肝郁脾虚”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我最近（约{{onset}}前）总觉得胁肋胀闷、情绪容易低落或急躁，胃口也差些。{{aggravating_note}}想请您看看是不是肝郁脾虚、气机不畅。",
                        fruit: "宜食芹菜、玫瑰花茶等疏肝理气食材，少食辛辣油腻。",
                        habit: "保持心情舒畅，适度运动与倾诉，避免熬夜与久思。",
                        zhuan_tags: ["gd_depressed", "gd_zhang_zou", "gd_overthink"],
                        shiwen_tags: ["diet_anor", "sleep_dream"],
                        incompatible_tags: ["gd_irritable", "gd_yu_nu", "gd_ci_tong"]
                    },
                    {
                        id: "chaihu_shugan_san",
                        formula_name: "柴胡疏肝散",
                        source_book: "《景岳全书》",
                        composition: ["柴胡", "白芍", "枳壳", "甘草", "川芎", "香附", "陈皮"],
                        tcm_explanation: "肝气郁结、气滞络阻，故胁肋胀痛、情志不舒。该思路重在疏肝行气、活血止痛，是针对“肝脾气滞”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我两侧胁肋胀痛、遇怒或紧张时明显（约{{onset}}前开始）。{{aggravating_note}}想请您判断是否为肝气郁结、气机阻滞。",
                        fruit: "宜食佛手、陈皮等理气食材，避免壅滞难化之物。",
                        habit: "情志调摄为主，配合舒展运动，避免长期压抑。",
                        zhuan_tags: ["gd_irritable", "gd_zhang_zou", "gd_yu_nu"],
                        shiwen_tags: ["emotion_irritable", "diet_bloat"],
                        incompatible_tags: ["gd_depressed", "gd_overthink", "gd_ci_tong"]
                    }
                ],
                herbs: [
                    { id: "chaihu", name: "柴胡" }, { id: "danggui", name: "当归" }, { id: "baishao", name: "白芍" },
                    { id: "baizhu", name: "白术" }, { id: "fuling", name: "茯苓" }, { id: "gancao", name: "甘草" },
                    { id: "bohe", name: "薄荷" }, { id: "shengjiang", name: "生姜" }, { id: "chuanxiong", name: "川芎" },
                    { id: "chenpi", name: "陈皮" }
                ]
            },
            {
                id: "pi_wei_yun_hua",
                name: "脾胃运化",
                standard_keywords: ["食后腹胀", "食欲不振", "大便溏薄", "胃脘隐痛", "消化不良", "肢体倦怠"],
                region_keywords: ["胃", "腹", "脾", "脘", "肚脐", "腹部", "肚子", "脘腹", "上腹", "中焦", "心下", "胃脘", "胃部", "肠胃", "小肚腩", "下腹"],
                oral_synonyms: [
                    { oral: ["肚子胀", "胃难受", "胃胀", "吃撑了胀", "饭后胀", "腹胀", "腹部胀"], standard: "食后腹胀", dimension: "diet" },
                    { oral: ["肚子很胀", "腹很胀", "胃胀", "吃撑了胀", "饭后胀", "腹部胀", "脘腹胀", "食后腹胀", "肚子胀", "小腹胀", "胃腹胀", "吃一点就胀"], standard: "食后腹胀", dimension: "diet" },
                    { oral: ["吃不下", "没胃口", "不想吃饭", "纳差"], standard: "食欲不振", dimension: "diet" },
                    { oral: ["吃不下", "没胃口", "不想吃饭", "纳差", "食欲差", "吃得少", "不太想吃东西", "吃饭不香"], standard: "食欲不振", dimension: "diet" },
                    { oral: ["拉肚子", "大便稀", "便溏", "大便不成形", "经常拉肚子"], standard: "大便溏薄", dimension: "excretion" },
                    { oral: ["拉肚子", "大便稀", "便溏", "大便不成形", "腹泻", "老拉肚子", "大便偏稀", "一吃凉的就拉", "大便黏马桶"], standard: "大便溏薄", dimension: "excretion" },
                    { oral: ["胃疼", "胃痛", "胃部隐痛"], standard: "胃脘隐痛", dimension: "body" },
                    { oral: ["胃很痛", "胃特别痛", "胃很疼", "胃部痛", "上腹痛", "胃脘痛", "心下痛", "胃疼", "胃有点痛", "胃部隐痛", "胃刺痛", "胃脘隐痛", "胃里疼"], standard: "胃脘隐痛", dimension: "body" },
                    { oral: ["嗳气", "打嗝", "反酸", "烧心", "恶心想吐", "反胃"], standard: "胃气上逆", dimension: "body" },
                    { oral: ["口黏口腻", "口黏", "嘴里发黏"], standard: "口黏口腻", dimension: "body" },
                    { oral: ["肚子咕噜响", "肠鸣", "肚子叫"], standard: "食后腹胀", dimension: "diet" }
                ],
                depth_prompts: {
                    appetite: {
                        question: "胃口与饮食的具体表现？（可多选）",
                        options: [
                            { label: "食欲不振、吃得很少", tag: "pw_anorexia" },
                            { label: "食后腹胀不消化", tag: "pw_bloat" },
                            { label: "喜温喜按、受凉加重", tag: "pw_cold" },
                            { label: "口苦 / 口黏", tag: "pw_bittermouth" }
                        ],
                        dimension: "diet"
                    },
                    stool: {
                        question: "大便情况更接近哪一种？（可多选）",
                        options: [
                            { label: "稀溏 / 腹泻", tag: "pw_tang" },
                            { label: "黏腻不爽", tag: "pw_sticky" },
                            { label: "夹有不消化食物", tag: "pw_undigested" },
                            { label: "正常成形", tag: "pw_normal" }
                        ],
                        dimension: "excretion"
                    }
                },
                primary_formula_id: "shenling_baizhu_san",
                formulas: [
                    {
                        id: "shenling_baizhu_san",
                        formula_name: "参苓白术散",
                        source_book: "《太平惠民和剂局方》",
                        composition: ["党参", "茯苓", "白术", "山药", "薏苡仁", "莲子", "甘草", "砂仁"],
                        tcm_explanation: "脾胃虚弱、湿浊内生，故食少便溏、神疲乏力。该思路重在健脾益气、渗湿止泻，是针对“脾虚夹湿”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我最近（约{{onset}}前）胃口差、饭后容易腹胀，大便偏稀溏、人也容易乏。{{aggravating_note}}想请您看看是不是脾胃虚弱、运化不力。",
                        fruit: "宜食山药、薏苡仁、莲子健脾祛湿食材，少食生冷黏腻。",
                        habit: "三餐规律、七分饱，餐后缓行，注意腹部保暖。",
                        zhuan_tags: ["pw_anorexia", "pw_bloat", "pw_tang"],
                        shiwen_tags: ["diet_anor", "excretion_tang"],
                        incompatible_tags: ["pw_bittermouth", "pw_sticky", "pw_cold"]
                    },
                    {
                        id: "si_jun_zi_tang",
                        formula_name: "四君子汤",
                        source_book: "《太平惠民和剂局方》",
                        composition: ["党参", "白术", "茯苓", "甘草"],
                        tcm_explanation: "脾胃气虚、运化无权，故气短乏力、食少便溏。该思路重在益气健脾，是针对“脾胃气虚”基础方向的知识性参考。",
                        doctor_brief_template: "医生您好，我总觉得没劲、吃饭不香、大便偏软（约{{onset}}前明显）。{{aggravating_note}}想请您判断是否为脾胃气虚。",
                        fruit: "宜食小米、山药等甘温益气食材。",
                        habit: "避免过度劳累，适度运动以助脾气运化。",
                        zhuan_tags: ["pw_anorexia", "pw_bloat", "pw_normal"],
                        shiwen_tags: ["diet_anor", "sleep_tired"],
                        incompatible_tags: ["pw_bittermouth", "pw_sticky", "pw_cold"]
                    },
                    {
                        id: "banxia_xiexin_tang",
                        formula_name: "半夏泻心汤",
                        source_book: "《伤寒论》",
                        composition: ["半夏", "黄芩", "黄连", "干姜", "党参", "大枣", "甘草"],
                        tcm_explanation: "寒热错杂、中焦痞塞，故心下痞满、口苦肠鸣、呕恶。该思路重在寒热平调、散结除痞，是针对“寒热互结中焦”方向的知识性参考（含毒性药材半夏，须炮制久煎）。",
                        doctor_brief_template: "医生您好，我胃脘胀闷堵塞、有时口苦、肠鸣或大便不调（约{{onset}}前开始）。{{aggravating_note}}想请您看看是不是中焦寒热错杂、痞塞不通。",
                        fruit: "宜清淡易消化，少食生冷与滋腻。",
                        habit: "细嚼慢咽、定时定量，避免寒凉与暴饮暴食。",
                        zhuan_tags: ["pw_bloat", "pw_bittermouth"],
                        shiwen_tags: ["diet_bitter", "excretion_sticky"],
                        incompatible_tags: ["pw_normal", "pw_tang", "pw_cold"]
                    }
                ],
                herbs: [
                    { id: "dangshen", name: "党参" }, { id: "fuling", name: "茯苓" }, { id: "baizhu", name: "白术" },
                    { id: "shanyao", name: "山药" }, { id: "yiyiren", name: "薏苡仁" }, { id: "gancao", name: "甘草" },
                    { id: "banxia", name: "半夏" }, { id: "huangqin", name: "黄芩" }, { id: "huanglian", name: "黄连" }
                ]
            },
            {
                id: "shen_xi_shui_ye",
                name: "肾系水液",
                standard_keywords: ["腰膝酸软", "畏寒肢冷", "夜尿频多", "水肿", "精神萎靡", "头晕耳鸣"],
                region_keywords: ["腰", "膝", "肾", "夜尿", "下肢", "腿软", "脚肿", "眼皮肿", "脸肿", "腰骶", "命门", "小腿", "腰杆", "后腰", "膝盖", "脚跟", "眼袋"],
                oral_synonyms: [
                    { oral: ["腰酸", "腰疼", "腰痛", "腰没劲", "腿软", "膝盖软"], standard: "腰膝酸软", dimension: "body" },
                    { oral: ["腰酸", "腰很酸", "腰疼", "腰痛", "腰部痛", "腰很痛", "腰膝酸软", "腰没劲", "腰膝痛", "腰骶酸", "腰特别酸", "腰眼酸", "后腰疼"], standard: "腰膝酸软", dimension: "body" },
                    { oral: ["怕冷", "手脚凉", "畏寒", "比别人怕冻"], standard: "畏寒肢冷", dimension: "property" },
                    { oral: ["怕冷", "手脚凉", "畏寒", "比别人怕冻", "特别怕冷", "有点怕冷", "畏寒肢冷", "手脚冰冷", "手脚冰凉", "怎么也暖不热", "脚冷", "腰凉"], standard: "畏寒肢冷", dimension: "property" },
                    { oral: ["夜尿多", "起夜", "晚上老上厕所"], standard: "夜尿频多", dimension: "excretion" },
                    { oral: ["夜尿多", "起夜", "晚上老上厕所", "夜尿频", "夜尿频繁", "起夜两次以上", "经常起夜"], standard: "夜尿频多", dimension: "excretion" },
                    { oral: ["眼皮肿", "脚肿", "脸肿", "水肿"], standard: "水肿", dimension: "body" },
                    { oral: ["脚肿", "腿肿", "眼皮肿", "脸肿", "下肢肿", "水肿", "小腿肿", "脚踝肿"], standard: "水肿", dimension: "body" },
                    { oral: ["黑眼圈重", "没精神", "容易累", "乏力", "精神差"], standard: "精神萎靡", dimension: "property" }
                ],
                depth_prompts: {
                    kidney_symptom: {
                        question: "腰膝与精力状态更接近哪一种？（可多选）",
                        options: [
                            { label: "腰膝酸软、久站加重", tag: "sx_sore" },
                            { label: "畏寒肢冷、得暖则舒", tag: "sx_cold" },
                            { label: "头晕耳鸣、精神不振", tag: "sx_dizzy" },
                            { label: "夜尿频繁、起夜≥2次", tag: "sx_nighturine" }
                        ],
                        dimension: "body"
                    },
                    urination: {
                        question: "小便与水肿情况？（可多选）",
                        options: [
                            { label: "夜尿多、尿色清长", tag: "sx_clear" },
                            { label: "下肢或眼睑水肿", tag: "sx_edema" },
                            { label: "排尿无力", tag: "sx_weak" },
                            { label: "无明显异常", tag: "sx_none" }
                        ],
                        dimension: "excretion"
                    }
                },
                primary_formula_id: "liu_wei_di_huang",
                formulas: [
                    {
                        id: "liu_wei_di_huang",
                        formula_name: "六味地黄丸",
                        source_book: "《小儿药证直诀》",
                        composition: ["熟地黄", "山茱萸", "山药", "泽泻", "牡丹皮", "茯苓"],
                        tcm_explanation: "肾阴亏虚、虚热内生，故腰膝酸软、头晕耳鸣、五心烦热。该思路重在滋阴补肾，是针对“肾阴不足”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我最近（约{{onset}}前）腰酸腿软、容易头晕耳鸣，有时手心脚心发热。{{aggravating_note}}想请您看看是不是肾阴不足。",
                        fruit: "宜食黑芝麻、桑葚、山药等滋补肾阴食材，少食辛辣燥热。",
                        habit: "避免熬夜与房劳过度，节制用神。",
                        zhuan_tags: ["sx_sore", "sx_dizzy"],
                        shiwen_tags: ["han_hot", "sleep_tired"],
                        incompatible_tags: ["sx_cold", "sx_nighturine", "han_cold"]
                    },
                    {
                        id: "jin_gui_shen_qi",
                        formula_name: "金匮肾气丸",
                        source_book: "《金匮要略》",
                        composition: ["干地黄", "山药", "山茱萸", "泽泻", "茯苓", "桂枝", "附子"],
                        tcm_explanation: "肾阳不足、气化失司，故畏寒肢冷、腰膝冷痛、夜尿频多。该思路重在温补肾阳、化气行水，是针对“肾阳亏虚”方向的知识性参考（含毒性药材附子，须炮制久煎，严禁生用）。",
                        doctor_brief_template: "医生您好，我特别怕冷、腰也酸、晚上起夜次数多（约{{onset}}前明显）。{{aggravating_note}}想请您判断是否为肾阳不足、气化无力。",
                        fruit: "宜食核桃、羊肉等温补食材（适量），避生冷。",
                        habit: "腰部保暖，适度晒太阳与缓步运动，避免过劳。",
                        zhuan_tags: ["sx_cold", "sx_nighturine", "sx_sore"],
                        shiwen_tags: ["han_cold", "excretion_clear"],
                        incompatible_tags: ["sx_dizzy", "han_hot"]
                    },
                    {
                        id: "wu_ling_san",
                        formula_name: "五苓散",
                        source_book: "《伤寒论》",
                        composition: ["猪苓", "茯苓", "泽泻", "白术", "桂枝"],
                        tcm_explanation: "水湿内停、膀胱气化不利，故水肿、小便不利。该思路重在利水渗湿、温阳化气，是针对“水湿停聚”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我最近（约{{onset}}前）有点水肿、小便不多，身体发沉。{{aggravating_note}}想请您看看是不是水湿内停、气化不利。",
                        fruit: "宜食冬瓜、赤小豆等利水食材，少食咸腻。",
                        habit: "避免久坐久卧，适度活动助气化。",
                        zhuan_tags: ["sx_edema", "sx_weak"],
                        shiwen_tags: ["excretion_tang", "excretion_sticky"],
                        incompatible_tags: ["sx_dizzy", "han_hot", "sx_nighturine"]
                    }
                ],
                herbs: [
                    { id: "shanyao", name: "山药" }, { id: "fuling", name: "茯苓" }, { id: "baizhu", name: "白术" }
                ]
            },
            {
                id: "biao_zheng_wai_gan",
                name: "表证外感",
                standard_keywords: ["恶寒发热", "鼻塞流涕", "咽痛", "头痛", "咳嗽", "身痛无汗"],
                region_keywords: ["感冒", "着凉", "受风", "鼻塞", "咽痛", "嗓子", "咳嗽", "头痛", "身痛", "发热", "恶寒", "流涕", "打喷嚏", "浑身酸", "喉咙", "额头", "受寒", "嗓子眼", "喉咙口", "后脑勺", "太阳穴", "浑身肌肉"],
                oral_synonyms: [
                    { oral: ["感冒", "着凉", "受风", "冻着了"], standard: "表证外感", dimension: "body" },
                    { oral: ["感冒", "着凉", "受风", "冻着了", "感冒了", "受寒", "吹风着凉", "着了凉", "像感冒了", "风一吹就难受"], standard: "表证外感", dimension: "body" },
                    { oral: ["发烧", "发热", "怕冷发热", "忽冷忽热"], standard: "恶寒发热", dimension: "property" },
                    { oral: ["发烧", "发热", "怕冷发热", "忽冷忽热", "有点发热", "高烧", "发热重", "低烧", "浑身发冷", "打冷颤"], standard: "恶寒发热", dimension: "property" },
                    { oral: ["嗓子疼", "喉咙痛", "嗓子干"], standard: "咽痛", dimension: "body" },
                    { oral: ["嗓子疼", "喉咙痛", "嗓子干", "咽痛", "喉咙干痒", "嗓子痛", "咽干咽痛", "嗓子咽唾沫疼", "嗓子冒火"], standard: "咽痛", dimension: "body" },
                    { oral: ["流鼻涕", "鼻塞", "鼻子不通"], standard: "鼻塞流涕", dimension: "body" },
                    { oral: ["流鼻涕", "鼻塞", "鼻子不通", "鼻涕", "打喷嚏", "鼻子堵", "流清涕"], standard: "鼻塞流涕", dimension: "body" },
                    { oral: ["头痛", "脑袋疼", "头晕乎乎"], standard: "头痛", dimension: "body" },
                    { oral: ["头痛", "脑袋疼", "头晕乎乎", "头疼", "后脑勺疼", "头胀痛", "太阳穴疼", "头重脚轻"], standard: "头痛", dimension: "body" },
                    { oral: ["浑身酸痛", "身痛", "全身酸", "肌肉酸"], standard: "身痛无汗", dimension: "body" },
                    { oral: ["浑身酸痛", "身痛", "全身酸", "肌肉酸", "浑身疼", "身体酸痛", "骨节酸疼", "浑身肌肉酸痛"], standard: "身痛无汗", dimension: "body" }
                ],
                depth_prompts: {
                    fever_pattern: {
                        question: "发热与怕冷的表现更接近哪一种？（可多选）",
                        options: [
                            { label: "怕冷重、发热轻、无汗", tag: "bz_cold" },
                            { label: "发热重、怕风、有汗", tag: "bz_hot" },
                            { label: "寒热往来、一阵冷一阵热", tag: "bz_alternate" },
                            { label: "仅局部咽痛、无明显寒热", tag: "bz_local" }
                        ],
                        dimension: "property"
                    },
                    accompaniment: {
                        question: "伴随症状有哪些？（可多选）",
                        options: [
                            { label: "鼻塞流涕、打喷嚏", tag: "bz_rhinitis" },
                            { label: "咽痛、咽干", tag: "bz_sorethroat" },
                            { label: "咳嗽、咳痰", tag: "bz_cough" },
                            { label: "头痛身酸、乏力", tag: "bz_bodyache" }
                        ],
                        dimension: "body"
                    }
                },
                primary_formula_id: "yin_qiao_san",
                formulas: [
                    {
                        id: "yin_qiao_san",
                        formula_name: "银翘散",
                        source_book: "《温病条辨》",
                        composition: ["金银花", "连翘", "桔梗", "薄荷", "竹叶", "甘草", "荆芥", "淡豆豉", "牛蒡子", "芦根"],
                        tcm_explanation: "风热袭表、热毒上攻，故发热、咽痛、口渴。该思路重在辛凉解表、清热解毒，是针对“风热表证”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我这两天（约{{onset}}前）开始嗓子疼、有点发热怕风、鼻塞，浑身酸。{{aggravating_note}}想请您看看是不是风热外感。",
                        fruit: "宜饮温水、食梨等清热润喉，避辛辣。",
                        habit: "多休息、避风寒，保持室内通风。",
                        zhuan_tags: ["bz_hot", "bz_sorethroat", "bz_cough"],
                        shiwen_tags: ["han_hot", "sleep_tired"],
                        incompatible_tags: ["bz_cold", "han_cold"]
                    },
                    {
                        id: "sang_ju_yin",
                        formula_name: "桑菊饮",
                        source_book: "《温病条辨》",
                        composition: ["桑叶", "菊花", "杏仁", "桔梗", "甘草", "薄荷", "芦根", "连翘"],
                        tcm_explanation: "风温犯肺、肺失清肃，故咳嗽痰少、咽痛微热。该思路重在疏风清热、宣肺止咳，是针对“风温犯肺”轻证方向的知识性参考。",
                        doctor_brief_template: "医生您好，我近来（约{{onset}}前）咳嗽、嗓子干痒、有点发热，痰不多。{{aggravating_note}}想请您判断是否为风温犯肺。",
                        fruit: "宜食百合、梨等润肺食材，少食甜腻生痰之物。",
                        habit: "保暖避风，充足睡眠助正祛邪。",
                        zhuan_tags: ["bz_sorethroat", "bz_cough", "bz_local"],
                        shiwen_tags: ["han_hot", "sleep_tired"],
                        incompatible_tags: ["bz_cold", "han_cold"]
                    },
                    {
                        id: "gui_zhi_tang",
                        formula_name: "桂枝汤",
                        source_book: "《伤寒论》",
                        composition: ["桂枝", "白芍", "甘草", "生姜", "大枣"],
                        tcm_explanation: "风寒袭表、营卫不和，故恶风发热、汗出、头痛。该思路重在解肌发表、调和营卫，是针对“风寒表虚”方向的知识性参考。",
                        doctor_brief_template: "医生您好，我受了凉（约{{onset}}前）开始怕风、有点发热、出汗、头痛。{{aggravating_note}}想请您看看是不是风寒表证、营卫不和。",
                        fruit: "宜热粥温服助药力，避生冷。",
                        habit: "注意保暖、避风，适度休息。",
                        zhuan_tags: ["bz_cold", "bz_bodyache", "bz_rhinitis"],
                        shiwen_tags: ["han_cold"],
                        incompatible_tags: ["bz_hot", "han_hot"]
                    }
                ],
                herbs: [
                    { id: "jinyinhua", name: "金银花" }, { id: "lianqiao", name: "连翘" }, { id: "jiegeng", name: "桔梗" },
                    { id: "bohe", name: "薄荷" }, { id: "gancao", name: "甘草" }, { id: "juhua", name: "菊花" },
                    { id: "xingren", name: "杏仁" }, { id: "baishao", name: "白芍" }, { id: "shengjiang", name: "生姜" }
                ]
            }
        ],
        global_inquiry: {
            寒热: {
                question: "您平时的寒热偏好更接近哪一种？（可多选）",
                options: [
                    { label: "怕冷、喜暖、得热则舒", tag: "han_cold" },
                    { label: "怕热、喜凉、得凉则舒", tag: "han_hot" },
                    { label: "无明显偏向", tag: "han_none" }
                ],
                dimension: "property",
                reverse: "《十问篇》寒热：喜暖多偏虚寒，喜凉多偏内热。"
            },
            二便: {
                question: "二便情况更接近哪一种？（可多选）",
                options: [
                    { label: "大便干结 / 便秘", tag: "excretion_dry" },
                    { label: "大便稀溏 / 腹泻", tag: "excretion_tang" },
                    { label: "小便黄少", tag: "excretion_yellow" },
                    { label: "小便清长 / 夜尿多", tag: "excretion_clear" }
                ],
                dimension: "excretion",
                reverse: "《十问篇》二便：便溏多虚寒，干结多内热；尿黄属热，清长属寒。"
            },
            睡眠: {
                question: "睡眠与精神状况怎样？（可多选）",
                options: [
                    { label: "入睡困难 / 睡不好", tag: "sleep_hard" },
                    { label: "多梦易醒", tag: "sleep_dream" },
                    { label: "早醒 / 醒后难再睡", tag: "sleep_early" },
                    { label: "精神倦怠 / 乏力", tag: "sleep_tired" }
                ],
                dimension: "sleep",
                reverse: "《十问篇》睡眠：难入睡多属心，易醒多梦多属肝，倦怠多属脾。"
            },
            饮食: {
                question: "最近的饮食与消化如何？（可多选）",
                options: [
                    { label: "食欲不振 / 吃不多", tag: "diet_anor" },
                    { label: "食后腹胀 / 不消化", tag: "diet_bloat" },
                    { label: "口苦 / 口黏", tag: "diet_bitter" },
                    { label: "喜生冷或贪凉饮冷", tag: "diet_cold" }
                ],
                dimension: "diet",
                reverse: "《十问篇》饮食：纳呆多脾虚，口苦多胆热，贪凉多伤阳。"
            }
        }
    };
});
