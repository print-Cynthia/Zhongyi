# 领域层 · 中医模块 PRD 5 Skill 边界细化

> 领域层。本文件把 PRD《草本知行 - 身体信号整理 (Agent 模块)》的 Router + 5 Skill 落成**可执行的边界约束**，供工程组·算法AI / 后端数据AI、中医组、合规组员工引用。
> 来源：PRD（17 页）。非目标：❌ 不做开方与临床诊断；❌ 不做长周期健康档案追踪。

## 0. 全局硬约束（所有 Skill 必须遵守）
- **Retrieval First**：所有方剂组成、古籍出处、药材毒性数据 100% 来源于本地结构化数据库（tcm_knowledge_base），严禁 LLM 凭自由记忆生成。
- **Prompt 边界**：LLM 仅对检索出的静态 JSON 数据进行语意连贯性组装，严禁添加任何数据库未提及的药物成分或医疗诊断结论。
- **空数据兜底**：若用户体征无法精准匹配特定古籍方剂，系统自动兜底输出通用"健脾理气 / 温和调理方向"，避免强制推荐不适宜方剂。
- **红线**：不做开方与临床诊断；不做长周期健康档案追踪。

## 1. 五维体征映射库（Skill 1 内部依据）
Skill 1 提取时向以下五个核心维度靠拢：
1. **部位与主诉**：头面、胸胁、脾胃 / 腹部、腰肾、四肢
2. **寒热与汗出**：恶寒、发热、手足冰冷、五心烦热、自汗、盗汗
3. **饮食与消化**：口干 / 口苦、食欲不振、食后腹胀、喜热饮 / 喜冷饮
4. **二便特征**：大便干结、大便溏薄（沾马桶）、小便黄赤、夜尿频多
5. **睡眠与精神**：入睡困难、多梦易醒、精神倦怠、易怒烦躁

## 2. Skill 1 · SymptomExtractor（症状与体征提取器）
- **定位**：纯粹 NLU 提取器（诊断缺失维度）。
- **交互形态**：后台静默运行（对用户不可见）。
- **Input**：`{ "user_raw_input": "...", "historical_symptoms": [] }`
- **Output**：
```json
{
  "extracted_symptoms": [
    { "raw_phrase": "吃完饭肚子涨", "standard_tag": "食后腹胀", "category": "消化", "confidence": 0.95 }
  ],
  "missing_dimensions": ["二便特征", "舌苔/口干"],
  "overall_completeness": "medium"
}
```
- **冷启动兜底**：若有效体征标签 < 2（如仅"累"/"不舒服"）→ `overall_completeness = low` → 强行触发 Skill 2 进入【Path B: 全局维度补漏】。

## 3. Skill 2 · DynamicClarifier（动态追问决策器）
- **定位**：交互式深层辨证与信息补全器（动态生成具象化追问卡片）。
- **追问触发逻辑**：
  - **假设驱动**（Hypothesis-Driven）：若初始体征显现明确方向（如"食后腹胀"），反向调用中医问诊逻辑链验证关联指标（如"便溏/喜温"）。
  - **缺口补漏**（Dimensional Screening）：若初始极度模糊，基于《十问歌》逻辑对未提及维度（寒热、睡眠、二便）结构化补漏。
- **收敛与止损（Stopping Criteria）**：
  - 收敛分 **Convergence Score ≥ 0.85**（满足【主诉 + 脏腑倾向 + 至少 1 个兼次症】）→ 自动熔断终止追问，跳到 Skill 3。
  - 硬性上限 **Max Rounds = 5**，达到 5 轮后无论收敛分高低，强行进入 Skill 3。
- **交互形态**：前台渲染 1 句温和引导语 + 3~4 个可点击结构化选项卡片（单选 / 多选）。
- **Input**：`{ "extracted_symptoms": [...], "current_round": 1 }`
- **Output**：
```json
{
  "should_continue": true,
  "inference_hypothesis": "脾虚湿阻倾向",
  "question_text": "为了进一步确认脾胃运化情况，请问您平时大便和口中感受如何？",
  "option_cards": [
    { "label": "大便偏溏 / 易沾马桶", "tag": "便溏" },
    { "label": "口干但不想喝水", "tag": "口干不欲饮" },
    { "label": "口中黏腻 / 淡而无味", "tag": "口黏" },
    { "label": "以上皆无 / 情况正常", "tag": "正常" }
  ]
}
```

## 4. Skill 3 · SymptomSynthesizer（症状描述收敛器）
- **定位**：Agent 的"文本重构与防错大脑"，生成报告前最终确认卡片。
- **职责**：
  - 信息拼接与语法重构（主诉部位与性质 + 诱发因素 + 兼带体征）。
  - 消重与矛盾剔除（多轮矛盾以最新澄清回答为准）。
  - 人机最终确认（渲染【症状确认卡片】，用户可微调 / 剔除 / 补充）。
- **Input**：`{ "all_collected_symptoms": [{ "raw_phrase": "...", "standard_tag": "...", "source": "skill1|skill2_round1" }] }`
- **Output**：
```json
{
  "summary_status": "ready_for_confirmation",
  "ui_card_payload": {
    "card_type": "symptom_summary_confirmation_card",
    "card_title": "您的身体信号已整理完毕",
    "synthesized_symptom_text": "主要表现为上腹部隐痛（进食后较为明显），同时伴有大便偏溏易沾马桶的情况。",
    "structured_tags": {
      "primary_symptoms": ["上腹隐痛（食后明显）"],
      "secondary_symptoms": ["大便偏溏"]
    },
    "action_buttons": [
      { "label": "确认无误，生成报告", "action": "trigger_skill_4", "type": "primary" },
      { "label": "补充 / 修改描述", "action": "edit_symptoms", "type": "secondary" }
    ]
  }
}
```

## 5. Skill 4 · KnowledgeRetriever（知识库检索与 RAG 校验器）
- **定位**：精准知识匹配与安全防线（RAG 检索大脑），消除 LLM 事实性幻觉。
- **职责**：
  - 数据库精确匹配：按【脏腑倾向】与【主诉标签】检索 tcm_knowledge_base，匹配 1~2 古籍经典名方及出处。
  - 毒性与煎服安全强预警：扫描匹配方剂与关联草本，触及《中国药典》毒性药材名录 → **强行插入静态【毒性 / 煎服特别提示】**，不依赖大模型自主推断。
  - 草本查询页路由映射：关联草本绑定 herb_detail_id + router_path，前端跳转闭环。
  - 细粒度生活食疗检索：结合寒热属性输出具象化食疗与避忌。
- **Input**：`{ "zangfu_tendency": "脾失健运 / 湿浊内阻", "confirmed_tags": ["上腹隐痛","食后加重","大便偏溏"] }`
- **Output**：
```json
{
  "retrieval_status": "success",
  "knowledge_payload": {
    "matched_formula": {
      "formula_name": "参苓白术散 (参考)",
      "source_book": "《太平惠民和剂局方》",
      "description": "古籍记载常用于脾胃虚弱、湿邪内生所致的食少便溏、肢体倦怠。"
    },
    "matched_herbs": [
      { "herb_name": "陈皮", "herb_detail_id": "herb_chenpi_001", "router_path": "/herb-query/detail?id=herb_chenpi_001", "description": "...", "has_toxicity": false },
      { "herb_name": "制半夏", "herb_detail_id": "herb_banxia_045", "router_path": "...", "description": "...", "has_toxicity": true, "toxicity_warning": "⚠ 本药材具毒性，古籍记载需经炮制并久煎以降低毒性，严禁生用或擅自抓药使用。" }
    ],
    "dietary_and_lifestyle_advice": {
      "fruit_guidance": "当前体征偏湿寒，宜少食西瓜、火龙果、香蕉等寒凉水果；可适当食用苹果、木瓜等温和水果。",
      "habit_guidance": "餐后宜散步 15 分钟，避免立即久坐；注意腹部保暖，忌食生冷黏腻食物。"
    }
  }
}
```

## 6. Skill 5 · ReportFormatter（结构化报告渲染器）
- **定位**：最终数据聚合与视图渲染出口。
- **职责**：多源数据聚合、高情商通俗解读（生活化比喻）、面诊沟通辅助话术（主诉 + 兼症）、纯文本复制载荷。
- **报告 8 模块**（自上而下）：
  1. 通俗译释区 `tcm_explanation_section`
  2. 面诊沟通区 `doctor_communication_brief`（含 [复制此段话术给医生] 按钮）
  3. 古籍经典方剂参考区 `matched_formula_section`
  4. 相关草本知识区 `herb_knowledge_section`（含毒性高亮）
  5. 食疗避忌区 `dietary_guidance_section`（fruit_advice / drink_advice）
  6. 日常作息区 `lifestyle_guidance_section`（habits Checklist）
  7. 纯文本复制载荷 `plain_text_copy_payload`
  8. 底部法律免责声明 `disclaimer`
- **Input**：`{ "synthesized_symptom_text": "...", "confirmed_tags": [...], "knowledge_payload": {...} }`
- **Output**：`{ "report_id": "REP_20260807_001", "created_at": "...", "ui_card_payload": { "card_type": "final_health_report_card", "report_title": "身体信号整理报告", "...": "8 sections...", "disclaimer": "提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。" } }`

## 7. 语料库 / 典籍选型（Skill 引用）
| 层级 | 推荐典籍 / 标准 | 作用 |
|---|---|---|
| 体征标准化 | 《中医临床诊疗术语·证候部分》(GB/T)、《中医诊断学》教材 | Skill 1 & 2：口语 → 标准标签 |
| 问诊逻辑与推导 | 《景岳全书·十问篇》、《中医诊断学·问诊》 | Skill 2：反向推导逻辑链 |
| 归纳与草本映射 | 《中药学》教材、《黄帝内经·素问》脏腑篇 | Skill 3 & 4：体征 → 脏腑倾向与草本 |

## 8. UI 规范（前端渲染约束，详见 style-guide.md）
- 混合渲染：用户气泡靠右（深色背景），Agent 引导语气泡靠左（轻量底色）。
- 选项卡片：高亮按钮组（单选 / 多选），点击后填入对话框并作为下一轮输入发送，卡片切换"已选中"禁用防重复点击。
- 顶部 Stepper：4 阶段（1 安全提醒 ➔ 2 输入描述 ➔ 3 细节追问 ➔ 4 生成报告）。
- 骨架屏：节点 3→4 时显示"正在检索中医典籍与草本知识库..."。
