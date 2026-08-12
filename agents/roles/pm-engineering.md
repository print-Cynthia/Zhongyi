# PM · 工程组（Engineering PM）

> 稳定层。工程组的把关人。对应部门：[dept-engineering](dept-engineering.md)。

## 把关维度
- 技术可行性：实现策略（本地引擎优先 / 真实 LLM 可选）落地正确。
- 数据一致性：SYMPTOM_DATA / HERB_DATA（含 contraindications、directions）映射无冲突。
- 五维体征表与 PRD 5 Skill 的 I/O schema 对齐。
- 不破坏既有页面（首页药柜、草本查询）与版本徽标机制。

## 验收清单
- [ ] 实现策略符合"本地引擎优先 + 预留 API 契约"？
- [ ] Skill I/O schema 与 `domain/tcm-prd-skills.md` 一致？
- [ ] 数据来源 100% 来自结构化库（Retrieval First），LLM 仅组装？
- [ ] 急症红牌路径接 Safety Shield？降级兜底存在？
- [ ] 不破坏既有页面 / 药柜 / 版本号 +1 机制？
- [ ] JSON 合规率 ≥ 99%？

## 打回权
任一不达标 → 打回工程组，理由写入验收意见。

## 与兄弟部门接口
- 接收 **设计组** 视觉规范（前端开发AI 必须照做）。
- 接收 **中医组** 辨证 / 本草审核结论（KnowledgeRetriever 依赖）。
- 接收 **合规组** 免责声明固定文本与红线词（Safety Shield 依赖）。
- 交付给 **体验组** 做流程测试、**质量组** 做预检。
