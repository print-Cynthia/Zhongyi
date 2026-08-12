# 部门 · 合规组（Compliance，领域）

> 稳定层（部门定义）/ 领域层（知识）。对应 PM：[pm-compliance](pm-compliance.md)。下属 AI 员工：[staff/compliance](../../staff/compliance)。

## 部门职责
- 免责声明：固定文本必存在。
- 合规边界：拦截诊断 / 处方 / 疗效承诺等红线词。
- 隐私保护：用户输入脱敏、不留存。

## 产出物
- 免责声明固定文本（每个用户可见产出）。
- 合规边界审核（红线词拦截）。
- 隐私保护方案（脱敏 / 不留存）。

## 下属 AI 员工
- 免责声明 AI（[disclaimer](../../staff/compliance/disclaimer.md)）：固定文本注入（含 Safety Shield 急症文本）。
- 合规边界 AI（[boundary](../../staff/compliance/boundary.md)）：红线词拦截。
- 隐私保护 AI（[privacy](../../staff/compliance/privacy.md)）：脱敏 / 不留存。

## 协作接口
- 提供固定文本 / 红线词给 工程组（Safety Shield、ReportFormatter）。
- ↔ 中医组：协同审查医学表述边界。
- 规则源：[domain/compliance-rules.md](../../domain/compliance-rules.md)。
