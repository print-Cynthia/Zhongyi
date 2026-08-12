# 部门 · 中医组（TCM，领域）

> 稳定层（部门定义）/ 领域层（知识）。对应 PM：[pm-tcm](pm-tcm.md)。下属 AI 员工：[staff/tcm](../../staff/tcm)。

## 部门职责
- 中医知识审核：辨证映射、本草关联、古籍依据。
- 为工程组 KnowledgeRetriever 提供医学准确性背书。

## 产出物
- 辨证审核意见（信号 → 证型是否合理）。
- 本草关联审核（药材 / 方剂禁忌）。
- 古籍依据（出处标注）。

## 下属 AI 员工
- 辨证审核 AI（[dialectics](../../staff/tcm/dialectics.md)）：证型映射医学准确性。
- 本草关联 AI（[herb](../../staff/tcm/herb.md)）：药材 / 方剂推荐合理性 + 禁忌。
- 文献依据 AI（[literature](../../staff/tcm/literature.md)）：古籍出处（内经 / 伤寒论 等）。

## 协作接口
- 审核 工程组·KnowledgeRetriever 检索结论。
- ↔ 合规组：医学表述不得越界诊断 / 处方。
- 知识源：[domain/tcm-prd-skills.md](../../domain/tcm-prd-skills.md)。
