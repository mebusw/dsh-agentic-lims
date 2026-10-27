# dsh-agentic-lims

一个跑在 **DeepSeek Harness（DSH）右侧边栏**里的 Agentic LIMS 可行性 demo。

- **形态**：DSH 插件（Host + Client 两半），不是独立网站。
- **界面**：DSH 右侧边栏 tab，顶部一级菜单（概览 / 项目 / 任务 / 排程 / 影响 / 资源 / 分析 / 审计）+ 角色视图（实验人员 / TM-TL / 运营），内置方案对比、甘特图、约束校验、负荷报表。
- **对话**：DSH 原生聊天框；Agent 通过 `lims_*` 工具读取数据、运行确定性排程引擎，并驱动右侧工作区切页。
- **数据**：MongoDB（`127.0.0.1:27018/agentic_lims`），模拟数据包 CSV 原样导入 `raw_*` 集合。
- **规则**：硬约束由代码校验（设备能力、资质、校准、冲突、工作时段、前处理空间），模型只做理解与解释。

## 先看这里

| 文档 | 内容 |
|---|---|
| [插件 README](agentic-lims/README.md) | 安装、演示脚本、数据与引擎假设、目录说明 |
| [产品设计方案](</Users/jacky/Library/CloudStorage/坚果云-jackyshen@uperform.cn/优普丰大文件(默认不同步到本地)/03 咨询服务/0214 施耐德中高压电气/202610 实验室排程萃取/00 售前和前期沟通/AI-Native-智能实验室预约与排程系统-设计方案.md>) | 原始产品策略与交互架构 |
| [模拟数据说明](</Users/jacky/Library/CloudStorage/坚果云-jackyshen@uperform.cn/优普丰大文件(默认不同步到本地)/03 咨询服务/0214 施耐德中高压电气/202610 实验室排程萃取/00 售前和前期沟通/LIMS排程原型-模拟数据包/README.md>) | 领域模型、A–F 场景、硬/软约束 |

## 快速开始

```bash
# 1. 启动本地 MongoDB（数据目录在 workspace 内）
./agentic-lims/scripts/start-mongo.sh

# 2. 安装插件（在 DSH 中执行）
#    plugin_manager install_bundle { "target": "/Users/jacky/work/dsh-agentic-lims/agentic-lims" }

# 3. 刷新 DSH Web 页面，右侧边栏会打开「智能实验室」
```

如果右侧边栏没出现，点击聊天标题栏右侧的烧瓶图标；或在右侧边栏的 “+” 指南里选择「智能实验室」。

## 30 秒演示脚本

在 DSH 聊天框输入：

> 帮我安排 TASK-2005，优先保证交付日期，给我两个备选方案，说明风险和资源安排。

预期：

1. Agent 调用 `lims_get_task` / `lims_generate_plans`；
2. 右侧边栏自动切到「排程」；
3. 出现 2 个候选方案（最快完成 / 负载均衡）、甘特图、HC-001…HC-006 约束校验、评分拆解；
4. 点「确认并提交（模拟）」写入原型 MongoDB，产生审计事件；
5. 再输入：
   > 为什么 TASK-2003 不能用 EQ-004？有哪些替代设备？
   
   Agent 调用 `lims_explain_resource`，右侧切到「资源」并展开不可用原因与替代设备。
6. 设备停机：
   > EQ-007 明天全天维护，帮我分析受影响的预约并给出重排方案。

   Agent 调用 `lims_analyze_downtime`，登记停机事件、分析受影响任务、给出前后对比，右侧切到「影响」页。
7. 修改约束重排：
   > 重新安排 TASK-2005，从 10/29 开始，周五下午不要排实验，优先用 EQ-005。

   Agent 调用 `lims_revise_plan`，右侧显示变更前后对比；旧方案标记为「已替代」。
8. 项目与 Test Plan：
   > 把 PRJ-1001 的 Tensile Strength Test 任务排成一个测试计划。

   Agent 调用 `lims_generate_test_plan`，右侧切到「项目」页，展示项目 → 模板分组 → 多个任务 → 合并时间轴。
9. 简单数字问题：
   > 周三 EQ-007 有多少个预约？

   Agent 调用 `lims_equipment_bookings`，聊天窗口直接渲染预约卡片。

## 工程结构

```
agentic-lims/
├─ index.js              Host 入口：Mongo 连接、路由、工具、系统提示
├─ client.js             右侧边栏 React UI（无构建，DSH Client 模块）
├─ cordis.patch.yml      bundle 安装行
├─ lib/
│  ├─ model.js           CSV → 领域模型，资质/设备/风险判断
│  ├─ engine.js          候选方案、硬约束、评分、甘特/分析数据
│  ├─ routes.js          /api/lims/*（复用 DSH 认证 Fetch 路由）
│  ├─ tools.js           lims_* 工具
│  ├─ seed.js            MongoDB seed、workspace、审计、方案存取
│  ├─ csv.js / util.js   解析与日期工具
├─ data/                 模拟数据包 CSV/JSON
├─ scripts/              start-mongo.sh、引擎/路由自测
├─ locale/               插件标题与描述
└─ icon.svg              插件图标
```

## 当前验证状态

- ✅ Host 插件已安装并激活；14 个 `lims_*` 工具已出现在当前 Agent 的工具表中（含项目/Test Plan、设备预约、停机影响、约束重排）。
- ✅ MongoDB 已连接并完成 seed；`raw_*` 集合含完整模拟数据。
- ✅ 路由自测通过：overview / projects / test-plan / task / bookings / plans / revise / confirm / explain / analytics / simulate / audit / downtime / impact；停机窗口与已替代方案都会阻断确认。
- ✅ Client 模块已注册到 `sidebar.right.pane.tab`，并出现在聊天标题栏操作区。
- ✅ 三种角色视图（实验人员 / TM-TL / 运营）均可渲染；切换角色会调整一级菜单和默认落点。
- ✅ 项目页与 Test Plan 已生成并持久化；聊天工具结果已接入自定义卡片渲染。
- ✅ 浏览器端正在每 2.6s 轮询 `/api/lims/workspace`（MongoDB `meta.diagnostics` 可见计数增长），说明右侧 UI 已挂载并持续取数。
- ⚠️ 受当前环境限制，无法截图或读取浏览器 DOM；最终视觉检查需要你在 DSH 页面刷新后确认。

## 交互细节

- 资源排程总览默认 7 天（1 周），超出可翻周；顶部显示「本周 N 条 / 已有方案 X 个任务 / 未生成 Y」。
- 总览可以同时显示多个任务的排程（设备/人员/空间行）；每个任务只取一个方案，当前选中方案另有单条明细。
- 甘特条内显示开始/结束时间，深色底 + 白字。
- 分析页「设备负荷」点击设备名，会把 `关于 XX 设备：` 插入聊天输入框，便于继续追问。

## 依赖说明

`agentic-lims/node_modules`（仅 `mongodb` 驱动）是本机安装时保留的运行时依赖；DSH 的 bundle 是目录链接安装，请不要删除它。若换机器，在该目录执行 `npm install` 即可。

## 已知边界

- 单机 MongoDB、冻结演示时钟、贪心排程，不是生产优化器。
- 没有真实权限、审批、生产写入、SSO、回滚；审计只保留原型事件。
- 甘特图是日粒度资源条，未做分钟级设备时间轴。
- 停机目前按「设备 + 整天」建模；部分时段停机、跨天停机窗口和分钟级占用尚未实现。
- Test Plan 目前是 draft，不做批量确认；批量应用/回滚和跨项目联动排程尚未实现。
- `TASK-2007` 的资质数据本身冲突（无人同时具备 HPLC Level 2 + Sample Prep），原型有意标记「需方法审核」，而不是放宽硬约束。
