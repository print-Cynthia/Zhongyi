# 契约 2 · 状态机规格（State Machine Spec）

> **契约层（稳定层，跨项目复用）。** 定义身体信号整理「4 步流程」的实际内部 7 态状态机：状态枚举、转移条件、收敛分路由、红线切断与降级兜底。前端 Stepper 显示 4 阶段，内部状态机更细。
> 依据：PRD 4 步流程 + 收敛分 ≥0.85 / Max Rounds=5（`domain/tcm-prd-skills.md`）+ 急症红牌（`compliance-rules.md` §2）。

---

## 0. 顶层 4 阶段（用户可见 Stepper）

```
1. 安全提醒  ➔  2. 输入描述  ➔  3. 细节追问  ➔  4. 生成报告
```

---

## 1. 内部状态枚举

```
S0  ENTRY_SAFETY    // 入场安全提醒卡片（静态，用户点击「我已知晓」后离开）
S1  INPUT_DESC      // 等待 / 接收用户自由描述
S2  CLARIFY_LOOP    // 动态追问循环（子轮次 round = 1..5）
S3  SYNTHESIZE      // 收敛确认卡片（Skill 3）
S4  RETRIEVE        // RAG 检索（骨架屏 loading，Skill 4）
S5  REPORT          // 报告渲染（Skill 5）
S6  SESSION_RESET   // 会话重置（PII 清空，提供「重新整理」入口）
XX  SAFETY_CUTOFF   // 红线切断（任意态可跳入，优先级最高）
ERR FALLBACK        // 降级（任意 Skill 失败兜底，不阻断主流程）
```

---

## 2. 转移表

| From | Event / Condition | To | 动作 |
|---|---|---|---|
| S0 | 用户点击「我已知晓」 | S1 | 渲染输入区 |
| S1 | 提交描述 | → Safety Shield | **先调 Safety Shield**（非直接 S2） |
| Safety Shield | `blocked = false` | S2 (round=1) | 调 extractor → clarifier |
| Safety Shield | `blocked = true` | SAFETY_CUTOFF | 渲染合规红卡，跳过 S2–S5 → END |
| S2 | `should_continue && round < 5 && score < 0.85` | S2 (round+1) | 渲染下一追问卡片 |
| S2 | `score ≥ 0.85` 或 `round == 5` | S3 | 调 synthesizer |
| S2 (low completeness) | 初始有效标签 < 2 | S2 Path B | 全局维度补漏追问（《十问歌》逻辑） |
| S3 | 用户「确认无误」 | S4 | 调 retriever（骨架屏） |
| S3 | 用户「补充 / 修改」 | S1 / S2 | 回退补采（回显上一轮文字） |
| S2 | 用户「← 返回修改描述」 | S1 | 退回输入态，回显上一轮描述文字，允许增删修改 |
| S4 | retrieval 完成 | S5 | 调 formatter |
| S5 | 报告渲染完成 | S6 | `Session.reset` |
| S6 | 重置完成 | END | 提供「重新整理」入口 |
| 任意态 | 某 Skill `ok = false` | FALLBACK | 降级：用静态默认，继续或跳过该增强 |
| FALLBACK | 恢复 | 原 To | 续跑（见 §5） |

---

## 3. 收敛分路由（关键）

- 每轮 `clarifier` 返回 `convergence_score = 0.3 + 0.15 * 已覆盖维度数 + 0.1 * Round`。
- **双轨多组追问**：S2 内部按「轨 1 主诉深度细化 → 轨 2《十问篇》基础盘查」轮转，`buildClarifyQueue` 依据类目与未覆盖维度动态生成队列（长度 ∈ [MIN_ROUNDS, MAX_ROUNDS]），选项均为多选且每组强制兜底。
- **收敛硬下限**：`MIN_ROUNDS = 2` —— `Round < 2` 必继续追问；`Round ≥ 2 且 Score ≥ 0.85` 才熔断进 S3。
- **硬性止损**：`Round == 5` → 强制进 S3（无论分高低），避免无限追问。
- 效果：初始完备度被硬下限压住，系统必然进行 2~3 轮维度补全，杜绝「1 轮假收敛」。
- **体验指标**：追问完成率 ≥ 85%（目标，体验组 / 质量组监测）。

---

## 4. 红线切断（SAFETY_CUTOFF，优先级最高）

- **触发**：Safety Shield 命中红牌词（胸痛剧烈 / 吐血 / 呼吸困难 / 剧烈头痛伴呕吐 / 昏迷）。
- **行为**：立即终止调度，**不进入** extractor ~ formatter，直接渲染红色警告卡片（固定文本见 `compliance-rules.md` §2）→ END。
- **交互（阶段 2 整改）**：主按钮为 `[ 我知道了 ]`（主样式），点击清空危险输入并安全重置回第一步；`[ 重新整理 ]` 仅作次级 / 幽灵入口，**严禁**作为急症场景唯一或主操作。
- 不受收敛分 / 轮次约束，优先级高于一切转移。

---

## 5. 降级兜底（FALLBACK，不阻断主流程）

任一 Skill `ok = false` → 捕获，标记 `fallback_used = true`，按策略继续：

| 失败 Skill | 降级策略 |
|---|---|
| extractor | 用原始文本直送 clarifier |
| clarifier | 用静态通用追问卡片续跑 |
| retriever | 输出「健脾理气 / 温和调理方向」通用方向 |
| formatter | 输出最小报告（仅确认卡 + disclaimer） |

- 永不阻断主流程，永不生成诊断 / 处方。

---

## 6. Session 重置（S6）

- 进入 S6：`Session.reset(session_id)` 清空 `sessionStorage` 中用户输入 / 中间态。
- 保留「重新整理」入口（回到 S0）。
- 红线：不留存 PII（见 `compliance-rules.md` §4）。

---

## 7. 与前端绑定（前端 / 设计组依据）

- **Stepper 阶段映射**：S0→阶段1，S1→阶段2，S2/S3→阶段3，S4/S5→阶段4。
- **骨架屏触发**：S4（「正在检索中医典籍与草本知识库…」）。
- **气泡方向**：用户输入靠右（深色背景），Agent 引导靠左（轻量底色）。
- **卡片交互**：选项卡片点击后填入对话框并作为下一轮输入；切换「已选中」禁用防重复点击。
- 全部视觉细节以 `style-guide.md` 为唯一权威，**不得新增色 / 字体 / 改动药柜参数**。

---

> 本规格由**架构师（主管）**定义；**工程组·前端 AI** 据 §7 渲染、**算法 AI** 据 §2–§5 编排、**质量组**据 `acceptance/auto-checklist.md` 验证转移与降级是否到位。
