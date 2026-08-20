/**
 * scripts/import_herbs.js — 草本知行 · 药材知识库单一数据源 + 自动入库 / 校验 / emit
 *
 * v1.48 CPO 裁决（知识库升级）：
 *   - 扩库至 78 味核心高频药材，严密覆盖 补虚(补气/补血/补阳/养阴)、温里、理气、活血、
 *     清热、化湿、利水、解表、止咳、安神、消食、健脾、补肾 等品类。
 *   - Schema v2.0：每味药材含 15 个字段（含 clinical_tags 与 image 两个扩展字段）。
 *   - 零容忍校验：空 key / 非法字符 / 归经越界 / 分类越界 / 重复 id / 必填缺失 一律拒绝。
 *
 * 运行：
 *   node scripts/import_herbs.js --validate   校验全部药材 Schema（零容忍）
 *   node scripts/import_herbs.js --emit        依据单一数据源生成 ../data.js
 *   node scripts/import_herbs.js               打印用法
 *
 * data.js 由本脚本 --emit 自动生成，请勿手工编辑；改药材请改这里的 CANONICAL_HERBS。
 */
'use strict';

const fs = require('fs');
const path = require('path');

/* ===================== 0. 校验常量（零容忍基线） ===================== */
const ID_RE = /^[a-z0-9_]+$/;                                   // id 仅小写字母/数字/下划线
const ILLEGAL_RE = /[\u0000-\u001f<>{}\`$\\]/;                  // 控制字符 + 危险字符
const MERIDIAN_SET = ['肺', '大肠', '胃', '脾', '心', '小肠', '膀胱', '肾', '心包', '三焦', '胆', '肝'];
const CATEGORY_SET = ['清热', '补气', '补血', '补阳', '养阴', '补肾', '温里', '理气', '活血', '化湿', '利水', '解表', '止咳', '安神', '消食', '健脾'];
const REQUIRED_STRING = ['id', 'name', 'latin', 'property', 'category', 'oneLiner', 'description', 'explanation'];
const VALID_PROP_TONES = ['寒', '凉', '平', '温', '热'];        // 药性四气（含微寒/微温/大热等变体）

/* ===================== 1. 单一数据源：CANONICAL_HERBS ===================== */
const CANONICAL_HERBS = [
    // ---------- 原有 30 味（按 TCM 重新归类 + 补 clinical_tags） ----------
    { id: 'huangqi', name: '黄芪', latin: 'Astragalus membranaceus', property: '甘｜微温', meridians: ['肺', '脾'], category: '补气',
      tags: ['补气', '固表'], oneLiner: '常用于了解气虚、乏力、自汗等方向。',
      description: '黄芪被誉为“补气之长”，能增强身体的推动力，固护肌表。',
      directions: ['气虚乏力', '表虚自汗', '利水消肿'],
      pairings: [{ combo: '黄芪 + 白术', effect: '益气固表' }, { combo: '黄芪 + 当归', effect: '气血双补' }],
      contraindications: '实热证、阴虚阳亢者不宜。',
      explanation: '给身体“加点油”，让防御力更稳固。',
      clinical_tags: ['气虚乏力', '表虚自汗', '水肿'], image: '' },
    { id: 'danggui', name: '当归', latin: 'Angelica sinensis', property: '甘、辛｜温', meridians: ['肝', '心', '脾'], category: '补血',
      tags: ['补血', '活血'], oneLiner: '常用于了解血虚萎黄、眩晕心悸等方向。',
      description: '血家圣药，既能补血又能活血，为妇科调血要药。',
      directions: ['血虚萎黄', '月经不调', '跌打损伤'],
      pairings: [{ combo: '当归 + 熟地', effect: '补血滋阴' }, { combo: '当归 + 黄芪', effect: '益气生血' }],
      contraindications: '湿盛中满、大便溏泄者慎用。',
      explanation: '身体的“补血泵”，让血液循环更有活力。',
      clinical_tags: ['血虚', '月经不调', '血瘀'], image: '' },
    { id: 'jinyinhua', name: '金银花', latin: 'Lonicera japonica', property: '甘｜寒', meridians: ['肺', '心', '胃'], category: '清热',
      tags: ['清热', '解毒'], oneLiner: '常用于了解热象明显、咽喉不适等方向。',
      description: '清热解毒的代表，疏散风热效果佳，常用于外感风热。',
      directions: ['风热感冒', '咽喉肿痛', '痈肿疔疮'],
      pairings: [{ combo: '金银花 + 连翘', effect: '清热解毒' }, { combo: '金银花 + 菊花', effect: '疏散风热' }],
      contraindications: '脾胃虚寒者慎用。',
      explanation: '身体的“天然降火茶”，针对红肿热痛。',
      clinical_tags: ['风热', '咽喉肿痛', '热毒'], image: '' },
    { id: 'fuling', name: '茯苓', latin: 'Poria cocos', property: '甘、淡｜平', meridians: ['心', '脾', '肾'], category: '利水',
      tags: ['利水', '健脾'], oneLiner: '常用于了解水肿、脾虚食少等方向。',
      description: '利水渗湿而不伤正气，兼能健脾宁心。',
      directions: ['水肿尿少', '痰饮眩悸', '脾虚食少'],
      pairings: [{ combo: '茯苓 + 白术', effect: '健脾燥湿' }, { combo: '茯苓 + 猪苓', effect: '通利小便' }],
      contraindications: '虚寒滑精、气虚下陷者慎用。',
      explanation: '身体的“除湿机”，让脾胃更干爽。',
      clinical_tags: ['水肿', '脾虚', '痰饮'], image: '' },
    { id: 'chenpi', name: '陈皮', latin: 'Citri Reticulatae Pericarpium', property: '苦、辛｜温', meridians: ['脾', '肺'], category: '理气',
      tags: ['理气', '健脾'], oneLiner: '常用于了解腹胀、食少吐泻等方向。',
      description: '理气健脾，燥湿化痰，重在恢复气机顺畅。',
      directions: ['脘腹胀满', '食少吐泻', '咳嗽痰多'],
      pairings: [{ combo: '陈皮 + 半夏', effect: '燥湿化痰' }, { combo: '陈皮 + 茯苓', effect: '理气健脾' }],
      contraindications: '舌赤少津、内有实热者慎用。',
      explanation: '身体的“顺气器”，消除肚子里的堵塞感。',
      clinical_tags: ['腹胀', '食少', '痰多'], image: '' },
    { id: 'juhua', name: '菊花', latin: 'Chrysanthemum morifolium', property: '甘、苦｜微寒', meridians: ['肺', '肝'], category: '清热',
      tags: ['清热', '明目'], oneLiner: '常用于了解目赤肿痛、头晕目眩等方向。',
      description: '疏散风热，平肝明目，清热解毒。',
      directions: ['目赤肿痛', '头痛眩晕', '风热感冒'],
      pairings: [{ combo: '菊花 + 枸杞子', effect: '滋补肝肾，清肝明目' }, { combo: '菊花 + 薄荷', effect: '疏散风热' }],
      contraindications: '脾胃虚寒者不宜多服。',
      explanation: '眼睛的“降火伴侣”，让视力更清朗。',
      clinical_tags: ['目赤', '头晕', '风热'], image: '' },
    { id: 'gancao', name: '甘草', latin: 'Glycyrrhiza uralensis', property: '甘｜平', meridians: ['心', '肺', '脾', '胃'], category: '补气',
      tags: ['调和', '补气'], oneLiner: '常用于了解调和诸药、咳嗽痰多等方向。',
      description: '“国老”之称，补脾益气，清热解毒，祛痰止咳，调和诸药。',
      directions: ['脾胃虚弱', '倦怠乏力', '调和诸药'],
      pairings: [{ combo: '甘草 + 桔梗', effect: '宣肺利咽' }, { combo: '甘草 + 芍药', effect: '缓急止痛' }],
      contraindications: '湿盛胀满、浮肿者慎用。',
      explanation: '中药里的“和事佬”，协调各方药性。',
      clinical_tags: ['气虚', '咳嗽', '调和'], image: '' },
    { id: 'baizhu', name: '白术', latin: 'Atractylodes macrocephala', property: '苦、甘｜温', meridians: ['脾', '胃'], category: '健脾',
      tags: ['健脾', '燥湿'], oneLiner: '常用于了解脾虚食少、腹胀泄泻等方向。',
      description: '健脾益气，燥湿利水，固表止汗。',
      directions: ['脾虚食少', '腹胀泄泻', '水肿自汗'],
      pairings: [{ combo: '白术 + 茯苓', effect: '健脾利水' }, { combo: '白术 + 黄芪', effect: '益气固表' }],
      contraindications: '阴虚内热、津液亏耗者慎用。',
      explanation: '脾胃的“干燥剂”和“动力泵”。',
      clinical_tags: ['脾虚', '腹胀', '泄泻'], image: '' },
    { id: 'maidong', name: '麦冬', latin: 'Ophiopogon japonicus', property: '甘、微苦｜微寒', meridians: ['心', '肺', '胃'], category: '养阴',
      tags: ['养阴', '润肺', '生津'], oneLiner: '常用于了解肺燥干咳、阴虚口渴等方向。',
      description: '养阴生津，润肺清心，为滋阴润燥之要药。',
      directions: ['肺燥干咳', '阴虚口渴', '心烦失眠'],
      pairings: [{ combo: '麦冬 + 半夏', effect: '润燥生津，和胃降逆' }, { combo: '麦冬 + 五味子', effect: '益气养阴，敛汗安神' }],
      contraindications: '脾胃虚寒、大便溏泄者慎用。',
      explanation: '身体的“润燥喷雾”，缓解干燥与虚火。',
      clinical_tags: ['肺燥', '阴虚', '失眠'], image: '' },
    { id: 'gouqizi', name: '枸杞子', latin: 'Lycium barbarum', property: '甘｜平', meridians: ['肝', '肾'], category: '补肾',
      tags: ['补肾', '明目', '益精'], oneLiner: '常用于了解肝肾不足、目昏眼花等方向。',
      description: '滋补肝肾，益精明目，为平补之佳品。',
      directions: ['肝肾阴虚', '腰膝酸软', '眩晕目昏'],
      pairings: [{ combo: '枸杞子 + 菊花', effect: '滋补肝肾，清肝明目' }, { combo: '枸杞子 + 熟地', effect: '填补肝肾精血' }],
      contraindications: '脾虚便溏、外邪实热者不宜多食。',
      explanation: '肝肾的“营养补给”，让眼睛和腰膝更有力。',
      clinical_tags: ['肾虚', '目昏', '腰膝酸软'], image: '' },
    { id: 'huanglian', name: '黄连', latin: 'Coptis chinensis', property: '苦｜寒', meridians: ['心', '脾', '胃', '肝', '胆', '大肠'], category: '清热',
      tags: ['清热', '燥湿', '泻火'], oneLiner: '常用于了解湿热泻痢、心烦不寐等方向。',
      description: '清热燥湿，泻火解毒，尤善清中焦湿热与心火。',
      directions: ['湿热痞满', '泻痢腹痛', '心烦不寐'],
      pairings: [{ combo: '黄连 + 黄芩', effect: '清热燥湿解毒' }, { combo: '黄连 + 木香', effect: '行气化滞，止痢' }],
      contraindications: '脾胃虚寒者忌用，阴虚津伤者慎用。',
      explanation: '身体里的“强力灭火器”，专治湿热火毒。',
      clinical_tags: ['湿热', '泻痢', '心烦'], image: '' },
    { id: 'yiyiren', name: '薏苡仁', latin: 'Coix lacryma-jobi', property: '甘、淡｜凉', meridians: ['脾', '胃', '肺'], category: '利水',
      tags: ['利水', '健脾', '排脓'], oneLiner: '常用于了解脾虚湿盛、水肿脚气等方向。',
      description: '利水渗湿，健脾止泻，兼可排脓除痹。',
      directions: ['水肿脚气', '脾虚泄泻', '湿痹拘挛'],
      pairings: [{ combo: '薏苡仁 + 茯苓', effect: '健脾利湿' }, { combo: '薏苡仁 + 赤小豆', effect: '利水消肿（食疗常用）' }],
      contraindications: '孕妇及津枯便秘者慎用。',
      explanation: '身体的“排水通道”，帮脾胃甩掉多余水汽。',
      clinical_tags: ['水肿', '脾虚', '湿痹'], image: '' },
    { id: 'dangshen', name: '党参', latin: 'Codonopsis pilosula', property: '甘｜平', meridians: ['脾', '肺'], category: '补气',
      tags: ['补气', '健脾', '益肺'], oneLiner: '常用于了解脾肺气虚、气短心悸等方向。',
      description: '健脾益肺，养血生津，补气力缓而不燥。',
      directions: ['脾肺气虚', '食少倦怠', '气血不足'],
      pairings: [{ combo: '党参 + 白术', effect: '健脾益气' }, { combo: '党参 + 黄芪', effect: '补益脾肺之气' }],
      contraindications: '实证、热证而正气不虚者不宜。',
      explanation: '黄芪的“温和版”，缓缓补足中气。',
      clinical_tags: ['气虚', '食少', '气短'], image: '' },
    { id: 'huangqin', name: '黄芩', latin: 'Scutellaria baicalensis', property: '苦｜寒', meridians: ['肺', '胆', '脾', '大肠', '小肠'], category: '清热',
      tags: ['清热', '燥湿', '泻火'], oneLiner: '常用于了解肺热咳嗽、湿热黄疸等方向。',
      description: '清热燥湿，泻火解毒，止血安胎，善清上焦肺火。',
      directions: ['肺热咳嗽', '湿热黄疸', '胎动不安'],
      pairings: [{ combo: '黄芩 + 黄连', effect: '清热燥湿解毒' }, { combo: '黄芩 + 白术', effect: '清热安胎' }],
      contraindications: '脾胃虚寒、食少便溏者慎用。',
      explanation: '肺与胆的“清热卫士”，管住上焦火气。',
      clinical_tags: ['肺热', '湿热', '黄疸'], image: '' },
    { id: 'lianqiao', name: '连翘', latin: 'Forsythia suspensa', property: '苦｜微寒', meridians: ['肺', '心', '小肠'], category: '清热',
      tags: ['清热', '解毒', '散结'], oneLiner: '常用于了解风热外感、痈肿疮毒等方向。',
      description: '清热解毒，消肿散结，为“疮家圣药”。',
      directions: ['风热感冒', '痈肿疮毒', '咽喉肿痛'],
      pairings: [{ combo: '连翘 + 金银花', effect: '清热解毒，疏散风热' }, { combo: '连翘 + 薄荷', effect: '轻清宣透，解表清热' }],
      contraindications: '脾胃虚寒及气虚脓清者不宜。',
      explanation: '皮肤的“消肿专家”，对付红肿热毒包块。',
      clinical_tags: ['风热', '疮毒', '咽喉肿痛'], image: '' },
    { id: 'zhizi', name: '栀子', latin: 'Gardenia jasminoides', property: '苦｜寒', meridians: ['心', '肺', '三焦'], category: '清热',
      tags: ['清热', '泻火', '利湿'], oneLiner: '常用于了解热病心烦、湿热黄疸等方向。',
      description: '泻火除烦，清热利湿，凉血解毒，通泻三焦之火。',
      directions: ['热病心烦', '湿热黄疸', '血热吐衄'],
      pairings: [{ combo: '栀子 + 淡豆豉', effect: '清宣郁热，除烦安神' }, { combo: '栀子 + 茵陈', effect: '清热利湿退黄' }],
      contraindications: '脾虚便溏、食少者慎用。',
      explanation: '三焦的“导热下行阀”，把火气从尿里带走。',
      clinical_tags: ['热病', '心烦', '黄疸'], image: '' },
    { id: 'chaihu', name: '柴胡', latin: 'Bupleurum chinense', property: '辛、苦｜微寒', meridians: ['肝', '胆', '肺'], category: '理气',
      tags: ['疏肝', '解郁', '和解'], oneLiner: '常用于了解情志不畅、胸胁不舒等疏肝方向。',
      description: '疏散退热，疏肝解郁，升举阳气，是理解肝气调达思路的常见草本。',
      directions: ['胸胁胀满', '情志不舒', '寒热往来'],
      pairings: [{ combo: '柴胡 + 白芍', effect: '偏向疏肝柔肝的配伍思路' }, { combo: '柴胡 + 黄芩', effect: '偏向和解少阳的配伍思路' }],
      contraindications: '肝阳上亢、阴虚火旺者应谨慎，具体使用请咨询专业人士。',
      explanation: '可以理解为帮助梳理郁滞气机、让肝气更顺畅的草本。',
      clinical_tags: ['气滞', '胁胀', '情志不舒'], image: '' },
    { id: 'baishao', name: '白芍', latin: 'Paeonia lactiflora', property: '苦、酸｜微寒', meridians: ['肝', '脾'], category: '补血',
      tags: ['养血', '柔肝', '缓急'], oneLiner: '常用于了解血虚、肝脾不和及拘急不舒等方向。',
      description: '养血调经，敛阴止汗，柔肝止痛，常用于理解养血与柔肝并重的思路。',
      directions: ['血虚萎黄', '胁肋不舒', '筋脉拘急'],
      pairings: [{ combo: '白芍 + 当归', effect: '偏向养血调和的配伍思路' }, { combo: '白芍 + 甘草', effect: '偏向柔肝缓急的配伍思路' }],
      contraindications: '阳衰虚寒者慎用，具体使用请咨询专业人士。',
      explanation: '可以理解为兼顾养血与柔和筋脉的一味草本。',
      clinical_tags: ['血虚', '胁肋不舒', '拘急'], image: '' },
    { id: 'fangfeng', name: '防风', latin: 'Saposhnikovia divaricata', property: '辛、甘｜微温', meridians: ['膀胱', '肝', '脾'], category: '解表',
      tags: ['祛风', '解表', '止痉'], oneLiner: '常用于了解外感风邪、头身不舒等方向。',
      description: '祛风解表，胜湿止痛，止痉，是理解风邪相关调理思路的常见草本。',
      directions: ['外感风邪', '头痛身痛', '风湿不舒'],
      pairings: [{ combo: '防风 + 黄芪 + 白术', effect: '偏向益气固表的配伍思路' }, { combo: '防风 + 荆芥', effect: '偏向疏风解表的配伍思路' }],
      contraindications: '阴虚火旺、血虚痉急者慎用，具体使用请咨询专业人士。',
      explanation: '可以理解为处理风邪与表层不适思路中的常见草本。',
      clinical_tags: ['风寒', '头痛', '风湿'], image: '' },
    { id: 'dahuang', name: '大黄', latin: 'Rheum palmatum', property: '苦｜寒', meridians: ['脾', '胃', '大肠', '肝', '心包'], category: '清热',
      tags: ['泻下', '清热', '活血'], oneLiner: '常用于了解里实积滞、热结及瘀滞等方向。',
      description: '泻下攻积，清热泻火，凉血解毒，逐瘀通经，作用方向较强。',
      directions: ['实热积滞', '热结便秘', '瘀滞不畅'],
      pairings: [{ combo: '大黄 + 芒硝', effect: '偏向泻热通下的配伍思路' }, { combo: '大黄 + 丹参', effect: '偏向活血化瘀的配伍思路' }],
      contraindications: '孕期、哺乳期、月经期及脾胃虚弱者不宜自行使用，请咨询专业人士。',
      explanation: '属于作用较强的通下类草本，不适合作为日常自行调理选择。',
      clinical_tags: ['实热', '便秘', '瘀滞'], image: '' },
    { id: 'banxia', name: '半夏', latin: 'Pinellia ternata', property: '辛｜温', meridians: ['脾', '胃', '肺'], category: '化湿',
      tags: ['燥湿', '化痰', '和胃'], oneLiner: '常用于了解痰湿、胃气不和及咳嗽痰多等方向。',
      description: '燥湿化痰，降逆止呕，消痞散结，常用于理解痰湿与胃气不和的思路。',
      directions: ['咳嗽痰多', '胃气上逆', '痰湿痞满'],
      pairings: [{ combo: '半夏 + 陈皮', effect: '偏向燥湿化痰的配伍思路' }, { combo: '半夏 + 生姜', effect: '偏向和胃降逆的配伍思路' }],
      contraindications: '生半夏有毒，必须规范炮制；阴虚燥咳及出血者慎用，请咨询专业人士。',
      explanation: '主要用于理解痰湿与胃气上逆方向，不能自行使用未经炮制的半夏。',
      clinical_tags: ['痰湿', '呕逆', '痞满'], image: '' },
    { id: 'chuanxiong', name: '川芎', latin: 'Ligusticum chuanxiong', property: '辛｜温', meridians: ['肝', '胆', '心包'], category: '活血',
      tags: ['活血', '行气', '止痛'], oneLiner: '常用于了解气血运行不畅、头痛及经行不适等方向。',
      description: '活血行气，祛风止痛，常用于理解气血同调与头痛相关的配伍思路。',
      directions: ['气滞血瘀', '头痛不舒', '经行腹痛'],
      pairings: [{ combo: '川芎 + 当归', effect: '偏向养血活血的配伍思路' }, { combo: '川芎 + 白芷', effect: '偏向祛风止痛的配伍思路' }],
      contraindications: '阴虚火旺、月经过多及出血倾向者慎用，请咨询专业人士。',
      explanation: '可以理解为帮助气血运行、常见于头痛和瘀滞知识中的草本。',
      clinical_tags: ['血瘀', '头痛', '经痛'], image: '' },
    { id: 'danshen', name: '丹参', latin: 'Salvia miltiorrhiza', property: '苦｜微寒', meridians: ['心', '肝'], category: '活血',
      tags: ['活血', '祛瘀', '清心'], oneLiner: '常用于了解血行不畅、心烦及瘀滞等方向。',
      description: '活血祛瘀，通经止痛，清心除烦，常用于理解血瘀相关调理思路。',
      directions: ['血瘀不畅', '胸部不舒', '心烦不寐'],
      pairings: [{ combo: '丹参 + 川芎', effect: '偏向活血行气的配伍思路' }, { combo: '丹参 + 麦冬', effect: '偏向养阴清心的配伍思路' }],
      contraindications: '正在使用抗凝药物或有出血倾向者应先咨询医生或药师。',
      explanation: '可以理解为血行与心神方向中常见的活血类草本。',
      clinical_tags: ['血瘀', '胸部不舒', '心烦'], image: '' },
    { id: 'shanyao', name: '山药', latin: 'Dioscorea opposita', property: '甘｜平', meridians: ['脾', '肺', '肾'], category: '健脾',
      tags: ['健脾', '益肺', '补肾'], oneLiner: '常用于了解脾胃虚弱、食少乏力及肺肾不足等方向。',
      description: '补脾养胃，生津益肺，补肾涩精，特点较为平和。',
      directions: ['脾虚食少', '倦怠乏力', '肺肾不足'],
      pairings: [{ combo: '山药 + 白术', effect: '偏向健脾益气的配伍思路' }, { combo: '山药 + 枸杞子', effect: '偏向脾肾同调的配伍思路' }],
      contraindications: '湿盛中满、实邪积滞者慎用，具体使用请咨询专业人士。',
      explanation: '可以理解为兼顾脾、肺、肾，性质较平和的补益草本。',
      clinical_tags: ['脾虚', '食少', '肺肾不足'], image: '' },
    { id: 'suanzaoren', name: '酸枣仁', latin: 'Ziziphus jujuba var. spinosa', property: '甘、酸｜平', meridians: ['肝', '胆', '心'], category: '安神',
      tags: ['养心', '安神', '敛汗'], oneLiner: '常用于了解心神不宁、睡眠不稳及虚烦等方向。',
      description: '养心补肝，宁心安神，敛汗生津，是理解虚烦失眠方向的常见草本。',
      directions: ['入睡困难', '多梦易醒', '虚烦不安'],
      pairings: [{ combo: '酸枣仁 + 茯苓', effect: '偏向养心安神的配伍思路' }, { combo: '酸枣仁 + 麦冬', effect: '偏向养阴宁心的配伍思路' }],
      contraindications: '有实邪郁火或严重嗜睡者慎用，具体使用请咨询专业人士。',
      explanation: '可以理解为偏向养心安神、改善虚烦方向的草本知识。',
      clinical_tags: ['失眠', '多梦', '虚烦'], image: '' },
    { id: 'jiegeng', name: '桔梗', latin: 'Platycodon grandiflorus', property: '苦、辛｜平', meridians: ['肺'], category: '止咳',
      tags: ['宣肺', '利咽', '祛痰'], oneLiner: '常用于了解咽喉不适、咳嗽痰多及肺气不宣等方向。',
      description: '宣肺，利咽，祛痰，排脓，是理解肺气宣降思路的常见草本。',
      directions: ['咽喉不适', '咳嗽痰多', '肺气不宣'],
      pairings: [{ combo: '桔梗 + 甘草', effect: '偏向宣肺利咽的配伍思路' }, { combo: '桔梗 + 杏仁', effect: '偏向调理肺气宣降的配伍思路' }],
      contraindications: '阴虚久咳、咳血及胃溃疡者慎用，请咨询专业人士。',
      explanation: '可以理解为帮助肺气向上宣通、常见于咽喉知识中的草本。',
      clinical_tags: ['咽喉不适', '咳嗽', '痰多'], image: '' },
    { id: 'xingren', name: '杏仁', latin: 'Prunus armeniaca', property: '苦｜微温', meridians: ['肺', '大肠'], category: '止咳',
      tags: ['止咳', '平喘', '润肠'], oneLiner: '常用于了解咳嗽气逆及肠燥不畅等方向。',
      description: '降气止咳平喘，润肠通便，常用于理解肺气上逆与津亏肠燥的思路。',
      directions: ['咳嗽气逆', '呼吸不畅', '肠燥便秘'],
      pairings: [{ combo: '杏仁 + 桔梗', effect: '偏向调理肺气宣降的配伍思路' }, { combo: '杏仁 + 麦冬', effect: '偏向润肺降气的配伍思路' }],
      contraindications: '苦杏仁含有毒性成分，儿童、孕期及体弱者不得自行使用，请咨询专业人士。',
      explanation: '主要用于理解肺气下降与润燥方向，不宜自行大量食用苦杏仁。',
      clinical_tags: ['咳嗽', '喘息', '便秘'], image: '' },
    { id: 'banlangen', name: '板蓝根', latin: 'Isatis indigotica', property: '苦｜寒', meridians: ['心', '胃'], category: '清热',
      tags: ['清热', '解毒', '利咽'], oneLiner: '常用于了解热毒、咽喉不适等清热解毒方向。',
      description: '清热解毒，凉血利咽，常用于理解热毒与咽喉不适相关知识。',
      directions: ['咽喉不适', '热毒偏盛', '温热方向'],
      pairings: [{ combo: '板蓝根 + 金银花', effect: '偏向清热解毒的配伍思路' }, { combo: '板蓝根 + 连翘', effect: '偏向清热利咽的配伍思路' }],
      contraindications: '脾胃虚寒、体质虚弱者不宜长期自行使用，请咨询专业人士。',
      explanation: '可以理解为热毒与咽喉方向中的常见清热类草本。',
      clinical_tags: ['热毒', '咽喉不适', '温热'], image: '' },
    { id: 'bohe', name: '薄荷', latin: 'Mentha haplocalyx', property: '辛｜凉', meridians: ['肺', '肝'], category: '解表',
      tags: ['疏风', '清利头目', '疏肝'], oneLiner: '常用于了解风热、头目不清及咽喉不适等方向。',
      description: '疏散风热，清利头目，利咽透疹，疏肝行气。',
      directions: ['风热不适', '头目不清', '咽喉不利'],
      pairings: [{ combo: '薄荷 + 菊花', effect: '偏向疏散风热的配伍思路' }, { combo: '薄荷 + 柴胡', effect: '偏向疏肝解郁的配伍思路' }],
      contraindications: '体虚多汗者不宜多用，芳香成分不宜久煎，具体请咨询专业人士。',
      explanation: '可以理解为带有清凉疏散特点、兼顾头目和气机的草本。',
      clinical_tags: ['风热', '头目不清', '咽喉不利'], image: '' },
    { id: 'shengjiang', name: '生姜', latin: 'Zingiber officinale', property: '辛｜微温', meridians: ['肺', '脾', '胃'], category: '温里',
      tags: ['温中', '和胃', '解表'], oneLiner: '常用于了解胃寒不适、恶心及风寒初起等方向。',
      description: '解表散寒，温中止呕，温肺止咳，常用于理解脾胃与风寒方向。',
      directions: ['胃寒不适', '恶心欲吐', '风寒初起'],
      pairings: [{ combo: '生姜 + 半夏', effect: '偏向和胃降逆的配伍思路' }, { combo: '生姜 + 大枣', effect: '偏向调和脾胃的配伍思路' }],
      contraindications: '阴虚内热、热盛及出血倾向者慎用，具体使用请咨询专业人士。',
      explanation: '可以理解为偏温、常用于脾胃和风寒知识中的日常草本。',
      clinical_tags: ['胃寒', '呕恶', '风寒'], image: '' },

    // ---------- 新增 48 味（补虚 / 温里 / 理气 / 活血 / 化湿 / 利水 / 解表 / 止咳 / 安神 / 消食） ----------
    { id: 'taizishen', name: '太子参', latin: 'Pseudostellaria heterophylla', property: '甘、微苦｜平', meridians: ['脾', '肺'], category: '补气',
      tags: ['补气', '健脾', '生津'], oneLiner: '常用于了解气阴两虚、脾虚食少等方向。',
      description: '清补之品，气阴双补而不燥，适合虚不受补者。',
      directions: ['气阴两虚', '脾虚食少', '倦怠乏力'],
      pairings: [{ combo: '太子参 + 麦冬', effect: '气阴双补' }, { combo: '太子参 + 山药', effect: '健脾益气' }],
      contraindications: '实热证者不宜。',
      explanation: '温和平补的“小黄芪”，气阴一起顾。',
      clinical_tags: ['气虚', '阴虚', '食少'], image: '' },
    { id: 'xiyangshen', name: '西洋参', latin: 'Panax quinquefolius', property: '甘、微苦｜凉', meridians: ['心', '肺', '肾'], category: '补气',
      tags: ['补气', '养阴', '清热'], oneLiner: '常用于了解气虚阴亏、虚热烦倦等方向。',
      description: '补气养阴、清火生津，性凉而补，不助火。',
      directions: ['气虚阴亏', '虚热烦倦', '口燥咽干'],
      pairings: [{ combo: '西洋参 + 麦冬', effect: '益气养阴生津' }, { combo: '西洋参 + 石斛', effect: '养阴清热' }],
      contraindications: '脾胃虚寒、阳虚内寒者忌用。',
      explanation: '怕上火人群的补气选择，凉补不燥。',
      clinical_tags: ['气虚', '阴虚', '虚热'], image: '' },
    { id: 'huangjing', name: '黄精', latin: 'Polygonatum sibiricum', property: '甘｜平', meridians: ['脾', '肺', '肾'], category: '补气',
      tags: ['补气', '养阴', '健脾'], oneLiner: '常用于了解脾胃虚弱、体倦乏力等方向。',
      description: '平补脾肺肾，气阴双补之佳品，寓意“仙家余粮”。',
      directions: ['脾胃虚弱', '体倦乏力', '肺虚燥咳'],
      pairings: [{ combo: '黄精 + 山药', effect: '脾肺同补' }, { combo: '黄精 + 枸杞子', effect: '补肾益精' }],
      contraindications: '脾虚有湿、咳嗽痰多者慎用。',
      explanation: '平补气阴的“平民燕窝”。',
      clinical_tags: ['气虚', '阴虚', '脾虚'], image: '' },
    { id: 'fengmi', name: '蜂蜜', latin: 'Apis mellifera (蜂蜜)', property: '甘｜平', meridians: ['肺', '脾', '大肠'], category: '补气',
      tags: ['补气', '润燥', '通便'], oneLiner: '常用于了解肺燥干咳、肠燥便秘等方向。',
      description: '润肺止咳、润肠通便、调和药性，药食同源的补润之品。',
      directions: ['肺燥干咳', '肠燥便秘', '脾胃虚弱'],
      pairings: [{ combo: '蜂蜜 + 百合', effect: '润肺止咳' }, { combo: '蜂蜜 + 火麻仁', effect: '润肠通便' }],
      contraindications: '痰湿内蕴、腹胀便溏者不宜。',
      explanation: '温和的天然补润剂，既入药也入膳。',
      clinical_tags: ['肺燥', '便秘', '脾虚'], image: '' },
    { id: 'shudi', name: '熟地', latin: 'Rehmannia glutinosa (炮制品)', property: '甘｜微温', meridians: ['肝', '肾'], category: '补血',
      tags: ['补血', '滋阴', '填精'], oneLiner: '常用于了解血虚萎黄、肝肾阴虚等方向。',
      description: '补血滋阴、益精填髓，为补血要药，六味地黄丸之君。',
      directions: ['血虚萎黄', '肝肾阴虚', '腰膝酸软'],
      pairings: [{ combo: '熟地 + 当归', effect: '补血调经' }, { combo: '熟地 + 山茱萸', effect: '填补肝肾' }],
      contraindications: '脾胃虚弱、痰湿壅滞、腹满便溏者忌用。',
      explanation: '补血滋阴的“地基药材”。',
      clinical_tags: ['血虚', '阴虚', '腰酸'], image: '' },
    { id: 'ejiao', name: '阿胶', latin: 'Equus asinus (驴皮胶)', property: '甘｜平', meridians: ['肺', '肝', '肾'], category: '补血',
      tags: ['补血', '止血', '滋阴'], oneLiner: '常用于了解血虚萎黄、眩晕心悸等方向。',
      description: '补血止血、滋阴润燥，妇科调经安胎常用。',
      directions: ['血虚萎黄', '眩晕心悸', '虚烦不眠'],
      pairings: [{ combo: '阿胶 + 当归', effect: '补血活血' }, { combo: '阿胶 + 黄芩', effect: '清热安胎' }],
      contraindications: '脾胃虚弱、消化不良、便溏者慎用。',
      explanation: '补血止血的“胶类之王”。',
      clinical_tags: ['血虚', '出血', '阴虚'], image: '' },
    { id: 'longyanrou', name: '龙眼肉', latin: 'Dimocarpus longan', property: '甘｜温', meridians: ['心', '脾'], category: '补血',
      tags: ['补血', '安神', '健脾'], oneLiner: '常用于了解气血不足、失眠健忘等方向。',
      description: '补益心脾、养血安神，甘温平和，药食两用。',
      directions: ['气血不足', '心悸怔忡', '失眠健忘'],
      pairings: [{ combo: '龙眼肉 + 酸枣仁', effect: '养血安神' }, { combo: '龙眼肉 + 莲子', effect: '健脾宁心' }],
      contraindications: '内有痰火、湿滞停饮者慎用。',
      explanation: '温柔的“补心脾小甜点”。',
      clinical_tags: ['血虚', '失眠', '心悸'], image: '' },
    { id: 'heshouwu', name: '何首乌', latin: 'Polygonum multiflorum (炮制品)', property: '苦、甘、涩｜微温', meridians: ['肝', '肾'], category: '补血',
      tags: ['补血', '乌发', '益精'], oneLiner: '常用于了解血虚萎黄、须发早白等方向。',
      description: '补肝肾、益精血、乌须发；生品有毒，须用炮制品。',
      directions: ['血虚萎黄', '眩晕耳鸣', '须发早白'],
      pairings: [{ combo: '何首乌 + 枸杞子', effect: '补肝肾益精血' }, { combo: '何首乌 + 当归', effect: '养血乌发' }],
      contraindications: '生品有毒，须规范炮制；脾虚便溏者慎用。',
      explanation: '传说中的“乌发补血草”。',
      clinical_tags: ['血虚', '肝肾不足', '白发'], image: '' },
    { id: 'duzhong', name: '杜仲', latin: 'Eucommia ulmoides', property: '甘｜温', meridians: ['肝', '肾'], category: '补阳',
      tags: ['补阳', '强筋骨', '安胎'], oneLiner: '常用于了解肝肾不足、腰膝酸痛等方向。',
      description: '补肝肾、强筋骨，善治腰痛，兼能安胎。',
      directions: ['肝肾不足', '腰膝酸痛', '筋骨无力'],
      pairings: [{ combo: '杜仲 + 牛膝', effect: '强腰膝' }, { combo: '杜仲 + 续断', effect: '固胎健腰' }],
      contraindications: '阴虚火旺者慎用。',
      explanation: '专治“老腰突”的温补腰药。',
      clinical_tags: ['阳虚', '腰膝酸软', '腰痛'], image: '' },
    { id: 'bajitian', name: '巴戟天', latin: 'Morinda officinalis', property: '甘、辛｜微温', meridians: ['肾', '肝'], category: '补阳',
      tags: ['补阳', '强筋骨', '祛风湿'], oneLiner: '常用于了解肾阳不足、阳痿遗精等方向。',
      description: '补肾阳、强筋骨、祛风湿，温而不燥。',
      directions: ['肾阳不足', '阳痿遗精', '筋骨痿软'],
      pairings: [{ combo: '巴戟天 + 淫羊藿', effect: '温肾壮阳' }, { combo: '巴戟天 + 杜仲', effect: '强筋健骨' }],
      contraindications: '阴虚火旺者忌用。',
      explanation: '肾阳不足的“温煦引擎”。',
      clinical_tags: ['阳虚', '阳痿', '腰膝酸软'], image: '' },
    { id: 'yinyanghuo', name: '淫羊藿', latin: 'Epimedium brevicornu', property: '辛、甘｜温', meridians: ['肝', '肾'], category: '补阳',
      tags: ['补阳', '强筋骨', '祛风湿'], oneLiner: '常用于了解肾阳虚衰、阳痿遗精等方向。',
      description: '温肾助阳、强筋健骨、祛风湿，又称仙灵脾。',
      directions: ['肾阳虚衰', '阳痿遗精', '风寒湿痹'],
      pairings: [{ combo: '淫羊藿 + 巴戟天', effect: '温肾助阳' }, { combo: '淫羊藿 + 杜仲', effect: '强筋健骨' }],
      contraindications: '阴虚火旺者忌服。',
      explanation: '传说吃了会“羊群兴奋”的壮阳草。',
      clinical_tags: ['阳虚', '阳痿', '痹痛'], image: '' },
    { id: 'roucongrong', name: '肉苁蓉', latin: 'Cistanche deserticola', property: '甘、咸｜温', meridians: ['肾', '大肠'], category: '补阳',
      tags: ['补阳', '润肠', '益精'], oneLiner: '常用于了解肾阳不足、肠燥便秘等方向。',
      description: '补肾阳、益精血、润肠通便，温而不燥，素有“沙漠人参”之称。',
      directions: ['肾阳不足', '精血亏虚', '肠燥便秘'],
      pairings: [{ combo: '肉苁蓉 + 当归', effect: '补血润肠' }, { combo: '肉苁蓉 + 黑芝麻', effect: '润肠通便' }],
      contraindications: '阴虚火旺、实热便秘者忌用。',
      explanation: '温阳又润肠的“从容”补品。',
      clinical_tags: ['阳虚', '便秘', '精亏'], image: '' },
    { id: 'rougui', name: '肉桂', latin: 'Cinnamomum cassia', property: '辛、甘｜大热', meridians: ['肾', '脾', '心', '肝'], category: '温里',
      tags: ['温里', '补阳', '散寒'], oneLiner: '常用于了解脾胃虚寒、脘腹冷痛等方向。',
      description: '补火助阳、散寒止痛、温通经脉，辛甘大热，引火归元。',
      directions: ['脾胃虚寒', '脘腹冷痛', '肾阳虚衰'],
      pairings: [{ combo: '肉桂 + 干姜', effect: '温中散寒' }, { combo: '肉桂 + 附子', effect: '回阳救逆' }],
      contraindications: '阴虚火旺、里有实热、血热妄行者忌用。',
      explanation: '厨房里也有的“暖炉香料”。',
      clinical_tags: ['畏寒', '冷痛', '阳虚'], image: '' },
    { id: 'ganjiang', name: '干姜', latin: 'Zingiber officinale (干品)', property: '辛｜热', meridians: ['脾', '胃', '肾', '心', '肺'], category: '温里',
      tags: ['温里', '散寒', '温肺'], oneLiner: '常用于了解脾胃虚寒、脘腹冷痛等方向。',
      description: '温中散寒、回阳通脉、温肺化饮，守而不走。',
      directions: ['脾胃虚寒', '脘腹冷痛', '寒饮咳喘'],
      pairings: [{ combo: '干姜 + 附子', effect: '回阳温中' }, { combo: '干姜 + 半夏', effect: '温中和胃' }],
      contraindications: '阴虚内热、血热妄行者忌用。',
      explanation: '生姜晒干的“火力加强版”。',
      clinical_tags: ['胃寒', '冷痛', '寒饮'], image: '' },
    { id: 'wuzhuyu', name: '吴茱萸', latin: 'Evodia rutaecarpa', property: '辛、苦｜热（有小毒）', meridians: ['肝', '肾', '脾', '胃'], category: '温里',
      tags: ['温里', '疏肝', '止痛'], oneLiner: '常用于了解肝胃虚寒、巅顶头痛等方向。',
      description: '散寒止痛、疏肝下气、温中止呕，善治厥阴头痛与呕逆。',
      directions: ['肝胃虚寒', '脘腹胀痛', '厥阴头痛'],
      pairings: [{ combo: '吴茱萸 + 生姜', effect: '温胃止呕' }, { combo: '吴茱萸 + 黄连', effect: '寒热平调' }],
      contraindications: '阴虚火旺者忌用。',
      explanation: '温肝胃、止呕痛的“热性小椒”。',
      clinical_tags: ['胃寒', '头痛', '呕逆'], image: '' },
    { id: 'huajiao', name: '花椒', latin: 'Zanthoxylum bungeanum', property: '辛｜温', meridians: ['脾', '胃'], category: '温里',
      tags: ['温里', '散寒', '杀虫'], oneLiner: '常用于了解脾胃虚寒、脘腹冷痛等方向。',
      description: '温中止痛、杀虫止痒，厨房香料亦能入药。',
      directions: ['脾胃虚寒', '脘腹冷痛', '寒湿泄泻'],
      pairings: [{ combo: '花椒 + 干姜', effect: '温中散寒' }, { combo: '花椒 + 苍术', effect: '燥湿温中' }],
      contraindications: '阴虚火旺者忌用。',
      explanation: '麻辣暖胃的“调味药”。',
      clinical_tags: ['胃寒', '腹痛', '泄泻'], image: '' },
    { id: 'xiangfu', name: '香附', latin: 'Cyperus rotundus', property: '辛、微苦、微甘｜平', meridians: ['肝', '脾', '三焦'], category: '理气',
      tags: ['理气', '疏肝', '调经'], oneLiner: '常用于了解肝郁气滞、胸胁胀闷等方向。',
      description: '疏肝解郁、理气宽中、调经止痛，被誉“气病之总司，女科之主帅”。',
      directions: ['肝郁气滞', '胸胁胀闷', '月经不调'],
      pairings: [{ combo: '香附 + 柴胡', effect: '疏肝解郁' }, { combo: '香附 + 川芎', effect: '行气活血调经' }],
      contraindications: '气虚无滞、阴虚血热者慎用。',
      explanation: '理气解郁的“妇科要药”。',
      clinical_tags: ['气滞', '胁胀', '调经'], image: '' },
    { id: 'muxiang', name: '木香', latin: 'Aucklandia costus', property: '辛、苦｜温', meridians: ['脾', '胃', '大肠', '三焦', '胆'], category: '理气',
      tags: ['理气', '健脾', '止痛'], oneLiner: '常用于了解脾胃气滞、脘腹胀痛等方向。',
      description: '行气止痛、健脾消食，善理脾胃气滞与泻痢后重。',
      directions: ['脾胃气滞', '脘腹胀痛', '泻痢后重'],
      pairings: [{ combo: '木香 + 砂仁', effect: '理气醒脾' }, { combo: '木香 + 槟榔', effect: '行气导滞' }],
      contraindications: '阴虚火旺者慎用。',
      explanation: '专治“肚子胀气”的行气药。',
      clinical_tags: ['腹胀', '气滞', '食积'], image: '' },
    { id: 'zhishi', name: '枳实', latin: 'Citrus aurantium (幼果)', property: '苦、辛、酸｜微寒', meridians: ['脾', '胃'], category: '理气',
      tags: ['理气', '化痰', '消积'], oneLiner: '常用于了解积滞内停、痞满胀痛等方向。',
      description: '破气消积、化痰散痞，力猛下行。',
      directions: ['积滞内停', '痞满胀痛', '大便不畅'],
      pairings: [{ combo: '枳实 + 白术', effect: '消补兼施' }, { combo: '枳实 + 厚朴', effect: '行气除满' }],
      contraindications: '孕妇及脾胃虚弱者慎用。',
      explanation: '破气消痞的“下行推手”。',
      clinical_tags: ['痞满', '食积', '痰滞'], image: '' },
    { id: 'foshou', name: '佛手', latin: 'Citrus medica var. sarcodactylis', property: '辛、苦、酸｜温', meridians: ['肝', '脾', '肺'], category: '理气',
      tags: ['理气', '疏肝', '化痰'], oneLiner: '常用于了解肝胃气滞、胸胁胀痛等方向。',
      description: '疏肝理气、和胃止痛、燥湿化痰，气味清香。',
      directions: ['肝胃气滞', '胸胁胀痛', '咳嗽痰多'],
      pairings: [{ combo: '佛手 + 香附', effect: '疏肝理气' }, { combo: '佛手 + 陈皮', effect: '理气化痰' }],
      contraindications: '阴虚有热者慎用。',
      explanation: '形似佛手的“理气香橼”。',
      clinical_tags: ['气滞', '胁胀', '痰多'], image: '' },
    { id: 'honghua', name: '红花', latin: 'Carthamus tinctorius', property: '辛｜温', meridians: ['心', '肝', '肾'], category: '活血',
      tags: ['活血', '祛瘀', '通经'], oneLiner: '常用于了解瘀血阻滞、经闭痛经等方向。',
      description: '活血通经、散瘀止痛，妇科经产与跌打要药。',
      directions: ['瘀血阻滞', '经闭癥瘕', '产后瘀阻'],
      pairings: [{ combo: '红花 + 桃仁', effect: '活血化瘀' }, { combo: '红花 + 当归', effect: '养血活血' }],
      contraindications: '孕妇忌用，有出血倾向者慎用。',
      explanation: '活血通经的“红色染料药”。',
      clinical_tags: ['血瘀', '痛经', '瘀阻'], image: '' },
    { id: 'taoren', name: '桃仁', latin: 'Prunus persica', property: '苦、甘｜平', meridians: ['心', '肝', '大肠'], category: '活血',
      tags: ['活血', '祛瘀', '润肠'], oneLiner: '常用于了解经闭癥瘕、肠燥便秘等方向。',
      description: '活血祛瘀、润肠通便、止咳平喘，兼能消痈。',
      directions: ['经闭癥瘕', '肺痈肠痈', '肠燥便秘'],
      pairings: [{ combo: '桃仁 + 红花', effect: '活血化瘀' }, { combo: '桃仁 + 当归', effect: '养血活血' }],
      contraindications: '孕妇忌用，便溏者慎用。',
      explanation: '活血又润肠的“果核药”。',
      clinical_tags: ['血瘀', '便秘', '痈肿'], image: '' },
    { id: 'yimucao', name: '益母草', latin: 'Leonurus japonicus', property: '苦、辛｜微寒', meridians: ['肝', '心包', '膀胱'], category: '活血',
      tags: ['活血', '调经', '利水'], oneLiner: '常用于了解月经不调、水肿小便不利等方向。',
      description: '活血调经、利尿消肿，妇科经产要药，故名益母。',
      directions: ['月经不调', '痛经经闭', '水肿小便不利'],
      pairings: [{ combo: '益母草 + 当归', effect: '调经活血' }, { combo: '益母草 + 川芎', effect: '行气活血' }],
      contraindications: '孕妇忌用。',
      explanation: '妇科“益母”的利水活血草。',
      clinical_tags: ['月经不调', '水肿', '血瘀'], image: '' },
    { id: 'huoxiang', name: '藿香', latin: 'Agastache rugosa', property: '辛｜微温', meridians: ['脾', '胃', '肺'], category: '化湿',
      tags: ['化湿', '解暑', '止呕'], oneLiner: '常用于了解湿浊中阻、暑湿表证等方向。',
      description: '芳香化湿、和中止呕、发表解暑，夏月常用。',
      directions: ['湿浊中阻', '脘腹痞闷', '暑湿表证'],
      pairings: [{ combo: '藿香 + 佩兰', effect: '芳香化浊' }, { combo: '藿香 + 半夏', effect: '化湿止呕' }],
      contraindications: '阴虚血燥者慎用。',
      explanation: '夏日祛湿解暑的“芳香草”。',
      clinical_tags: ['湿阻', '呕吐', '暑湿'], image: '' },
    { id: 'peilan', name: '佩兰', latin: 'Eupatorium fortunei', property: '辛｜平', meridians: ['脾', '胃', '肺'], category: '化湿',
      tags: ['化湿', '解暑', '祛痰'], oneLiner: '常用于了解湿浊中阻、口臭脘痞等方向。',
      description: '芳香化湿、醒脾开胃、发表解暑，善除陈腐之气。',
      directions: ['湿浊中阻', '脘痞呕恶', '暑湿表证'],
      pairings: [{ combo: '佩兰 + 藿香', effect: '芳香化浊' }, { combo: '佩兰 + 陈皮', effect: '理气化湿' }],
      contraindications: '阴虚血燥者慎用。',
      explanation: '除口臭、化脾湿的“清香草”。',
      clinical_tags: ['湿阻', '口臭', '暑湿'], image: '' },
    { id: 'cangzhu', name: '苍术', latin: 'Atractylodes lancea', property: '辛、苦｜温', meridians: ['脾', '胃', '肝'], category: '化湿',
      tags: ['化湿', '燥湿', '健脾'], oneLiner: '常用于了解湿阻中焦、脘腹胀闷等方向。',
      description: '燥湿健脾、祛风散寒，气烈辛散，专去寒湿。',
      directions: ['湿阻中焦', '脘腹胀闷', '风湿痹痛'],
      pairings: [{ combo: '苍术 + 厚朴', effect: '燥湿运脾' }, { combo: '苍术 + 黄柏', effect: '清热燥湿' }],
      contraindications: '阴虚内热、气虚多汗者忌用。',
      explanation: '去寒湿、健脾胃的“燥脾猛将”。',
      clinical_tags: ['湿阻', '腹胀', '痹痛'], image: '' },
    { id: 'sharen', name: '砂仁', latin: 'Amomum villosum', property: '辛｜温', meridians: ['脾', '胃', '肾'], category: '化湿',
      tags: ['化湿', '行气', '安胎'], oneLiner: '常用于了解湿阻中焦、脾胃气滞等方向。',
      description: '化湿行气、温中止泻、安胎，善理脾胃气滞与妊娠恶阻。',
      directions: ['湿阻中焦', '脾胃气滞', '胎动不安'],
      pairings: [{ combo: '砂仁 + 木香', effect: '理气化湿' }, { combo: '砂仁 + 白术', effect: '健脾安胎' }],
      contraindications: '阴虚血燥者慎用。',
      explanation: '温脾安胎的“行气砂粒”。',
      clinical_tags: ['湿阻', '腹胀', '胎动'], image: '' },
    { id: 'zhuling', name: '猪苓', latin: 'Polyporus umbellatus', property: '甘、淡｜平', meridians: ['肾', '膀胱'], category: '利水',
      tags: ['利水', '渗湿'], oneLiner: '常用于了解水肿、小便不利等方向。',
      description: '利水渗湿，功专利水，常与茯苓相须为用。',
      directions: ['水肿', '小便不利', '泄泻'],
      pairings: [{ combo: '猪苓 + 茯苓', effect: '健脾利水' }, { combo: '猪苓 + 泽泻', effect: '增强利水' }],
      contraindications: '无水湿者慎用。',
      explanation: '专攻利水的“渗湿菌核”。',
      clinical_tags: ['水肿', '小便不利', '泄泻'], image: '' },
    { id: 'zexie', name: '泽泻', latin: 'Alisma orientale', property: '甘、淡｜寒', meridians: ['肾', '膀胱'], category: '利水',
      tags: ['利水', '渗湿', '泻热'], oneLiner: '常用于了解水肿、小便不利等方向。',
      description: '利水渗湿、泄热，善清下焦湿热，六味地黄丸佐药。',
      directions: ['水肿', '小便不利', '淋浊涩痛'],
      pairings: [{ combo: '泽泻 + 茯苓', effect: '健脾利水' }, { combo: '泽泻 + 白术', effect: '健脾渗湿' }],
      contraindications: '肾虚滑精、无湿热者慎用。',
      explanation: '清下焦湿热的“利水泄热药”。',
      clinical_tags: ['水肿', '小便不利', '热淋'], image: '' },
    { id: 'cheqianzi', name: '车前子', latin: 'Plantago asiatica', property: '甘｜寒', meridians: ['肝', '肾', '肺', '小肠'], category: '利水',
      tags: ['利水', '通淋', '明目'], oneLiner: '常用于了解水肿、淋证、目赤肿痛等方向。',
      description: '利尿通淋、渗湿止泻、清肝明目，兼能清肺化痰。',
      directions: ['水肿', '淋证', '目赤肿痛'],
      pairings: [{ combo: '车前子 + 木通', effect: '利尿通淋' }, { combo: '车前子 + 菊花', effect: '清肝明目' }],
      contraindications: '肾虚精滑者慎用。',
      explanation: '利水又明目的“车前小草”。',
      clinical_tags: ['水肿', '淋证', '目疾'], image: '' },
    { id: 'mahuang', name: '麻黄', latin: 'Ephedra sinica', property: '辛、微苦｜温', meridians: ['肺', '膀胱'], category: '解表',
      tags: ['解表', '发汗', '平喘'], oneLiner: '常用于了解风寒感冒、胸闷喘咳等方向。',
      description: '发汗解表、宣肺平喘、利水消肿，辛温解表第一药。',
      directions: ['风寒感冒', '胸闷喘咳', '风水水肿'],
      pairings: [{ combo: '麻黄 + 桂枝', effect: '发汗解表' }, { combo: '麻黄 + 杏仁', effect: '宣肺平喘' }],
      contraindications: '体虚多汗、失眠及高血压患者慎用。',
      explanation: '解表发汗的“开路先锋”。',
      clinical_tags: ['风寒', '喘咳', '水肿'], image: '' },
    { id: 'guizhi', name: '桂枝', latin: 'Cinnamomum cassia (枝)', property: '辛、甘｜温', meridians: ['心', '肺', '膀胱'], category: '解表',
      tags: ['解表', '温通', '散寒'], oneLiner: '常用于了解风寒感冒、寒凝血滞等方向。',
      description: '发汗解肌、温通经脉、助阳化气，走肢表而温通。',
      directions: ['风寒感冒', '寒凝血滞', '阳虚心悸'],
      pairings: [{ combo: '桂枝 + 白芍', effect: '调和营卫' }, { combo: '桂枝 + 麻黄', effect: '增强发汗' }],
      contraindications: '温热病、阴虚火旺、血热妄行者忌用。',
      explanation: '温通经脉的“肉桂枝条”。',
      clinical_tags: ['风寒', '寒凝', '阳虚'], image: '' },
    { id: 'zisu', name: '紫苏', latin: 'Perilla frutescens', property: '辛｜温', meridians: ['肺', '脾'], category: '解表',
      tags: ['解表', '行气', '宽中'], oneLiner: '常用于了解风寒感冒、脾胃气滞等方向。',
      description: '解表散寒、行气和胃，兼治妊娠呕吐与鱼蟹中毒。',
      directions: ['风寒感冒', '脾胃气滞', '妊娠呕吐'],
      pairings: [{ combo: '紫苏 + 生姜', effect: '解表散寒' }, { combo: '紫苏 + 陈皮', effect: '理气宽中' }],
      contraindications: '温病及气弱表虚者慎用。',
      explanation: '解表又宽中的“行气叶”。',
      clinical_tags: ['风寒', '胸闷', '呕恶'], image: '' },
    { id: 'jingjie', name: '荆芥', latin: 'Schizonepeta tenuifolia', property: '辛｜微温', meridians: ['肺', '肝'], category: '解表',
      tags: ['解表', '透疹', '止血'], oneLiner: '常用于了解风寒感冒、麻疹不透等方向。',
      description: '解表散风、透疹消疮，炒炭后善止血。',
      directions: ['风寒感冒', '麻疹不透', '衄血便血'],
      pairings: [{ combo: '荆芥 + 防风', effect: '疏风解表' }, { combo: '荆芥 + 连翘', effect: '疏散风热' }],
      contraindications: '表虚自汗者慎用。',
      explanation: '解表透疹的“风药使”。',
      clinical_tags: ['风寒', '疹透', '出血'], image: '' },
    { id: 'chuanbeimu', name: '川贝母', latin: 'Fritillaria cirrhosa', property: '苦、甘｜微寒', meridians: ['肺', '心'], category: '止咳',
      tags: ['止咳', '化痰', '润肺'], oneLiner: '常用于了解肺热燥咳、干咳少痰等方向。',
      description: '润肺止咳、化痰散结，清润为上，虚劳燥咳尤宜。',
      directions: ['肺热燥咳', '干咳少痰', '瘰疬'],
      pairings: [{ combo: '川贝母 + 雪梨', effect: '润肺止咳' }, { combo: '川贝母 + 麦冬', effect: '养阴润肺' }],
      contraindications: '虚寒痰嗽、脾胃虚寒者慎用。',
      explanation: '润肺止咳的“川产名贝”。',
      clinical_tags: ['燥咳', '痰热', '干咳'], image: '' },
    { id: 'zhebeimu', name: '浙贝母', latin: 'Fritillaria thunbergii', property: '苦｜寒', meridians: ['肺', '心'], category: '止咳',
      tags: ['止咳', '化痰', '散结'], oneLiner: '常用于了解风热咳嗽、痰火瘰疬等方向。',
      description: '清热化痰、散结消痈，偏于清解，外感痰热常用。',
      directions: ['风热咳嗽', '痰火瘰疬', '疮痈'],
      pairings: [{ combo: '浙贝母 + 玄参', effect: '化痰散结' }, { combo: '浙贝母 + 连翘', effect: '清热解毒' }],
      contraindications: '虚寒痰嗽者忌用。',
      explanation: '清化痰热的“浙产贝母”。',
      clinical_tags: ['痰热', '咳嗽', '痈肿'], image: '' },
    { id: 'gualou', name: '瓜蒌', latin: 'Trichosanthes kirilowii', property: '甘、微苦｜寒', meridians: ['肺', '胃', '大肠'], category: '止咳',
      tags: ['止咳', '化痰', '宽胸'], oneLiner: '常用于了解痰热咳嗽、胸痹心痛等方向。',
      description: '清热涤痰、宽胸散结、润燥滑肠，痰热结胸与胸痹要药。',
      directions: ['痰热咳嗽', '胸痹心痛', '肠燥便秘'],
      pairings: [{ combo: '瓜蒌 + 薤白', effect: '宽胸通阳' }, { combo: '瓜蒌 + 黄芩', effect: '清化痰热' }],
      contraindications: '脾虚便溏及寒痰者忌用。',
      explanation: '痰热胸痹的“宽胸瓜”。',
      clinical_tags: ['痰热', '胸痹', '便秘'], image: '' },
    { id: 'ziyuan', name: '紫菀', latin: 'Aster tataricus', property: '辛、苦｜温', meridians: ['肺'], category: '止咳',
      tags: ['止咳', '化痰', '润肺'], oneLiner: '常用于了解咳嗽有痰、新久咳嗽等方向。',
      description: '润肺下气、化痰止咳，温润不燥，寒热咳嗽皆宜。',
      directions: ['咳嗽有痰', '新久咳嗽', '劳嗽'],
      pairings: [{ combo: '紫菀 + 款冬花', effect: '润肺止咳' }, { combo: '紫菀 + 桔梗', effect: '宣肺化痰' }],
      contraindications: '实热咳嗽者慎用。',
      explanation: '新久皆宜的“润肺止咳草”。',
      clinical_tags: ['咳嗽', '痰多', '久咳'], image: '' },
    { id: 'baiziren', name: '柏子仁', latin: 'Platycladus orientalis (种仁)', property: '甘｜平', meridians: ['心', '肾', '大肠'], category: '安神',
      tags: ['安神', '养心', '润肠'], oneLiner: '常用于了解心悸失眠、阴虚盗汗等方向。',
      description: '养心安神、润肠通便，质润不燥，宜于虚烦不眠。',
      directions: ['心悸失眠', '阴虚盗汗', '肠燥便秘'],
      pairings: [{ combo: '柏子仁 + 酸枣仁', effect: '养心安神' }, { combo: '柏子仁 + 五味子', effect: '敛汗安神' }],
      contraindications: '便溏及痰多者慎用。',
      explanation: '养心又润肠的“安神种仁”。',
      clinical_tags: ['失眠', '心悸', '便秘'], image: '' },
    { id: 'yuanzhi', name: '远志', latin: 'Polygala tenuifolia', property: '苦、辛｜温', meridians: ['心', '肾', '肺'], category: '安神',
      tags: ['安神', '祛痰', '开窍'], oneLiner: '常用于了解惊悸失眠、健忘等方向。',
      description: '安神益智、祛痰开窍、消散痈肿，兼能化痰。',
      directions: ['惊悸失眠', '健忘', '咳痰不爽'],
      pairings: [{ combo: '远志 + 石菖蒲', effect: '化痰开窍' }, { combo: '远志 + 酸枣仁', effect: '安神益智' }],
      contraindications: '溃疡病及胃炎者慎用。',
      explanation: '安神益智的“祛痰开窍草”。',
      clinical_tags: ['失眠', '健忘', '痰阻'], image: '' },
    { id: 'shanzha', name: '山楂', latin: 'Crataegus pinnatifida', property: '酸、甘｜微温', meridians: ['脾', '胃', '肝'], category: '消食',
      tags: ['消食', '化积', '活血'], oneLiner: '常用于了解肉食积滞、胃脘胀满等方向。',
      description: '消食化积、行气散瘀，尤善消肉食油腻之积。',
      directions: ['肉食积滞', '胃脘胀满', '瘀阻腹痛'],
      pairings: [{ combo: '山楂 + 神曲', effect: '消食化滞' }, { combo: '山楂 + 麦芽', effect: '消谷化积' }],
      contraindications: '胃酸分泌过多者、脾胃虚弱无积滞者慎用。',
      explanation: '消肉积的“酸甜小红果”。',
      clinical_tags: ['食积', '腹胀', '血瘀'], image: '' },
    { id: 'maiya', name: '麦芽', latin: 'Hordeum vulgare (萌芽)', property: '甘｜平', meridians: ['脾', '胃', '肝'], category: '消食',
      tags: ['消食', '健脾', '回乳'], oneLiner: '常用于了解米面薯芋食滞、脾虚食少等方向。',
      description: '消食健胃、回乳消胀，尤善消米面薯芋之积。',
      directions: ['米面薯芋食滞', '脾虚食少', '断乳'],
      pairings: [{ combo: '麦芽 + 山楂', effect: '消食化积' }, { combo: '麦芽 + 神曲', effect: '健脾消食' }],
      contraindications: '哺乳期不宜大量用。',
      explanation: '消面食的“发芽麦粒”。',
      clinical_tags: ['食积', '腹胀', '脾虚'], image: '' },
    { id: 'tiandong', name: '天冬', latin: 'Asparagus cochinchinensis', property: '甘、苦｜寒', meridians: ['肺', '肾'], category: '养阴',
      tags: ['养阴', '润肺', '生津'], oneLiner: '常用于了解肺燥干咳、阴虚口渴等方向。',
      description: '养阴润燥、清肺降火、益肾生津，常与麦冬相须为用。',
      directions: ['肺燥干咳', '阴虚口渴', '肠燥便秘'],
      pairings: [{ combo: '天冬 + 麦冬', effect: '滋阴润燥' }, { combo: '天冬 + 熟地', effect: '填补肾阴' }],
      contraindications: '脾胃虚寒、食少便溏者慎用。',
      explanation: '清润的“滋阴降火草”。',
      clinical_tags: ['肺燥', '阴虚', '便秘'], image: '' },
    { id: 'beishashen', name: '北沙参', latin: 'Glehnia littoralis', property: '甘、微苦｜微寒', meridians: ['肺', '胃'], category: '养阴',
      tags: ['养阴', '润肺', '益胃'], oneLiner: '常用于了解肺燥干咳、胃阴不足等方向。',
      description: '养阴清肺、益胃生津，甘凉柔润，专补肺胃之阴。',
      directions: ['肺燥干咳', '胃阴不足', '咽干口渴'],
      pairings: [{ combo: '北沙参 + 麦冬', effect: '润肺养胃' }, { combo: '北沙参 + 玉竹', effect: '养阴生津' }],
      contraindications: '风寒咳嗽、脾胃虚寒者慎用。',
      explanation: '清养肺胃的“沙参”。',
      clinical_tags: ['肺燥', '胃阴不足', '咽干'], image: '' },
    { id: 'yuzhu', name: '玉竹', latin: 'Polygonatum odoratum', property: '甘｜微寒', meridians: ['肺', '胃'], category: '养阴',
      tags: ['养阴', '润肺', '生津'], oneLiner: '常用于了解肺胃阴伤、燥热咳嗽等方向。',
      description: '养阴润燥、生津止渴，平和不腻，补而不恋邪。',
      directions: ['肺胃阴伤', '燥热咳嗽', '咽干口渴'],
      pairings: [{ combo: '玉竹 + 沙参', effect: '养阴润肺' }, { combo: '玉竹 + 麦冬', effect: '益胃生津' }],
      contraindications: '痰湿气滞、脾虚便溏者慎用。',
      explanation: '润而不腻的“玉竹”。',
      clinical_tags: ['肺燥', '胃阴', '咽干'], image: '' },
    { id: 'shihu', name: '石斛', latin: 'Dendrobium nobile', property: '甘｜微寒', meridians: ['胃', '肾'], category: '养阴',
      tags: ['养阴', '益胃', '生津'], oneLiner: '常用于了解胃阴虚、肾阴虚目暗等方向。',
      description: '益胃生津、滋阴清热，素有“滋阴圣品”之称。',
      directions: ['胃阴虚', '肾阴虚目暗', '热病伤津'],
      pairings: [{ combo: '石斛 + 麦冬', effect: '益胃生津' }, { combo: '石斛 + 枸杞子', effect: '补肾明目' }],
      contraindications: '温热病早期、湿温未化燥者忌用。',
      explanation: '名贵的“滋阴生津草”。',
      clinical_tags: ['胃阴', '肾虚', '目暗'], image: '' },
    { id: 'shanzhuyu', name: '山茱萸', latin: 'Cornus officinalis', property: '酸、涩｜微温', meridians: ['肝', '肾'], category: '补肾',
      tags: ['补肾', '收涩', '益精'], oneLiner: '常用于了解肝肾亏虚、眩晕耳鸣等方向。',
      description: '补益肝肾、收涩固脱，为六味地黄丸之臣药。',
      directions: ['肝肾亏虚', '眩晕耳鸣', '遗精盗汗'],
      pairings: [{ combo: '山茱萸 + 熟地', effect: '填补肝肾' }, { combo: '山茱萸 + 山药', effect: '脾肾同补' }],
      contraindications: '命门火炽、素有湿热者忌用。',
      explanation: '补涩兼施的“固脱山萸”。',
      clinical_tags: ['肾虚', '眩晕', '遗精'], image: '' },
    { id: 'qianshi', name: '芡实', latin: 'Euryale ferox', property: '甘、涩｜平', meridians: ['脾', '肾'], category: '补肾',
      tags: ['补肾', '健脾', '收涩'], oneLiner: '常用于了解脾虚久泻、肾虚遗精等方向。',
      description: '益肾固精、补脾止泻、除湿止带，平淡中和。',
      directions: ['脾虚久泻', '肾虚遗精', '带下'],
      pairings: [{ combo: '芡实 + 山药', effect: '健脾固肾' }, { combo: '芡实 + 金樱子', effect: '固精止带' }],
      contraindications: '便秘、腹胀者慎用。',
      explanation: '脾肾双补的“水中人参”。',
      clinical_tags: ['肾虚', '脾虚', '遗精'], image: '' }
];

/* ===================== 2. 派生元数据（均由单一数据源生成） ===================== */
const CABINET_DRAWERS = CANONICAL_HERBS.map(h => h.name);
const CABINET_DATA = {};
CANONICAL_HERBS.forEach(h => { CABINET_DATA[h.name] = h.id; });

const SYMPTOM_DATA = [
    { id: 's1', name: '去火', keywords: ['口苦', '口燥', '咽痛', '上火'], herbs: ['jinyinhua', 'juhua'] },
    { id: 's2', name: '补气', keywords: ['乏力', '没劲', '气短', '虚弱'], herbs: ['huangqi', 'baizhu'] },
    { id: 's3', name: '安神', keywords: ['失眠', '多梦', '睡不好', '心烦', '烦躁'], herbs: ['fuling', 'maidong', 'zhizi'] },
    { id: 's4', name: '健脾', keywords: ['食欲不振', '胃胀', '消化不好'], herbs: ['chenpi', 'baizhu', 'fuling'] },
    { id: 's5', name: '温里散寒', keywords: ['怕冷', '畏寒', '手脚凉', '脘腹冷痛'], herbs: ['ganjiang', 'rougui', 'shengjiang'] },
    { id: 's6', name: '活血调经', keywords: ['痛经', '经闭', '血瘀', '产后瘀阻'], herbs: ['honghua', 'taoren', 'yimucao', 'danggui'] },
    { id: 's7', name: '解表散寒', keywords: ['风寒', '感冒', '头痛', '鼻塞'], herbs: ['mahuang', 'guizhi', 'zisu', 'jingjie'] }
];

const CATEGORIES = ['全部'].concat(CATEGORY_SET);

const EFFECT_TO_CATEGORY = {
    '去火': '清热', '上火': '清热', '清热': '清热',
    '补气': '补气', '气血': '补血', '补血': '补血', '血虚': '补血',
    '补阳': '补阳', '阳虚': '补阳', '温里': '温里', '散寒': '温里', '畏寒': '温里',
    '养阴': '养阴', '滋阴': '养阴', '阴虚': '养阴',
    '补肾': '补肾', '肾虚': '补肾',
    '理气': '理气', '气滞': '理气', '疏肝': '理气',
    '活血': '活血', '化瘀': '活血', '血瘀': '活血',
    '化湿': '化湿', '湿阻': '化湿', '燥湿': '化湿',
    '利水': '利水', '水肿': '利水', '祛湿': '利水', '小便不利': '利水',
    '解表': '解表', '风寒': '解表', '感冒': '解表',
    '止咳': '止咳', '化痰': '止咳', '咳嗽': '止咳', '润肺': '止咳',
    '安神': '安神', '失眠': '安神', '心悸': '安神',
    '消食': '消食', '食积': '消食', '积食': '消食',
    '健脾': '健脾', '脾虚': '健脾'
};

/* ===================== 3. 零容忍校验 ===================== */
function validateHerb(h, idx) {
    const errs = [];
    const where = (h && h.id) ? ('id=' + h.id) : ('#index ' + idx);
    if (!h || typeof h !== 'object') { errs.push(where + ' 不是有效对象'); return errs; }
    // 必填字符串
    REQUIRED_STRING.forEach(k => {
        if (typeof h[k] !== 'string' || h[k].trim() === '') errs.push(where + ' 必填字段缺失或为空: ' + k);
    });
    // id 格式
    if (typeof h.id !== 'string' || !ID_RE.test(h.id)) errs.push(where + ' id 非法（仅小写字母/数字/下划线）: ' + h.id);
    if (typeof h.id === 'string' && ILLEGAL_RE.test(h.id)) errs.push(where + ' id 含非法字符: ' + h.id);
    // 非法字符（描述类字段）
    ['name', 'latin', 'property', 'oneLiner', 'description', 'contraindications', 'explanation'].forEach(k => {
        if (typeof h[k] === 'string' && ILLEGAL_RE.test(h[k])) errs.push(where + ' 字段 ' + k + ' 含非法字符');
    });
    // 性味四气合法性（含「微/大」变体）
    if (typeof h.property === 'string') {
        const tones = h.property.split('｜')[1] || '';
        const ok = VALID_PROP_TONES.some(t => tones.indexOf(t) >= 0);
        if (!ok) errs.push(where + ' 药性（四气）无法识别: ' + h.property);
    }
    // 归经白名单
    if (!Array.isArray(h.meridians) || h.meridians.length === 0) {
        errs.push(where + ' meridians 必须为非空数组');
    } else {
        h.meridians.forEach(m => { if (MERIDIAN_SET.indexOf(m) < 0) errs.push(where + ' 归经越界: ' + m); });
    }
    // 分类白名单
    if (CATEGORY_SET.indexOf(h.category) < 0) errs.push(where + ' 分类越界: ' + h.category);
    // tags / directions / clinical_tags 为数组
    ['tags', 'directions', 'clinical_tags'].forEach(k => {
        if (!Array.isArray(h[k])) errs.push(where + ' 字段 ' + k + ' 必须为数组');
    });
    // image 为字符串
    if (typeof h.image !== 'string') errs.push(where + ' image 必须为字符串');
    // pairings 结构
    if (!Array.isArray(h.pairings)) {
        errs.push(where + ' pairings 必须为数组');
    } else {
        h.pairings.forEach((p, i) => {
            if (!p || typeof p.combo !== 'string' || typeof p.effect !== 'string') errs.push(where + ' pairings[' + i + '] 结构非法');
        });
    }
    return errs;
}

function validateAll() {
    const errors = [];
    const seen = new Set();
    CANONICAL_HERBS.forEach((h, i) => {
        validateHerb(h, i).forEach(e => errors.push(e));
        if (h && h.id) {
            if (seen.has(h.id)) errors.push('重复 id: ' + h.id);
            seen.add(h.id);
        }
    });
    // 派生表一致性
    SYMPTOM_DATA.forEach(g => g.herbs.forEach(id => {
        if (!seen.has(id)) errors.push('SYMPTOM_DATA 引用了不存在的 herb id: ' + id);
    }));
    return { ok: errors.length === 0, errors: errors, count: CANONICAL_HERBS.length };
}

/* ===================== 4. emit：生成 ../data.js ===================== */
const J = (v) => JSON.stringify(v);

function serHerb(h) {
    const L = [];
    L.push('    {');
    L.push('        id: ' + J(h.id) + ',');
    L.push('        name: ' + J(h.name) + ',');
    L.push('        latin: ' + J(h.latin) + ',');
    L.push('        property: ' + J(h.property) + ',');
    L.push('        meridians: ' + J(h.meridians) + ',');
    L.push('        category: ' + J(h.category) + ',');
    L.push('        tags: ' + J(h.tags) + ',');
    L.push('        oneLiner: ' + J(h.oneLiner) + ',');
    L.push('        description: ' + J(h.description) + ',');
    L.push('        directions: ' + J(h.directions) + ',');
    L.push('        pairings: ' + J(h.pairings) + ',');
    L.push('        contraindications: ' + J(h.contraindications) + ',');
    L.push('        explanation: ' + J(h.explanation) + ',');
    L.push('        clinical_tags: ' + J(h.clinical_tags) + ',');
    L.push('        image: ' + J(h.image));
    L.push('    }');
    return L.join('\n');
}

function emitDataJs() {
    const header = [
        '/**',
        ' * 草本知行 (Herb Journey) - Data Layer',
        ' * Schema v2.0：每味药材严格包含 15 个字段（含 clinical_tags 与 image 两个扩展字段）。',
        ' * 数据用于中医药知识学习与身体信号整理参考，不构成医疗诊断或处方建议。',
        ' * 本文件由 scripts/import_herbs.js --emit 自动生成，请勿手工编辑；改药材请改单一数据源。',
        ' */',
        ''
    ].join('\n');
    const herbBlock = 'const HERB_DATA = [\n' + CANONICAL_HERBS.map(serHerb).join(',\n') + '\n];\n';
    const cabinetDrawers = 'const CABINET_DRAWERS = ' + J(CABINET_DRAWERS) + ';\n';
    const cabinetData = 'const CABINET_DATA = ' + J(CABINET_DATA) + ';\n';
    const symptomData = 'const SYMPTOM_DATA = ' + J(SYMPTOM_DATA) + ';\n';
    const categories = 'const CATEGORIES = ' + J(CATEGORIES) + ';\n';
    const effectMap = 'const EFFECT_TO_CATEGORY = ' + J(EFFECT_TO_CATEGORY) + ';\n';
    const footer = [
        '',
        '// 浏览器由 index.html 注入全局；Node 下导出供 QA 与 import 脚本复用。',
        'if (typeof module !== "undefined" && module.exports) {',
        '    module.exports = { HERB_DATA, CABINET_DRAWERS, CABINET_DATA, SYMPTOM_DATA, CATEGORIES, EFFECT_TO_CATEGORY };',
        '}',
        ''
    ].join('\n');
    return header + '\n' + herbBlock + '\n' + cabinetDrawers + '\n' + cabinetData + '\n' + symptomData + '\n' + categories + '\n' + effectMap + '\n' + footer;
}

/* ===================== 5. CLI ===================== */
function main() {
    const arg = process.argv[2];
    if (arg === '--validate') {
        const r = validateAll();
        console.log('校验药材总数：' + r.count);
        if (r.ok) {
            console.log('✓ 全部药材通过零容忍 Schema 校验');
            process.exit(0);
        } else {
            console.log('✗ 校验失败，错误如下：');
            r.errors.forEach(e => console.log('  - ' + e));
            process.exit(1);
        }
    } else if (arg === '--emit') {
        const r = validateAll();
        if (!r.ok) {
            console.log('✗ 校验未通过，拒绝 emit。错误：');
            r.errors.forEach(e => console.log('  - ' + e));
            process.exit(1);
        }
        const out = emitDataJs();
        const target = path.resolve(__dirname, '..', 'data.js');
        fs.writeFileSync(target, out, 'utf8');
        console.log('✓ 已生成 ' + target + '（' + r.count + ' 味药材）');
        process.exit(0);
    } else {
        console.log('用法：');
        console.log('  node scripts/import_herbs.js --validate   零容忍校验全部药材');
        console.log('  node scripts/import_herbs.js --emit        校验并生成 ../data.js');
        process.exit(0);
    }
}

module.exports = {
    CANONICAL_HERBS, CATEGORY_SET, MERIDIAN_SET, SYMPTOM_DATA, CATEGORIES,
    EFFECT_TO_CATEGORY, CABINET_DATA, CABINET_DRAWERS, validateAll, emitDataJs
};

if (require.main === module) main();
