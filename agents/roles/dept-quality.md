# 部门 · 质量组（Quality）

> 稳定层。对应 PM：[pm-quality](pm-quality.md)。下属 AI 员工：[staff/quality](../../staff/quality)。

## 部门职责
- 自动预检：对照 [acceptance/auto-checklist.md](../../acceptance/auto-checklist.md) 自动打分、标红。
- 回归测试：防改动引入旧 bug。
- 边界异常：极端输入 / 急症 / JSON 失败 / 库缺数据。

## 产出物
- 自动预检报告（JSON 合规率、风格一致性、免责命中、红牌命中、版本号）。
- 回归测试报告。
- 边界异常报告。

## 下属 AI 员工
- 自动预检 AI（[autocheck](../../staff/quality/autocheck.md)）：对照清单自动打分。
- 回归测试 AI（[regression](../../staff/quality/regression.md)）：回归用例。
- 边界异常 AI（[boundary](../../staff/quality/boundary.md)）：极端 / 急症 / 异常路径。

## 协作接口
- 对所有部门产出跑预检（一票否）。
- 预检报告 → 用户人工终审。
- 依赖 合规组 红线词清单。
