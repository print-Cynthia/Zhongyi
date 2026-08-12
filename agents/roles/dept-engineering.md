# 部门 · 工程组（Engineering）

> 稳定层。对应 PM：[pm-engineering](pm-engineering.md)。下属 AI 员工：[staff/engineering](../../staff/engineering)。

## 部门职责
- 全部代码实现，含 4 道工序：采集引导 / 辨证映射 / 报告撰写 / 安全守护。
- 把 PRD 5 Skill 落成可运行逻辑（本轮先定边界，下一轮实现）。
- 数据层（SYMPTOM_DATA / HERB_DATA）接口与脱敏。

## 产出物
- 可运行代码（下一轮）。
- 本轮产出：各 AI 员工的边界文件（提示词 / IO schema / 工具 / 自检）。

## 下属 AI 员工
- 前端开发 AI（[frontend](../../staff/engineering/frontend.md)）：页面 / 交互 / 报告渲染。
- 后端数据 AI（[backend](../../staff/engineering/backend.md)）：数据接口 / 存储 / 脱敏 / Retrieval。
- 算法 AI 工程 AI（[algorithm](../../staff/engineering/algorithm.md)）：编排 LLM 完成采集 / 辨证 / 报告 + 急症拦截（对应 Skill 1/2/3/5 + Safety Shield）。
- 测试开发 AI（[qa](../../staff/engineering/qa.md)）：单元 / 回归 / 边界测试。

## 协作接口
- ← 设计组：视觉规范（verbatim 实现）。
- ← 中医组 / 合规组：KnowledgeRetriever 与 Safety Shield 的领域结论。
- → 体验组：交付可测流程 / 文案。
- → 质量组：交付代码供预检。
