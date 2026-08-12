# 契约 3 · LocalMockDriver 行为规范（Mock Driver Spec）

> **契约层（稳定层，跨项目复用）。** 定义驱动层的**本地模拟实现**，使 5-Skill 全链路在**零 API 成本、零外部依赖**下跑通并可演示。它是 `SkillDriver` 接口的第一个实现；未来 `CloudAPIDriver` 直接替换，**业务代码不变**。
> 依据：`skill-interface.md`（接口）+ `domain/tcm-prd-skills.md`（Skill 逻辑）+ `data.js` 的 `SYMPTOM_DATA`。

---

## 0. 定位与边界

- 实现 `SkillDriver.invoke(skillId, ctx, input): SkillResult`。
- **不调用任何外部 LLM / 网络**；纯本地规则 + 静态数据（`data.js` 的 `SYMPTOM_DATA` + 五维体征表）。
- 目标指标：**0.01s 响应、100% 稳健、输出强 JSON Schema 合规**（满足 `skill-interface.md` 各 Skill 的 required 字段）。

---

## 1. 各 Skill 的 Mock 实现逻辑

### Safety Shield（mock）
- 对 `user_raw_input` 做红牌词 `includes` 扫描（词表来自 `ctx.red_list`）。
- 命中 → `blocked = true` + 固定合规卡（文本见 `compliance-rules.md` §2）；否则 `blocked = false`。

### Skill 1 · Extractor（mock）
- 关键词映射：预置「口语 → 标准标签」字典，覆盖五维（部位 / 寒热 / 饮食 / 二便 / 睡眠）。
- 例：`肚子涨 / 腹胀` → 食后腹胀(消化, 0.9)；`口苦` → 口苦(寒热, 0.85)；`睡不着` → 入睡困难(睡眠, 0.9)。
- `missing_dimensions` = 五维中未命中者；`overall_completeness` 按命中维度数映射 low / medium / high。

### Skill 2 · Clarifier（mock · 五维通用）
- 通用五维字典 `DIMENSION_DICT = [部位 | 性质寒热 | 饮食 | 二便 | 睡眠]`；extractor 标记 `covered_dimensions` / `missing_dimensions`。
- 仅对**缺失维度**动态拼装追问卡片（已覆盖维度绝不重复追问），每个卡片**强制追加** `[以上均无 / 无上述情况]` 兜底选项，绝不强迫硬选。
- **收敛分公式**：`Score = 0.3 + 0.15 * 已覆盖维度数 + 0.1 * Round`；**硬下限 `MIN_ROUNDS = 2`**：`Round < 2` 必继续，否则 `Score ≥ 0.85 且 Round < 5` 才收敛 → 强制 2~3 轮维度补全，杜绝「1 轮假收敛」。

### Skill 3 · Synthesizer（mock · 结构化）
- 输出结构化 JSON（非逗号拼接）：`primary_symptom`（核心表现）、`associated_symptoms[]`（兼带细节）、`confirmed_negative[]`（已排除 / 无异常），并附 `synthesized_symptom_text` 可读串，供前端渲染结构化确认卡。

### Skill 4 · Retriever（mock · 组成药材强联动）
- 静态 RAG 库 `herbs_rag_db.json`（与 `FORMULA_MAP.composition` 保持一致）：每个古籍方剂含必填 `composition: string[]`（组成药材名）。
- 按 `zangfu_tendency`（综合自由描述命中关键词 + 维度选项推断）匹配方剂，返回 `matched_formula.composition`（组成药材名）与 `matched_herbs`（药材名解析为 `herb_id`，与组成药材 **ID 级强联动**映射）。
- **毒性**：命中 `toxicity_list`（如半夏 / banxia）→ 插入 `toxicity_warning`（静态，无条件）。
- **空匹配** → 通用「健脾理气 / 温和调理方向」兜底（`composition` 为空数组）。

### Skill 5 · Formatter（mock）
- 聚合上面所有 payload → 8 模块报告 JSON；`disclaimer` 固定文本从 `compliance-rules.md` §1 注入。
- 通俗解读用模板填充，**不自由生成**。

---

## 2. 输出合规要求

- 所有 output **必须符合** `skill-interface.md` 各 Skill 的 JSON Schema（required 字段齐全）。
- 前端不感知驱动类型，仅消费 Schema —— 这是「可插拔」成立的前提。

---

## 3. 降级默认（mock 视角的兜底）

- 任意 mock 子逻辑异常 → 返回对应 Skill 的静态默认（如 retriever 空 → 通用方向），`fallback_used = true`，**不抛错**。
- 与状态机 §5 的 FALLBACK 策略一致，永不阻断主流程。

---

## 4. 切换 CloudAPIDriver（未来，阶段 5）

- **配置开关**：`window.__AGENT_DRIVER__ = 'mock' | 'cloud'`（或构建期常量）。
- `getDriver()` 按配置返回实现；`CloudAPIDriver` 实现同一 `invoke` 接口，内部走**极小后端代理**（密钥不下发前端，避免暴露）。
- **前端与业务代码一行不改**：仅切换配置 + 提供 `CloudAPIDriver` 实现即可上线真实 LLM。

---

## 5. 测试契约（供质量组 · 自动预检）

| 用例 | 期望 |
|---|---|
| 输入含红牌词 | `blocked = true`，渲染合规红卡，不进 S2–S5 |
| 空 / 模糊输入 | `overall_completeness = low` → Path B 全局补漏 |
| 连续 5 轮 | 第 5 轮强制进 S3（无论 score） |
| 命中毒性药材 | `has_toxicity = true` 且 `toxicity_warning` 存在 |
| 断网 / 无后端 | 仍产出报告（mock 不依赖网络） |
| 任意 Skill 异常 | 走 FALLBACK，主流程不中断，报告末尾有 disclaimer |

---

> 本规范由**架构师（主管）**定义，**工程组·后端数据 AI / 算法 AI** 负责实现 `LocalMockDriver`；**质量组**据 §5 写自动预检用例；**合规组**校验 disclaimer / 红线是否落到产出。
