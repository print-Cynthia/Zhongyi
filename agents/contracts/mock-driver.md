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

### Skill 2 · Clarifier（mock）
- 依据 extractor 的 `missing_dimensions` / `inference_hypothesis`，从**模板池**抽一道追问 + 3~4 选项卡。
- **收敛分模拟**：`convergence_score = min(1, 0.5 + 0.1*round + 0.1*(满足[主诉+脏腑+兼次症]的维度数))`。
- 达 `0.85` 或 `round == 5` → `should_continue = false`。

### Skill 3 · Synthesizer（mock）
- 把 `collected_symptoms` 拼成通顺描述（模板：「主要表现为 X，伴 Y。」），生成确认卡 payload。
- 矛盾以最新轮为准（取 `source` 最大 round）。

### Skill 4 · Retriever（mock）
- 按 `confirmed_tags` / `zangfu` 在 `SYMPTOM_DATA` 静态匹配 1~2 方剂与草本。
- **毒性**：命中 `toxicity_list` → 插入 `toxicity_warning`（静态，无条件）。
- **空匹配** → 通用「健脾理气 / 温和调理方向」兜底。

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
