# 草本知行 · 身体信号整理 — Multi-Agent 工作台

> 一人公司式 agent 组织编制。跨项目可复用，领域层可插拔。
> 当前承载项目：草本知行（中医）· 身体信号整理模块。

## 这是什么
一套"部门制" multi-agent 工作台：一名主管（Master）统管 6 个部门，每个部门配一名产品经理（PM）把关，部门下挂若干 AI 员工干具体活。

层级（v4 架构，自上而下）：

```
主管 Master
└── 6 个部门（组别）
    ├── 设计组 / 工程组 / 体验组 / 质量组        （稳定层，跨项目复用）
    └── 中医组 / 合规组                          （领域层，换项目整层换掉）
        └── 每部门 1 名 PM
            └── 若干 AI 员工（可换层，迁移时只动这一层）
```

## 稳定层 vs 可换层
- **稳定层（跨项目原样复用）**：`org.md`、`roles/`（主管 + 6 部门 + 6 PM）、`acceptance/`、`contracts/`（3 份接口契约）、`style-guide.md`。
- **可换层（迁移时替换）**：
  - `staff/` —— 每个部门下属的具体 AI 员工（不同项目一线人员不同，只改这里）。
  - `domain/` —— 领域组（中医 → 健身 → 法律，整层换掉）。

## 目录结构
| 路径 | 说明 | 层 |
|---|---|---|
| `README.md` | 本文件 | — |
| `org.md` | 组织架构：主管职责、6 部门边界、PM 定位、验收闭环 | 稳定 |
| `style-guide.md` | Style Bible（现有视觉规范，设计组硬约束） | 稳定 |
| `roles/master.md` | 主管：派活 / 协调 / 验收闭环 / 异常处理 | 稳定 |
| `roles/pm-*.md` | 6 名 PM：把关维度 + 验收清单 + 打回权 | 稳定 |
| `roles/dept-*.md` | 6 个部门：职责 + 产出 + 协作接口 | 稳定 |
| `staff/*.md` | 19 名 AI 员工：角色 / 提示词 / IO / 工具 / 自检 / 对应 PRD Skill（平铺命名 `部门-职责.md`） | 可换 |
| `domain/tcm-prd-skills.md` | PRD 5 Skill 边界细化（本项目） | 领域 |
| `domain/compliance-rules.md` | 免责声明 + 红线词 + 脱敏规则 | 领域 |
| `acceptance/auto-checklist.md` | 质量组自动预检项 | 稳定 |
| `acceptance/human-review.md` | 用户人工终审签字项 | 稳定 |
| `contracts/skill-interface.md` | 契约1：5 Skill + Safety Shield + Session 统一接口（可插拔接缝） | 稳定 |
| `contracts/state-machine.md` | 契约2：4 阶段/7 态状态机、收敛分路由、红线切断、降级 | 稳定 |
| `contracts/mock-driver.md` | 契约3：LocalMockDriver 行为规范（零成本跑通全链路） | 稳定 |

## 契约层（解耦接缝，稳定层）
`contracts/` 是「业务逻辑 / 驱动解耦」的核心：3 份契约定义了 5-Skill 流水线、状态机、本地 Mock 驱动的**接口与规范（接缝）**。业务代码只依赖这些契约，未来从 `LocalMockDriver` 切到 `CloudAPIDriver` 时**前端与业务零改动**。阶段 2 起的代码替换以 `contracts/` 为唯一权威，质量组据其写自动预检。

## 角色索引
- 主管：[roles/master.md](roles/master.md)
- 设计组：PM [pm-design](roles/pm-design.md) · 部门 [dept-design](roles/dept-design.md) · 员工 [design-ui](staff/design-ui.md) / [design-component](staff/design-component.md) / [design-prototype](staff/design-prototype.md)
- 工程组：PM [pm-engineering](roles/pm-engineering.md) · 部门 [dept-engineering](roles/dept-engineering.md) · 员工 [eng-frontend](staff/eng-frontend.md) / [eng-backend](staff/eng-backend.md) / [eng-algorithm](staff/eng-algorithm.md) / [eng-test](staff/eng-test.md)
- 体验组：PM [pm-experience](roles/pm-experience.md) · 部门 [dept-experience](roles/dept-experience.md) · 员工 [exp-usability](staff/exp-usability.md) / [exp-copy](staff/exp-copy.md) / [exp-flow](staff/exp-flow.md)
- 质量组：PM [pm-quality](roles/pm-quality.md) · 部门 [dept-quality](roles/dept-quality.md) · 员工 [qa-auto](staff/qa-auto.md) / [qa-regression](staff/qa-regression.md) / [qa-boundary](staff/qa-boundary.md)
- 中医组（领域）：PM [pm-tcm](roles/pm-tcm.md) · 部门 [dept-tcm](roles/dept-tcm.md) · 员工 [tcm-syndrome](staff/tcm-syndrome.md) / [tcm-herb](staff/tcm-herb.md) / [tcm-literature](staff/tcm-literature.md)
- 合规组（领域）：PM [pm-compliance](roles/pm-compliance.md) · 部门 [dept-compliance](roles/dept-compliance.md) · 员工 [comp-disclaimer](staff/comp-disclaimer.md) / [comp-boundary](staff/comp-boundary.md) / [comp-privacy](staff/comp-privacy.md)

## 迁移到新项目（三步）
1. **拷**：把整个 `agents/` 文件夹复制到新项目。
2. **改 `staff/`**：用新项目的具体提示词 / 工具 / 输出格式重写 19 个 AI 员工文件（一线人员不同，只动这层）。
3. **换 `domain/`**：把 `domain/tcm-prd-skills.md` 与 `domain/compliance-rules.md` 换成新领域（如 `fitness-skills.md` / `legal-rules.md`）；稳定层（`org.md` / `roles/` / `acceptance/` / `style-guide.md`）原样带走。

> 网站代码（index.html / script.js / style.css / data.js）**不在本工作台内**，按新项目重写——它不属于可复用资产。

## 你怎么参与（审批闸）
1. 主管 + 各 PM 据 PRD 起草各 AI 员工边界文件 → 写入 `agents/`。
2. 质量组自动预检（对照 `acceptance/auto-checklist.md`）。
3. **你人工终审**（`acceptance/human-review.md`）：批注 / 打回 / 放行。
4. 放行后进入下一轮：模块代码实现。

你是**终审法官**，agent 是起草办事员——边界由团队起草、你在闸上审。

## 设计铁律（详见 style-guide.md）
现有视觉风格 **verbatim 沿用**，设计组 / 前端员工不得引入新色、新字体，不得改动药柜透视参数与版本号徽标机制。
