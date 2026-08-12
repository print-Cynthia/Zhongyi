/**
 * 草本知行 (Herb Journey) - Data Layer
 * 标准 Schema：每味药材严格包含 16 个字段。
 * 数据用于中医药知识学习与身体信号整理参考，不构成医疗诊断或处方建议。
 */

const HERB_DATA = [
    {
        id: "huangqi",
        name: "黄芪",
        latin: "Astragalus membranaceus",
        property: "甘｜微温",
        meridians: ["肺", "脾"],
        category: "补气",
        tags: ["补气", "固表"],
        oneLiner: "常用于了解气虚、乏力、自汗等方向。",
        description: "黄芪被誉为“补气之长”，能增强身体的推动力，固护肌表。",
        directions: ["气虚乏力", "表虚自汗", "利水消肿"],
        pairings: [
            { combo: "黄芪 + 白术", effect: "益气固表" },
            { combo: "黄芪 + 当归", effect: "气血双补" }
        ],
        contraindications: "实热证、阴虚阳亢者不宜。",
        explanation: "给身体“加点油”，让防御力更稳固。",
        image: ""
    },
    {
        id: "danggui",
        name: "当归",
        latin: "Angelica sinensis",
        property: "甘、辛｜温",
        meridians: ["肝", "心", "脾"],
        category: "补血",
        tags: ["补血", "活血"],
        oneLiner: "常用于了解血虚萎黄、眩晕心悸等方向。",
        description: "血家圣药，既能补血又能活血，为妇科调血要药。",
        directions: ["血虚萎黄", "月经不调", "跌打损伤"],
        pairings: [
            { combo: "当归 + 熟地", effect: "补血滋阴" },
            { combo: "当归 + 黄芪", effect: "益气生血" }
        ],
        contraindications: "湿盛中满、大便溏泄者慎用。",
        explanation: "身体的“补血泵”，让血液循环更有活力。",
        image: ""
    },
    {
        id: "jinyinhua",
        name: "金银花",
        latin: "Lonicera japonica",
        property: "甘｜寒",
        meridians: ["肺", "心", "胃"],
        category: "清热",
        tags: ["清热", "解毒"],
        oneLiner: "常用于了解热象明显、咽喉不适等方向。",
        description: "清热解毒的代表，疏散风热效果佳，常用于外感风热。",
        directions: ["风热感冒", "咽喉肿痛", "痈肿疔疮"],
        pairings: [
            { combo: "金银花 + 连翘", effect: "清热解毒" },
            { combo: "金银花 + 菊花", effect: "疏散风热" }
        ],
        contraindications: "脾胃虚寒者慎用。",
        explanation: "身体的“天然降火茶”，针对红肿热痛。",
        image: ""
    },
    {
        id: "fuling",
        name: "茯苓",
        latin: "Poria cocos",
        property: "甘、淡｜平",
        meridians: ["心", "脾", "肾"],
        category: "祛湿",
        tags: ["祛湿", "健脾"],
        oneLiner: "常用于了解水肿、脾虚食少等方向。",
        description: "利水渗湿而不伤正气，兼能健脾宁心。",
        directions: ["水肿尿少", "痰饮眩悸", "脾虚食少"],
        pairings: [
            { combo: "茯苓 + 白术", effect: "健脾燥湿" },
            { combo: "茯苓 + 猪苓", effect: "通利小便" }
        ],
        contraindications: "虚寒滑精、气虚下陷者慎用。",
        explanation: "身体的“除湿机”，让脾胃更干爽。",
        image: ""
    },
    {
        id: "chenpi",
        name: "陈皮",
        latin: "Citri Reticulatae Pericarpium",
        property: "苦、辛｜温",
        meridians: ["脾", "肺"],
        category: "理气",
        tags: ["理气", "健脾"],
        oneLiner: "常用于了解腹胀、食少吐泻等方向。",
        description: "理气健脾，燥湿化痰，重在恢复气机顺畅。",
        directions: ["脘腹胀满", "食少吐泻", "咳嗽痰多"],
        pairings: [
            { combo: "陈皮 + 半夏", effect: "燥湿化痰" },
            { combo: "陈皮 + 茯苓", effect: "理气健脾" }
        ],
        contraindications: "舌赤少津、内有实热者慎用。",
        explanation: "身体的“顺气器”，消除肚子里的堵塞感。",
        image: ""
    },
    {
        id: "juhua",
        name: "菊花",
        latin: "Chrysanthemum morifolium",
        property: "甘、苦｜微寒",
        meridians: ["肺", "肝"],
        category: "清热",
        tags: ["清热", "明目"],
        oneLiner: "常用于了解目赤肿痛、头晕目眩等方向。",
        description: "疏散风热，平肝明目，清热解毒。",
        directions: ["目赤肿痛", "头痛眩晕", "风热感冒"],
        pairings: [
            { combo: "菊花 + 枸杞子", effect: "滋补肝肾，清肝明目" },
            { combo: "菊花 + 薄荷", effect: "疏散风热" }
        ],
        contraindications: "脾胃虚寒者不宜多服。",
        explanation: "眼睛的“降火伴侣”，让视力更清朗。",
        image: ""
    },
    {
        id: "gancao",
        name: "甘草",
        latin: "Glycyrrhiza uralensis",
        property: "甘｜平",
        meridians: ["心", "肺", "脾", "胃"],
        category: "补气",
        tags: ["调和", "补气"],
        oneLiner: "常用于了解调和诸药、咳嗽痰多等方向。",
        description: "“国老”之称，补脾益气，清热解毒，祛痰止咳，调和诸药。",
        directions: ["脾胃虚弱", "倦怠乏力", "调和诸药"],
        pairings: [
            { combo: "甘草 + 桔梗", effect: "宣肺利咽" },
            { combo: "甘草 + 芍药", effect: "缓急止痛" }
        ],
        contraindications: "湿盛胀满、浮肿者慎用。",
        explanation: "中药里的“和事佬”，协调各方药性。",
        image: ""
    },
    {
        id: "baizhu",
        name: "白术",
        latin: "Atractylodes macrocephala",
        property: "苦、甘｜温",
        meridians: ["脾", "胃"],
        category: "健脾",
        tags: ["健脾", "燥湿"],
        oneLiner: "常用于了解脾虚食少、腹胀泄泻等方向。",
        description: "健脾益气，燥湿利水，固表止汗。",
        directions: ["脾虚食少", "腹胀泄泻", "水肿自汗"],
        pairings: [
            { combo: "白术 + 茯苓", effect: "健脾利水" },
            { combo: "白术 + 黄芪", effect: "益气固表" }
        ],
        contraindications: "阴虚内热、津液亏耗者慎用。",
        explanation: "脾胃的“干燥剂”和“动力泵”。",
        image: ""
    },
    {
        id: "maidong",
        name: "麦冬",
        latin: "Ophiopogon japonicus",
        property: "甘、微苦｜微寒",
        meridians: ["心", "肺", "胃"],
        category: "养阴",
        tags: ["养阴", "润肺", "生津"],
        oneLiner: "常用于了解肺燥干咳、阴虚口渴等方向。",
        description: "养阴生津，润肺清心，为滋阴润燥之要药。",
        directions: ["肺燥干咳", "阴虚口渴", "心烦失眠"],
        pairings: [
            { combo: "麦冬 + 半夏", effect: "润燥生津，和胃降逆" },
            { combo: "麦冬 + 五味子", effect: "益气养阴，敛汗安神" }
        ],
        contraindications: "脾胃虚寒、大便溏泄者慎用。",
        explanation: "身体的“润燥喷雾”，缓解干燥与虚火。",
        image: ""
    },
    {
        id: "gouqizi",
        name: "枸杞子",
        latin: "Lycium barbarum",
        property: "甘｜平",
        meridians: ["肝", "肾"],
        category: "补肾",
        tags: ["补肾", "明目", "益精"],
        oneLiner: "常用于了解肝肾不足、目昏眼花等方向。",
        description: "滋补肝肾，益精明目，为平补之佳品。",
        directions: ["肝肾阴虚", "腰膝酸软", "眩晕目昏"],
        pairings: [
            { combo: "枸杞子 + 菊花", effect: "滋补肝肾，清肝明目" },
            { combo: "枸杞子 + 熟地", effect: "填补肝肾精血" }
        ],
        contraindications: "脾虚便溏、外邪实热者不宜多食。",
        explanation: "肝肾的“营养补给”，让眼睛和腰膝更有力。",
        image: ""
    },
    {
        id: "huanglian",
        name: "黄连",
        latin: "Coptis chinensis",
        property: "苦｜寒",
        meridians: ["心", "脾", "胃", "肝", "胆", "大肠"],
        category: "清热",
        tags: ["清热", "燥湿", "泻火"],
        oneLiner: "常用于了解湿热泻痢、心烦不寐等方向。",
        description: "清热燥湿，泻火解毒，尤善清中焦湿热与心火。",
        directions: ["湿热痞满", "泻痢腹痛", "心烦不寐"],
        pairings: [
            { combo: "黄连 + 黄芩", effect: "清热燥湿解毒" },
            { combo: "黄连 + 木香", effect: "行气化滞，止痢" }
        ],
        contraindications: "脾胃虚寒者忌用，阴虚津伤者慎用。",
        explanation: "身体里的“强力灭火器”，专治湿热火毒。",
        image: ""
    },
    {
        id: "yiyiren",
        name: "薏苡仁",
        latin: "Coix lacryma-jobi",
        property: "甘、淡｜凉",
        meridians: ["脾", "胃", "肺"],
        category: "祛湿",
        tags: ["祛湿", "健脾", "排脓"],
        oneLiner: "常用于了解脾虚湿盛、水肿脚气等方向。",
        description: "利水渗湿，健脾止泻，兼可排脓除痹。",
        directions: ["水肿脚气", "脾虚泄泻", "湿痹拘挛"],
        pairings: [
            { combo: "薏苡仁 + 茯苓", effect: "健脾利湿" },
            { combo: "薏苡仁 + 赤小豆", effect: "利水消肿（食疗常用）" }
        ],
        contraindications: "孕妇及津枯便秘者慎用。",
        explanation: "身体的“排水通道”，帮脾胃甩掉多余水汽。",
        image: ""
    },
    {
        id: "dangshen",
        name: "党参",
        latin: "Codonopsis pilosula",
        property: "甘｜平",
        meridians: ["脾", "肺"],
        category: "补气",
        tags: ["补气", "健脾", "益肺"],
        oneLiner: "常用于了解脾肺气虚、气短心悸等方向。",
        description: "健脾益肺，养血生津，补气力缓而不燥。",
        directions: ["脾肺气虚", "食少倦怠", "气血不足"],
        pairings: [
            { combo: "党参 + 白术", effect: "健脾益气" },
            { combo: "党参 + 黄芪", effect: "补益脾肺之气" }
        ],
        contraindications: "实证、热证而正气不虚者不宜。",
        explanation: "黄芪的“温和版”，缓缓补足中气。",
        image: ""
    },
    {
        id: "huangqin",
        name: "黄芩",
        latin: "Scutellaria baicalensis",
        property: "苦｜寒",
        meridians: ["肺", "胆", "脾", "大肠", "小肠"],
        category: "清热",
        tags: ["清热", "燥湿", "泻火"],
        oneLiner: "常用于了解肺热咳嗽、湿热黄疸等方向。",
        description: "清热燥湿，泻火解毒，止血安胎，善清上焦肺火。",
        directions: ["肺热咳嗽", "湿热黄疸", "胎动不安"],
        pairings: [
            { combo: "黄芩 + 黄连", effect: "清热燥湿解毒" },
            { combo: "黄芩 + 白术", effect: "清热安胎" }
        ],
        contraindications: "脾胃虚寒、食少便溏者慎用。",
        explanation: "肺与胆的“清热卫士”，管住上焦火气。",
        image: ""
    },
    {
        id: "lianqiao",
        name: "连翘",
        latin: "Forsythia suspensa",
        property: "苦｜微寒",
        meridians: ["肺", "心", "小肠"],
        category: "清热",
        tags: ["清热", "解毒", "散结"],
        oneLiner: "常用于了解风热外感、痈肿疮毒等方向。",
        description: "清热解毒，消肿散结，为“疮家圣药”。",
        directions: ["风热感冒", "痈肿疮毒", "咽喉肿痛"],
        pairings: [
            { combo: "连翘 + 金银花", effect: "清热解毒，疏散风热" },
            { combo: "连翘 + 薄荷", effect: "轻清宣透，解表清热" }
        ],
        contraindications: "脾胃虚寒及气虚脓清者不宜。",
        explanation: "皮肤的“消肿专家”，对付红肿热毒包块。",
        image: ""
    },
    {
        id: "zhizi",
        name: "栀子",
        latin: "Gardenia jasminoides",
        property: "苦｜寒",
        meridians: ["心", "肺", "三焦"],
        category: "清热",
        tags: ["清热", "泻火", "利湿"],
        oneLiner: "常用于了解热病心烦、湿热黄疸等方向。",
        description: "泻火除烦，清热利湿，凉血解毒，通泻三焦之火。",
        directions: ["热病心烦", "湿热黄疸", "血热吐衄"],
        pairings: [
            { combo: "栀子 + 淡豆豉", effect: "清宣郁热，除烦安神" },
            { combo: "栀子 + 茵陈", effect: "清热利湿退黄" }
        ],
        contraindications: "脾虚便溏、食少者慎用。",
        explanation: "三焦的“导热下行阀”，把火气从尿里带走。",
        image: ""
    },
    {
        id: "chaihu",
        name: "柴胡",
        latin: "Bupleurum chinense",
        property: "辛、苦｜微寒",
        meridians: ["肝", "胆", "肺"],
        category: "理气",
        tags: ["疏肝", "解郁", "和解"],
        oneLiner: "常用于了解情志不畅、胸胁不舒等疏肝方向。",
        description: "疏散退热，疏肝解郁，升举阳气，是理解肝气调达思路的常见草本。",
        directions: ["胸胁胀满", "情志不舒", "寒热往来"],
        pairings: [
            { combo: "柴胡 + 白芍", effect: "偏向疏肝柔肝的配伍思路" },
            { combo: "柴胡 + 黄芩", effect: "偏向和解少阳的配伍思路" }
        ],
        contraindications: "肝阳上亢、阴虚火旺者应谨慎，具体使用请咨询专业人士。",
        explanation: "可以理解为帮助梳理郁滞气机、让肝气更顺畅的草本。",
        image: ""
    },
    {
        id: "baishao",
        name: "白芍",
        latin: "Paeonia lactiflora",
        property: "苦、酸｜微寒",
        meridians: ["肝", "脾"],
        category: "补血",
        tags: ["养血", "柔肝", "缓急"],
        oneLiner: "常用于了解血虚、肝脾不和及拘急不舒等方向。",
        description: "养血调经，敛阴止汗，柔肝止痛，常用于理解养血与柔肝并重的思路。",
        directions: ["血虚萎黄", "胁肋不舒", "筋脉拘急"],
        pairings: [
            { combo: "白芍 + 当归", effect: "偏向养血调和的配伍思路" },
            { combo: "白芍 + 甘草", effect: "偏向柔肝缓急的配伍思路" }
        ],
        contraindications: "阳衰虚寒者慎用，具体使用请咨询专业人士。",
        explanation: "可以理解为兼顾养血与柔和筋脉的一味草本。",
        image: ""
    },
    {
        id: "fangfeng",
        name: "防风",
        latin: "Saposhnikovia divaricata",
        property: "辛、甘｜微温",
        meridians: ["膀胱", "肝", "脾"],
        category: "理气",
        tags: ["祛风", "解表", "止痉"],
        oneLiner: "常用于了解外感风邪、头身不舒等方向。",
        description: "祛风解表，胜湿止痛，止痉，是理解风邪相关调理思路的常见草本。",
        directions: ["外感风邪", "头痛身痛", "风湿不舒"],
        pairings: [
            { combo: "防风 + 黄芪 + 白术", effect: "偏向益气固表的配伍思路" },
            { combo: "防风 + 荆芥", effect: "偏向疏风解表的配伍思路" }
        ],
        contraindications: "阴虚火旺、血虚痉急者慎用，具体使用请咨询专业人士。",
        explanation: "可以理解为处理风邪与表层不适思路中的常见草本。",
        image: ""
    },
    {
        id: "dahuang",
        name: "大黄",
        latin: "Rheum palmatum",
        property: "苦｜寒",
        meridians: ["脾", "胃", "大肠", "肝", "心包"],
        category: "清热",
        tags: ["泻下", "清热", "活血"],
        oneLiner: "常用于了解里实积滞、热结及瘀滞等方向。",
        description: "泻下攻积，清热泻火，凉血解毒，逐瘀通经，作用方向较强。",
        directions: ["实热积滞", "热结便秘", "瘀滞不畅"],
        pairings: [
            { combo: "大黄 + 芒硝", effect: "偏向泻热通下的配伍思路" },
            { combo: "大黄 + 丹参", effect: "偏向活血化瘀的配伍思路" }
        ],
        contraindications: "孕期、哺乳期、月经期及脾胃虚弱者不宜自行使用，请咨询专业人士。",
        explanation: "属于作用较强的通下类草本，不适合作为日常自行调理选择。",
        image: ""
    },
    {
        id: "banxia",
        name: "半夏",
        latin: "Pinellia ternata",
        property: "辛｜温",
        meridians: ["脾", "胃", "肺"],
        category: "祛湿",
        tags: ["燥湿", "化痰", "和胃"],
        oneLiner: "常用于了解痰湿、胃气不和及咳嗽痰多等方向。",
        description: "燥湿化痰，降逆止呕，消痞散结，常用于理解痰湿与胃气不和的思路。",
        directions: ["咳嗽痰多", "胃气上逆", "痰湿痞满"],
        pairings: [
            { combo: "半夏 + 陈皮", effect: "偏向燥湿化痰的配伍思路" },
            { combo: "半夏 + 生姜", effect: "偏向和胃降逆的配伍思路" }
        ],
        contraindications: "生半夏有毒，必须规范炮制；阴虚燥咳及出血者慎用，请咨询专业人士。",
        explanation: "主要用于理解痰湿与胃气上逆方向，不能自行使用未经炮制的半夏。",
        image: ""
    },
    {
        id: "chuanxiong",
        name: "川芎",
        latin: "Ligusticum chuanxiong",
        property: "辛｜温",
        meridians: ["肝", "胆", "心包"],
        category: "理气",
        tags: ["活血", "行气", "止痛"],
        oneLiner: "常用于了解气血运行不畅、头痛及经行不适等方向。",
        description: "活血行气，祛风止痛，常用于理解气血同调与头痛相关的配伍思路。",
        directions: ["气滞血瘀", "头痛不舒", "经行腹痛"],
        pairings: [
            { combo: "川芎 + 当归", effect: "偏向养血活血的配伍思路" },
            { combo: "川芎 + 白芷", effect: "偏向祛风止痛的配伍思路" }
        ],
        contraindications: "阴虚火旺、月经过多及出血倾向者慎用，请咨询专业人士。",
        explanation: "可以理解为帮助气血运行、常见于头痛和瘀滞知识中的草本。",
        image: ""
    },
    {
        id: "danshen",
        name: "丹参",
        latin: "Salvia miltiorrhiza",
        property: "苦｜微寒",
        meridians: ["心", "肝"],
        category: "理气",
        tags: ["活血", "祛瘀", "清心"],
        oneLiner: "常用于了解血行不畅、心烦及瘀滞等方向。",
        description: "活血祛瘀，通经止痛，清心除烦，常用于理解血瘀相关调理思路。",
        directions: ["血瘀不畅", "胸部不舒", "心烦不寐"],
        pairings: [
            { combo: "丹参 + 川芎", effect: "偏向活血行气的配伍思路" },
            { combo: "丹参 + 麦冬", effect: "偏向养阴清心的配伍思路" }
        ],
        contraindications: "正在使用抗凝药物或有出血倾向者应先咨询医生或药师。",
        explanation: "可以理解为血行与心神方向中常见的活血类草本。",
        image: ""
    },
    {
        id: "shanyao",
        name: "山药",
        latin: "Dioscorea opposita",
        property: "甘｜平",
        meridians: ["脾", "肺", "肾"],
        category: "健脾",
        tags: ["健脾", "益肺", "补肾"],
        oneLiner: "常用于了解脾胃虚弱、食少乏力及肺肾不足等方向。",
        description: "补脾养胃，生津益肺，补肾涩精，特点较为平和。",
        directions: ["脾虚食少", "倦怠乏力", "肺肾不足"],
        pairings: [
            { combo: "山药 + 白术", effect: "偏向健脾益气的配伍思路" },
            { combo: "山药 + 枸杞子", effect: "偏向脾肾同调的配伍思路" }
        ],
        contraindications: "湿盛中满、实邪积滞者慎用，具体使用请咨询专业人士。",
        explanation: "可以理解为兼顾脾、肺、肾，性质较平和的补益草本。",
        image: ""
    },
    {
        id: "suanzaoren",
        name: "酸枣仁",
        latin: "Ziziphus jujuba var. spinosa",
        property: "甘、酸｜平",
        meridians: ["肝", "胆", "心"],
        category: "养阴",
        tags: ["养心", "安神", "敛汗"],
        oneLiner: "常用于了解心神不宁、睡眠不稳及虚烦等方向。",
        description: "养心补肝，宁心安神，敛汗生津，是理解虚烦失眠方向的常见草本。",
        directions: ["入睡困难", "多梦易醒", "虚烦不安"],
        pairings: [
            { combo: "酸枣仁 + 茯苓", effect: "偏向养心安神的配伍思路" },
            { combo: "酸枣仁 + 麦冬", effect: "偏向养阴宁心的配伍思路" }
        ],
        contraindications: "有实邪郁火或严重嗜睡者慎用，具体使用请咨询专业人士。",
        explanation: "可以理解为偏向养心安神、改善虚烦方向的草本知识。",
        image: ""
    },
    {
        id: "jiegeng",
        name: "桔梗",
        latin: "Platycodon grandiflorus",
        property: "苦、辛｜平",
        meridians: ["肺"],
        category: "理气",
        tags: ["宣肺", "利咽", "祛痰"],
        oneLiner: "常用于了解咽喉不适、咳嗽痰多及肺气不宣等方向。",
        description: "宣肺，利咽，祛痰，排脓，是理解肺气宣降思路的常见草本。",
        directions: ["咽喉不适", "咳嗽痰多", "肺气不宣"],
        pairings: [
            { combo: "桔梗 + 甘草", effect: "偏向宣肺利咽的配伍思路" },
            { combo: "桔梗 + 杏仁", effect: "偏向调理肺气宣降的配伍思路" }
        ],
        contraindications: "阴虚久咳、咳血及胃溃疡者慎用，请咨询专业人士。",
        explanation: "可以理解为帮助肺气向上宣通、常见于咽喉知识中的草本。",
        image: ""
    },
    {
        id: "xingren",
        name: "杏仁",
        latin: "Prunus armeniaca",
        property: "苦｜微温",
        meridians: ["肺", "大肠"],
        category: "养阴",
        tags: ["止咳", "平喘", "润肠"],
        oneLiner: "常用于了解咳嗽气逆及肠燥不畅等方向。",
        description: "降气止咳平喘，润肠通便，常用于理解肺气上逆与津亏肠燥的思路。",
        directions: ["咳嗽气逆", "呼吸不畅", "肠燥便秘"],
        pairings: [
            { combo: "杏仁 + 桔梗", effect: "偏向调理肺气宣降的配伍思路" },
            { combo: "杏仁 + 麦冬", effect: "偏向润肺降气的配伍思路" }
        ],
        contraindications: "苦杏仁含有毒性成分，儿童、孕期及体弱者不得自行使用，请咨询专业人士。",
        explanation: "主要用于理解肺气下降与润燥方向，不宜自行大量食用苦杏仁。",
        image: ""
    },
    {
        id: "banlangen",
        name: "板蓝根",
        latin: "Isatis indigotica",
        property: "苦｜寒",
        meridians: ["心", "胃"],
        category: "清热",
        tags: ["清热", "解毒", "利咽"],
        oneLiner: "常用于了解热毒、咽喉不适等清热解毒方向。",
        description: "清热解毒，凉血利咽，常用于理解热毒与咽喉不适相关知识。",
        directions: ["咽喉不适", "热毒偏盛", "温热方向"],
        pairings: [
            { combo: "板蓝根 + 金银花", effect: "偏向清热解毒的配伍思路" },
            { combo: "板蓝根 + 连翘", effect: "偏向清热利咽的配伍思路" }
        ],
        contraindications: "脾胃虚寒、体质虚弱者不宜长期自行使用，请咨询专业人士。",
        explanation: "可以理解为热毒与咽喉方向中的常见清热类草本。",
        image: ""
    },
    {
        id: "bohe",
        name: "薄荷",
        latin: "Mentha haplocalyx",
        property: "辛｜凉",
        meridians: ["肺", "肝"],
        category: "清热",
        tags: ["疏风", "清利头目", "疏肝"],
        oneLiner: "常用于了解风热、头目不清及咽喉不适等方向。",
        description: "疏散风热，清利头目，利咽透疹，疏肝行气。",
        directions: ["风热不适", "头目不清", "咽喉不利"],
        pairings: [
            { combo: "薄荷 + 菊花", effect: "偏向疏散风热的配伍思路" },
            { combo: "薄荷 + 柴胡", effect: "偏向疏肝解郁的配伍思路" }
        ],
        contraindications: "体虚多汗者不宜多用，芳香成分不宜久煎，具体请咨询专业人士。",
        explanation: "可以理解为带有清凉疏散特点、兼顾头目和气机的草本。",
        image: ""
    },
    {
        id: "shengjiang",
        name: "生姜",
        latin: "Zingiber officinale",
        property: "辛｜微温",
        meridians: ["肺", "脾", "胃"],
        category: "健脾",
        tags: ["温中", "和胃", "解表"],
        oneLiner: "常用于了解胃寒不适、恶心及风寒初起等方向。",
        description: "解表散寒，温中止呕，温肺止咳，常用于理解脾胃与风寒方向。",
        directions: ["胃寒不适", "恶心欲吐", "风寒初起"],
        pairings: [
            { combo: "生姜 + 半夏", effect: "偏向和胃降逆的配伍思路" },
            { combo: "生姜 + 大枣", effect: "偏向调和脾胃的配伍思路" }
        ],
        contraindications: "阴虚内热、热盛及出血倾向者慎用，具体使用请咨询专业人士。",
        explanation: "可以理解为偏温、常用于脾胃和风寒知识中的日常草本。",
        image: ""
    }
];

// 药柜所需的 16 个药材名称（与 HERB_DATA 一一对应）
const CABINET_DRAWERS = [
    "黄芪", "当归", "金银花", "茯苓",
    "陈皮", "菊花", "甘草", "白术",
    "麦冬", "枸杞子", "黄连", "薏苡仁",
    "党参", "黄芩", "连翘", "栀子"
];

// 药柜名称 → HERB_DATA id 的完整映射（16 味全覆盖）
const CABINET_DATA = {
    "黄芪": "huangqi",
    "当归": "danggui",
    "金银花": "jinyinhua",
    "茯苓": "fuling",
    "陈皮": "chenpi",
    "菊花": "juhua",
    "甘草": "gancao",
    "白术": "baizhu",
    "麦冬": "maidong",
    "枸杞子": "gouqizi",
    "黄连": "huanglian",
    "薏苡仁": "yiyiren",
    "党参": "dangshen",
    "黄芩": "huangqin",
    "连翘": "lianqiao",
    "栀子": "zhizi"
};

// 症状 → 中医方向（保留，供后续“身体信号整理”升级使用）
const SYMPTOM_DATA = [
    { id: "s1", name: "去火", keywords: ["口苦", "口燥", "咽痛", "上火"], herbs: ["jinyinhua", "juhua"] },
    { id: "s2", name: "补气", keywords: ["乏力", "没劲", "气短", "虚弱"], herbs: ["huangqi", "baizhu"] },
    { id: "s3", name: "安神", keywords: ["失眠", "多梦", "睡不好", "心烦", "烦躁"], herbs: ["fuling", "maidong", "zhizi"] },
    { id: "s4", name: "健脾", keywords: ["食欲不振", "胃胀", "消化不好"], herbs: ["chenpi", "baizhu", "fuling"] }
];

// 分类筛选（仅保留实际有药材的分类，避免空筛选）
const CATEGORIES = ["全部", "清热", "补气", "祛湿", "健脾", "补血", "理气", "养阴", "补肾"];

// 功效/通俗词 → 分类映射（供快捷标签语义匹配）
const EFFECT_TO_CATEGORY = {
    "去火": "清热",
    "上火": "清热",
    "清热": "清热",
    "补气": "补气",
    "健脾": "健脾",
    "祛湿": "祛湿",
    "理气": "理气",
    "养阴": "养阴",
    "补肾": "补肾",
    "补血": "补血"
};
