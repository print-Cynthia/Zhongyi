# 验收 · 自动预检清单（质量组）

> 稳定层。质量组自动预检对照项。对应质量 PM：[pm-quality](../../roles/pm-quality.md)。
> 达标线取自 PRD（见 [domain/tcm-prd-skills.md](../../domain/tcm-prd-skills.md)、[domain/compliance-rules.md](../../domain/compliance-rules.md)）。

## A. 格式与健壮性（JSON 合规率 ≥ 99%）
- [ ] 所有 Skill 输出符合各自 JSON Schema，不解析报错？
- [ ] JSON 解析报错时自动降级规则引擎（提取静态标签拼装），页面不崩溃（可用性 99.9%）？
- [ ] API 超时（>8.0s）重试最多 1 次 + 轻量提示"网络开小差了，正在为您重新整理..."？
- [ ] RAG 未命中 → 不显示古籍方剂板块，展示通用"脾胃调理 / 温和养生"方向，无幻觉伪造？

## B. 风格一致性（对照 style-guide.md）
- [ ] 颜色 100% 取自 :root 11 变量 + 药柜木色，无新 hex？
- [ ] 字体栈未改（Inter / PingFang SC / Microsoft YaHei / sans-serif）？
- [ ] 药柜透视参数未动（rotateY(-14deg) rotateX(1.5deg) / perspective 1200 / origin 30% 50% / 侧板 clip-path）？
- [ ] 版本徽标机制未破坏（fixed 右下、改动 +1）？
- [ ] 响应式断点（1280 / 1101 / 1100 / 1024 / 900 / 768 / 480）全通过？

## C. 合规与安全（红线级）
- [ ] 固定免责声明存在于每个用户可见产出（报告底栏 + 纯文本末尾）？
- [ ] 急症红牌 5 类关键词命中即硬切断，输出固定合规文本？
- [ ] 无诊断 / 处方 / 疗效承诺类红线词？
- [ ] 毒性药材强预警（has_toxicity=true → 高亮毒性 / 煎服提示）？

## D. 流程与指标（PRD 目标）
- [ ] 4 步 Stepper 完整（安全提醒 → 输入 → 追问 → 报告），节点高亮与 Skill 映射正确？
- [ ] 收敛分 ≥ 0.85 自动熔断、Max Rounds=5 硬性上限已实现？
- [ ] 冷启动（有效标签 < 2）→ Path B 全局维度补漏？
- [ ] 用户气泡靠右 / Agent 气泡靠左 / 选项卡片高亮按钮组（已选中禁用）？
- [ ] sessionStorage 持久化进度，返回提示"已为您恢复上次整理进度"？
- [ ] 流程完成率 ≥ 85% / 召回率 ≥ 90% / 追问有效率 ≥ 85% / 数据完整度 ≥ 90%？（可度量）

## E. 领域准确性（中医组背书）
- [ ] 方剂 / 古籍出处 100% 来自结构化库（Retrieval First）？
- [ ] 推荐草本绑定 herb_detail_id + router_path（联动草本查询页）？
- [ ] 食疗寒热属性具象化（如西瓜 / 火龙果寒凉）？
