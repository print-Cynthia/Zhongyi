# 契约 1 · Skill 接口契约（Skill Interface Contract）

> **契约层（稳定层，跨项目复用）。** 本文件定义 5-Skill 流水线、Safety Shield、Session 管理器共用的**统一接口契约（接缝）**。所有驱动（`LocalMockDriver` / `CloudAPIDriver`）必须实现本契约；前端与业务代码只依赖本契约，不感知背后是谁在执行。
> 依据：PRD 5 Skill（`domain/tcm-prd-skills.md`）+ 合规规则（`domain/compliance-rules.md`）。

---

## 0. 设计原则：业务逻辑 / 驱动解耦（Decoupling）

- 所有"需要智能推理"的动作都抽象为 `Skill.invoke(ctx, input) -> SkillResult`。
- 业务编排（状态机、红线、检索、报告拼装）写死在代码中，只调 `Skill.invoke`，**不直接调 LLM**。
- 替换驱动 = 改一个配置 `DRIVER = 'mock' | 'cloud'`，实现 swap，**前端与业务代码零改动**。
- 这是"可插拔本地引擎方案"的接缝核心：现在 `LocalMockDriver` 顶上，未来 `CloudAPIDriver` 无缝替换。

---

## 1. 通用类型（TypeScript 风格，供前端/后端对齐）

```ts
type SkillId =
  | 'safety_shield'
  | 'extractor'      // Skill 1
  | 'clarifier'      // Skill 2
  | 'synthesizer'    // Skill 3
  | 'retriever'      // Skill 4
  | 'formatter';     // Skill 5

interface SkillContext {
  session_id: string;
  round: number;            // 当前追问轮次（0 起）
  max_rounds: 5;            // 硬上限（PRD）
  driver: 'mock' | 'cloud';
  knowledge_base: TcmKB;    // 静态 RAG 库引用（Retrieval First）
  red_list: string[];       // 急症红牌词（来自 compliance-rules.md §2）
  forbidden_words: string[];// 红线词（来自 compliance-rules.md §3）
}

interface SkillResult {
  ok: boolean;
  data: object;             // 符合下方各 Skill 的 JSON Schema
  fallback_used: boolean;   // 是否触发降级
  meta: { latency_ms: number; model?: string };
}
```

---

## 2. 统一失败降级语义（所有 Skill 通用）

- `ok = false` 时，**不允许抛出中断流程**：业务层必须捕获并走降级。
- 降级优先级：① 尝试同 Skill 静态默认；② 仍失败则跳过该 Skill 的增强信息，继续后续流程；③ 报告末尾强制追加 disclaimer。
- 红线：降级永远不得生成诊断 / 处方；缺失数据用「建议咨询专业医师」兜底。

---

## 3. Safety Shield（前置硬拦截，先于一切 Skill）

- **执行点**：每次用户输入进入管线时**最先**调用（状态机 S1→S2 的守门）。
- **Input**：`{ "user_raw_input": "..." }`
- **Output Schema**（二选一）：
```json
// 未命中
{ "blocked": false, "matched_red_flags": [] }

// 命中红牌（固定合规文本，见 compliance-rules.md §2）
{ "blocked": true, "matched_red_flags": ["胸痛剧烈"],
  "compliance_card": "⚠ 安全提示：检测到您描述的症状可能属于急性或重症健康风险。本系统仅作轻量级健康整理，无法提供急救或临床诊断。请立即拨打急救电话或前往最近的医院急诊科就医！" }
```
- 命中即 `blocked = true` → 状态机直接路由到 `SAFETY_CUTOFF`，**不进入 extractor ~ formatter**。

---

## 4. Skill 1 · SymptomExtractor（NLU 提取）

- **Input**：`{ "user_raw_input": "...", "historical_symptoms": [] }`
- **Output Schema（required: extracted_symptoms, missing_dimensions, overall_completeness）**：
```json
{
  "extracted_symptoms": [
    { "raw_phrase": "吃完饭肚子涨", "standard_tag": "食后腹胀", "category": "消化", "confidence": 0.95 }
  ],
  "missing_dimensions": ["二便特征", "舌苔/口干"],
  "overall_completeness": "low | medium | high"
}
```
- **冷启动兜底**：有效标签 < 2（如仅「累」「不舒服」）→ `overall_completeness = low` → 状态机强制走 **Path B 全局维度补漏**。

---

## 5. Skill 2 · DynamicClarifier（动态追问）

- **Input**：`{ "extracted_symptoms": [...], "current_round": 1 }`
- **Output Schema（required: should_continue, question_text, option_cards, convergence_score）**：
```json
{
  "should_continue": true,
  "inference_hypothesis": "脾虚湿阻倾向",
  "question_text": "为确认脾胃运化情况，请问您平时大便和口中感受如何？",
  "option_cards": [
    { "label": "大便偏溏 / 易沾马桶", "tag": "便溏" },
    { "label": "口干但不想喝水", "tag": "口干不欲饮" },
    { "label": "口中黏腻 / 淡而无味", "tag": "口黏" },
    { "label": "以上皆无 / 情况正常", "tag": "正常" }
  ],
  "convergence_score": 0.62
}
```
- **收敛分语义**：满足【主诉 + 脏腑倾向 + ≥1 兼次症】→ `score ≥ 0.85` → 状态机熔断追问，进 Skill 3。
- **硬性上限**：`Max Rounds = 5`，达 5 轮无论分高低强行进 Skill 3。

---

## 6. Skill 3 · SymptomSynthesizer（收敛确认）

- **Input**：`{ "all_collected_symptoms": [{ "raw_phrase": "...", "standard_tag": "...", "source": "skill1 | skill2_roundN" }] }`
- **Output Schema（required: summary_status, ui_card_payload）**：
```json
{
  "summary_status": "ready_for_confirmation",
  "ui_card_payload": {
    "card_type": "symptom_summary_confirmation_card",
    "card_title": "您的身体信号已整理完毕",
    "synthesized_symptom_text": "主要表现为上腹部隐痛（进食后明显），伴大便偏溏易沾马桶。",
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
- **矛盾剔除**：多轮矛盾以最新澄清回答（`source` 最大 round）为准。

---

## 7. Skill 4 · KnowledgeRetriever（RAG 校验）

- **Input**：`{ "zangfu_tendency": "...", "confirmed_tags": [...] }`
- **Output Schema（required: retrieval_status, knowledge_payload）**：
```json
{
  "retrieval_status": "success",
  "knowledge_payload": {
    "matched_formula": {
      "formula_name": "参苓白术散（参考）",
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
- **Retrieval First 硬约束**：方剂 / 出处 / 毒性 100% 来自 `knowledge_base`，不得自由生成。
- **毒性强预警**：命中毒性药材名录 → 无条件插入 `toxicity_warning`，不依赖模型推断。
- **空数据兜底**：无法精准匹配 → 输出「健脾理气 / 温和调理方向」，不强制推荐不适宜方剂。

---

## 8. Skill 5 · ReportFormatter（报告渲染）

- **Input**：`{ "synthesized_symptom_text": "...", "confirmed_tags": [...], "knowledge_payload": {...} }`
- **Output Schema（required: report_id, created_at, ui_card_payload）**：
```json
{
  "report_id": "REP_20260812_001",
  "created_at": "2026-08-12T10:00:00+08:00",
  "ui_card_payload": {
    "card_type": "final_health_report_card",
    "report_title": "身体信号整理报告",
    "sections": { /* 8 模块，键名见下 */ },
    "disclaimer": "提示：本报告仅用于身体表现整理和中医知识学习，不构成医疗诊断或处方建议。"
  }
}
```
- **报告 8 模块（自上而下，键名固定，前端按 key 渲染）**：
  1. `tcm_explanation_section` 通俗译释区
  2. `doctor_communication_brief` 面诊沟通区（含「复制此段话术给医生」按钮）
  3. `matched_formula_section` 古籍经典方剂参考区
  4. `herb_knowledge_section` 相关草本知识区（含毒性高亮）
  5. `dietary_guidance_section` 食疗避忌区
  6. `lifestyle_guidance_section` 日常作息区（habits Checklist）
  7. `plain_text_copy_payload` 纯文本复制载荷（末尾追免责）
  8. `disclaimer` 固定免责声明

---

## 9. Session 内存重置管理器（接口）

- `Session.reset(session_id)`：报告生成后 / 用户主动退出后，清空本次会话的用户输入与中间态（PII 不留存）。
- 前端用 `sessionStorage` 仅持久化轮次状态与已确认标签（恢复进度用），不写服务端。
- 红线：报告不回显姓名 / 电话 / 地址等 PII（见 `compliance-rules.md` §4）。

---

## 10. 可插拔接缝（Mock ↔ Cloud）

- 实现 `SkillDriver` 接口：`invoke(skillId, ctx, input): SkillResult`。
- `LocalMockDriver`：见 `mock-driver.md`；`CloudAPIDriver`：未来实现（配置 API Key + 极小后端代理，密钥不下发前端）。
- 业务代码只写：`const driver = getDriver(config.driver); driver.invoke(...)`。**切换不改业务。**

---

> 本契约由**架构师（主管）**定义，**质量组**据 `acceptance/auto-checklist.md` 校验所有驱动输出是否满足上述 Schema；**合规组**校验红线词 / 免责是否落到产出。
