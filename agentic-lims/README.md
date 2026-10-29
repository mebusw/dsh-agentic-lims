# Agentic LIMS（DSH 右侧边栏插件）— MVP

把「AI-Native 智能实验室预约与排程」做成一个 DSH 插件：

- **UI 在 DSH 右侧边栏**：顶部一级菜单（概览 / 订单 / SPEC / 项目 / 任务 / 排程 / 周计划 / 甘特 / 影响 / 资源 / 分析 / 自定义 / 审计），页面、卡片、甘特图、报表组件都在这里；顶部可切换角色视图（实验人员 / TM-TL / 运营）。
- **聊天就是 DSH 聊天框**：Agent 通过 `lims_*` 工具读取 MongoDB、运行确定性排程引擎，并把右侧工作区切到对应页面。
- **MongoDB 是后端数据存储**：模拟数据包的 CSV 原样导入 `raw_*` 集合；方案、审计、共享工作区是独立集合。
- **确定性引擎负责可行性**：硬约束（状态准入、计划窗口、标准与设备能力、能力项、校准、冲突、日历、样品到位、分包、站点隔离）由代码校验，模型只负责理解和解释。

## 数据口径（2026-10-29 起：客户 SPEC 结构）

排程对象从 `task` 改为客户的 **SPEC → 规格活动 → PLAN 批次**：

```
PLAN26AA1126-1  ──  SPEC26AA4851 (Approved)  ──  SA26AA4851-01 盐雾 / EQPT25AA1100 / 1d
                                                  SA26AA4851-02 冷态电压降 / EQPT25AA1101 / 1d
                ──  SUBS26AA0720 (Finalized)  ──  SA26AA0720-01 外送 EMC / VENDOR-EXT-01 / 10d
```

- **只有规格活动能被排程**；SPEC 是准入与追溯对象（11 态状态机），PLAN 是批次号，`test_execution` 行只是执行记录。
- **准入 = 状态 + 计划窗口**（HC-101 / HC-102）：`Draft`、`In approval`、`In progress` 等状态不进排程池；`Approved` 但没有 `est_start/est_end` 的 SPEC 也不排，并显示缺失字段。
- **样品到位读 `Instockdate`**（HC-108），不再是逐任务的人工假设；缺日期按「待确认」处理。
- **工时来自标准活动**：客户的 `Workload` 列恒为 0，引擎用 `标准 → 历史 → 人工` 三级回退，并记录 `effortSource`。
- **`Pre-booked` 是 SPEC 状态**，预约模式是另一套枚举（Exclusive / Shared / Subcontracted，HC-112）。
- 集合、字段、状态机与投影规则见 **[../docs/data-model.md](../docs/data-model.md)**；结构与规则自测见 `node scripts/check-customer-model.mjs`。

## 升级后第一次启动

宿主代码（`index.js` / `lib/*`）变更需要重启 DSH Web 才会加载；客户端 `client.js` 刷新页面即可。

```bash
# 1) 重启承载插件的 profile（本项目演示实例装在 lims profile；装在 web 就把 --profile 换成 web）
dsh --profile lims web
# 2) 刷新 http://127.0.0.1:3080
# 3) 可选：清掉升级前生成的旧候选方案，重新生成带 inputSnapshot 的方案
(cd agentic-lims && node scripts/reset-demo-data.mjs)
```

> 只刷新页面会出现「订单」接口 404：右侧面板会显示「后端插件仍是旧进程」横幅，并提示重启命令；`/api/lims/health` 的 `features` 字段可用来确认新路由已加载。

插件启动时会幂等补齐 `lab_rules` / `raw_specs` / `raw_spec_activities` 等集合，不需要手工迁移；旧方案没有 `inputSnapshot`，确认时会跳过样品快照比对，但仍会按当前规则复验状态准入、设备、能力项、容量、停机与样品。

## 快速开始

完整安装说明见[仓库根 README](../README.md)。最短路径：

```bash
git clone https://github.com/mebusw/dsh-agentic-lims.git
cd dsh-agentic-lims
./setup.sh          # MongoDB → 依赖 → 演示数据 → 装进 DSH profile
```

`setup.sh` 等价于下面四步，可以单独执行：

```bash
./agentic-lims/scripts/start-mongo.sh                  # 1. MongoDB（27018）
(cd agentic-lims && npm install --omit=dev)            # 2. 依赖
(cd agentic-lims && node scripts/reset-demo-data.mjs)  # 3. 演示数据
dsh plugin --profile web add "$PWD/agentic-lims"       # 4. 装插件
```

装完重启 `dsh web` 并刷新页面，右侧边栏会打开「智能实验室」；也可用聊天标题栏的烧瓶按钮重新打开。

如果 `dsh` 不在 PATH 里，也可以在本插件的 DSH 会话中让 Agent 执行：

```
plugin_manager install_bundle { "target": "<repo>/agentic-lims" }
```

## 演示建议

在 DSH 聊天框里直接说：

1. **自然语言预约**
   > 帮我安排 SA26AA4851-01（盐雾活动），优先保证交付日期，给我两个备选方案，说明风险和资源安排。

2. **解释设备不可用**
   > 为什么 SA26AA4854-01 排不了？有哪些替代设备？

3. **修改约束后重排（UC-03）**
   > 重新安排 SA26AA4851-01，从 11/02 开始，周五下午不要排实验，优先用 EQPT25AA1103。

   Agent 调用 `lims_revise_plan`，右侧显示变更前后对比：完成时间、评分、资源、执行日、风险变化；旧方案标记为“已替代”，不能再次确认。

4. **设备停机影响分析（UC-04）**
   > EQPT25AA1101 明天全天维护，帮我分析受影响的预约并给出重排方案。

   Agent 调用 `lims_analyze_downtime`，右侧切到「影响」页：受影响任务、原计划、建议组合、完成时间变化、可能延期/阻塞。

5. **运营瓶颈**
   > 未来两周最主要的排程瓶颈是什么？如果增加一台 HPLC，能减少多少延期？

6. **确认（模拟）**
   > 采用方案 A，确认。

7. **项目与 Test Plan**
   > 把 PRJ-1001 的 Tensile Strength Test 任务排成一个测试计划。

   Agent 调用 `lims_get_project` / `lims_generate_test_plan`，右侧切到「项目」页，展示项目 → 模板分组 → 多个任务 → 合并时间轴。

8. **简单数字问题**
   > 周三 EQPT25AA1104 有多少个预约？

   Agent 调用 `lims_equipment_bookings`，聊天窗口直接渲染预约数、占用小时、容量利用率和任务卡片。

9. **订单 / 规范**
   > 有哪些测试订单还没拆任务？ORD-7002 的样品到齐了吗？

   Agent 调用 `lims_list_orders` / `lims_get_order`，右侧切到「订单」页：订单 → SPEC → 规格活动、样品状态、交期风险。订单号取自排程表 `Order` 列，与 SPEC 精确关联。

10. **样品延迟 / 交期变更**
    > SPEC26AA4853 的样品晚到 11-05，会影响哪些活动？

    Agent 调用 `lims_analyze_change`，写入 ChangeEvent，重排变更对象，并沿共享设备/人员给出直接 + 间接影响。右侧「影响」页会回放同一份分析。

11. **规则与预约模式**
    > Pre-booked 和预约模式（Exclusive / Shared / Subcontracted）有什么区别？哪些规则还没确认？

    Agent 调用 `lims_list_policies`，返回 11 态状态机、预约模式、能力策略、日历策略、优先级词表和每个活动的样品状态；所有规则都标记 `confirmed: false`。

Agent 会把方案、甘特图、约束校验、停机影响、订单/样品、变更影响、项目测试计划和审计写入右侧边栏；确认只写原型 MongoDB，不写生产系统。

## 角色视图

顶部角色切换只改变**导航组合与默认落点**，不复制页面：

| 角色 | 一级菜单 | 默认落点 | 专属组件 |
|---|---|---|---|
| 实验人员 | 概览 / 订单 / 项目 / 任务 / 排程 / 资源 / 影响 | 概览 | 「我的下周安排」：选择人员、7 天工时、活动、资质匹配的可接任务 |
| TM / TL | 全部页面 | 排程 | 方案对比、约束校验、订单/样品、变更影响、审计 |
| 运营负责人 | 概览 / 订单 / 项目 / 排程 / 影响 / 资源 / 分析 / 审计 | 分析 | 「运营关注」：瓶颈、风险任务、利用率入口 |

角色选择保存在浏览器 localStorage；切换角色时，如果当前页面不属于新角色，会落到该角色的默认页面。

## Request → Task 拆解

- `lims_list_requests` 列出测试请求；
- `lims_prepare_task_draft` 只读拆解：返回已有任务匹配、模板、草稿、置信度、缺失字段，不写库；
- 聊天卡片显示「草稿尚未写入任务」和「创建这些任务（模拟）」；
- 用户确认后 `lims_create_task_draft` 写 `raw_tasks` + `task_template_overrides`，项目页立刻出现新任务；
- 新任务可继续用 `lims_generate_test_plan` / `lims_generate_plans` 排程。

## 订单 / 规范 / 样品

- **Test Order** 的号码来自排程回填表的 `Order` 列 —— 客户的 LIMS 导出里**没有**订单号。因此这里不再是"同模板 + 交期接近"的推断：`spec.order_no` 与 SPEC 是精确关联（`linkConfidence: exact`），没有订单号的 SPEC 直接留空并列在 `unlinkedSpecs`。
- **Test Specification** 是 `raw_specs` 里的 19 条（`SPEC…` / `SUBS…`），带 11 态状态、计划窗口、标准、能力项、`Instockdate` 与样品数。
- **规格活动** 是 `raw_spec_activities` 里的 17 条，活动名沿用客户甘特口径（`TD1&2- Salt mist` 等），设备挂在这一层（客户的 SPEC 表头 0 条设备）。
- **样品到位是一等输入**：读 `spec.instock_date`；`sample_status` 集合只在发生样品变更（`lims_analyze_change` 的 `sample_delay`）时写入覆盖，`source` 会显示是 `spec-export` 还是 `sample_status`。
- 引擎 **HC-108**：实际测试不得早于 `Instockdate`；日期缺失时标「待确认」，不会默认已到位。
- 每个方案保存 `inputSnapshot`（样品到位时间、预约模式、规则版本、交期），确认前重新比对，样品时间变了会拒绝确认并要求重新生成。

## 预约模式 vs `Pre-booked` 状态（14.10）

这是客户最容易指出来的口径问题，代码里已经分开：

| | 是什么 | 取值 | 存在哪 |
|---|---|---|---|
| `Pre-booked` | **SPEC 状态**（已占位，1/50） | 状态机 11 态之一 | `raw_specs.status` |
| 预约模式 | 资源能否共享的规则 | `Exclusive` / `Shared`（≤2 并发）/ `Subcontracted` | `lab_rules.json.reservationModes` |

- 模式来源：SPEC 状态默认（`Pre-booked` / `Finalized` → Exclusive）→ 活动级覆盖（`reservationOverrides`）→ 默认 `Shared`。
- `SUBS` 前缀的 SPEC 走 `Subcontracted`：只能占用 `VENDOR-*` 资源，不占内部设备（HC-109）。
- 引擎 **HC-112** 输出规则 ID、规则版本和证据 `evidence.reservationMode`；历史方案保留自己的 `ruleVersion`。
- `lims_list_policies` 返回状态机、预约模式、能力策略、日历策略、优先级词表与全部 `confirmed: false` 标记，供「为什么不能共享设备 / Prebook 和 Pre-booked 有什么区别」这类追问使用。

## 变更影响分析（14.7）

「影响」页新增 **订单变更与影响分析** 面板，与 `lims_analyze_change` 工具走同一条 `/api/lims/change-impact`：

| 变更类型 | 写入 | 分析 |
|---|---|---|
| `sample_delay` | `sample_status.expectedInStockAt` | 从新到位时间重排变更对象；沿共享设备/人员重排相关任务 |
| `due_date` | `task_overrides.dueDate` | 交期余量、是否延期；共享资源连锁影响 |
| `priority` | `task_overrides.priority` | 优先级变更后的可行性与影响 |

- 原始 CSV 不改：变更写入独立集合，`raw_tasks` 仍是导入快照。
- 每次变更写 `change_events` + `change_impacts` + 审计事件；右侧「影响」页会回放同一次分析的直接/间接影响。
- 直接/间接影响都由确定性引擎计算：先移除变更对象的旧占用，再铺上新方案，然后逐个重排共享资源上的相关任务。最多展开 3 个间接任务，其余在说明里标注为未展开。
- 变更分析**不会**自动确认任何方案；确认仍需重新生成候选并走确认前复核。

## 卡片引用到聊天（追问）

- **任意卡片**悬停后右上角出现「引用」按钮：把卡片标题、关键字段和渲染文本整理成 `【引用 · 卡片标题】…` 块，插入 DSH 聊天输入框。
- **选中文字后**再点「引用」会自动切换为「引用选中」，只带选中内容 + 卡片标题，适合追问某个设备、某个日期或某条约束。
- 聊天里的 **lims_* 工具卡**同样带「引用」按钮（`ToolCard` 共享 `inputActions`）；回答末尾的卡片也可以直接引用。
- 引用块包含结构化的 ID（任务、方案、设备、订单、规则版本），Agent 能据此知道用户指的是哪张卡片；系统提示要求把 `【引用 · …】` 当作当前上下文。
- 卡片折叠状态、角色、固定卡片仍保存在 localStorage；引用本身不写数据库。

## 项目与 Test Plan

- **项目** 是一组测试任务的归属上下文；一个项目下可以有多个模板分组。
- **模板** 定义方法、设备类型、资质、空间和准备/测试时长。
- **模板编号说明**：`TPL-004` 是模板 ID（系统主键 / 分组键 / API 参数）；`MAT-TEN-01` 是方法代码（mock 命名约定：`MAT` 材料、`TEN` 拉伸、`01` 序号），不是模板 ID。调用 `lims_generate_test_plan` 时用 `templateId=TPL-004`，不要用 `MAT-TEN-01`。模板匹配本身按模板名称 + 设备类型，不靠方法代码。
- **Project ↔ Template 关系**：项目本身不直接挂模板；项目包含多个任务，每个任务通过 `templateId` 关联一个模板。因此：
  - 一个项目可以有多个模板分组（如 PRJ-1001 当前为 TPL-004）；
  - 一个模板可以被多个项目复用（如 TPL-004 同时被 PRJ-1001、PRJ-1002 使用）；
  - 项目页「模板 × 项目」矩阵可以看到模板被哪些项目使用、各有多少任务；
  - 项目详情「模板映射」可为每个任务手动选择模板或恢复自动匹配，写入 `task_template_overrides`，不修改 CSV。
  - 模板修改会影响**后续**项目分组和测试计划；已生成的历史测试计划保留原分组。模板时长会更新，但任务的设备/资质字段仍以任务需求为准。
- **Test Plan** 是“某个项目 + 某个模板分组”的一批任务。生成顺序固定为：
  1. 先按模板分组过滤任务（例如 TPL-004 Tensile Strength）；
  2. 组内按优先级 `Urgent → High → Normal → Low`；
  3. 同优先级按交期早 → 晚；
  4. 逐个任务生成 1 个方案，并把已排方案写入批次上下文；与前面任务资源冲突时，从冲突日的下一天重试（最多 4 次），仍冲突则标记 unscheduled。
- 这是**按优先级/交期的贪心串行排程**，不是全局最优；不会按项目任务列表顺序或工时排序。
- 项目页展示：项目列表 → 项目详情 → 模板分组 → 任务列表 → 生成测试计划 → 合并时间轴。
- 测试计划中的每个任务仍保留独立方案，可继续进入排程页逐项确认；测试计划本身目前是 draft，不做批量确认。
- **选中测试计划**现在有明确反馈：顶部「当前选中：TP-…」横幅、卡片高亮 + 「当前选中」pill、选中卡展开连续时间轴与任务方案明细，未选中卡显示「选中此计划后展开时间轴」；按钮在选中后变为「当前选中」并禁用，切换另一张卡会有 toast。

## 卡片组合与折叠

- **所有 `Card` 都有折叠按钮**，折叠状态按卡片 ID 存在浏览器 localStorage。
- 折叠后仍显示卡片标题（自动读取卡片内的 SectionTitle / 自定义标题，取不到时用卡片类型名）；点击折叠条即可展开。
- **自定义视图**提供 5 张共享卡片：概览 KPI、资源排程摘要、瓶颈与风险、最近审计、项目摘要。
  - 可以在自定义视图里自由增删、上下移动；
  - 可以「固定到」概览 / 项目 / 排程 / 影响 / 分析 / 资源 / 审计等任意页面，同一张卡可固定到多个页面；
  - 「聊天」按钮会把卡片主题插入 DSH 聊天输入框，继续追问。
- 页面专属卡片（方案对比、约束校验、项目详情、停机影响等）依赖当前页面状态，当前版本不做跨页面拖拽；共享卡片库是自由组合的第一层。
- 回答区卡片由 `conversation.chat.turnTail` 注册，工具结果会显示在回答下方（已实现）。

## 交互细节

- **资源排程总览默认显示 7 天（1 周）**；超过一周时出现「上一周 / 下一周」翻页，默认停在方案的第一周。
- 总览可在**甘特 / 日历**之间切换：
  - 甘特：资源行 × 7 天时间轴；**跨天任务画一条连续条**（首次开始到末次结束），不再拆成多个日块；同一资源多个任务自动分泳道。
  - 日历：默认**两周，两行各一周**；每天可堆叠多个时间段色块，按任务配色；色块内显示 `08:00–16:00` 和任务 ID。
- 所有甘特条/日历块内显示**开始/结束时间**，并采用深色底 + 白字；测试计划时间轴同样改为连续条。
- **总览同时显示多条排程**：行是设备/人员/空间，格子内可以堆叠同一资源的多个任务条；顶部显示「本周 N 条 · 已有方案 X 个任务 · 未生成 Y」。
- **每个任务只取一个方案**（已确认优先，其次评分/最新），候选方案是备选关系，不会被画成同时占用。
- **当前方案资源明细**单独显示 1 条，用于核对选中方案；总览用于看全实验室的多条排程。
- 甘特条内显示**开始/结束时间**；设备/人员/空间使用深蓝/深青/深琥珀底色，白字不会落在白底上。
- **分析 → 设备负荷**：点击设备名会把 `关于 {设备名}（{设备ID}）设备：` 插入 DSH 聊天输入框（保留已有文字，插入到当前光标），可以直接继续追问，例如“周三有多少个预约？”。
- **确认排程 / 登记停机**后会在按钮附近出现绿色结果条：显示方案 ID、写入的占用条数、审计事件、时间；可一键跳到审计页。资源排程总览会同步刷新。
- **概览页 KPI** 改为「已有方案 / 未生成」，按 MongoDB 中未替代、含执行时段的方案计数；设备负荷图只在「分析」页，避免两个 view 重复。
- **Agent 协作入口**会自动选优先级最高、尚未生成方案且非人工审核的任务；点击后真实写入 `plans` / `audit_events` / `workspace`，停留概览并显示结果条（方案 ID、计数 3→4、workspace revision）。候选方案不会改变已占用负荷，确认后才写入资源占用。
- **候选 ≠ 已确认**：生成/重排只写入候选方案。确认入口有三处：
  1. 聊天卡片底部「当前是候选方案，尚未确认」下方的「确认此方案」；
  2. 概览 Agent 结果条的「确认方案 1（模拟）」；
  3. 右侧排程「当前方案摘要」顶部的「候选方案 · 尚未确认」横幅和「确认此方案」按钮。
- 确认成功后显示资源占用条数、审计事件 ID，并在排程/审计页可见；聊天卡片也会变为「已模拟确认」。
- 演示数据的人员/设备/项目/任务/模板名称均追加了中文：例如 `Tester 03 王强`、`GC GC-01 气相色谱`、`Hybrid 混合项目`。
- 测试计划的合并时间轴同样默认 1 周并支持翻页。

## 聊天卡片：只在结论/决策时出现

- **中间查询折叠成一行**：`lims_list_specs`、`lims_get_task`、`lims_list_policies` 这类读取型工具，在对话里只渲染一条浅色 strip（"✓ 读取 SPEC 列表 · 19 个 · 可排 8"），点一下才展开明细。多步推理时不会有一墙卡片盖住结论。
- **只有决策/结果才出卡**：`lims_generate_plans`、`lims_revise_plan`、`lims_confirm_plan`、`lims_analyze_downtime`、`lims_analyze_change`、`lims_prepare_task_draft`、`lims_week_plan`、`lims_generate_test_plan`、`lims_equipment_bookings` 保留完整卡片，因为用户要在这里做选择或看结论。
- 运行中的工具也只是一条"进行中"的 strip，不会先弹一张 pending 大卡。
- 系统提示同步要求：一次回答只保留一个决策点，中间查询不要复述明细，选择放在最后。

## 聊天卡片

`lims_*` 工具结果会在 DSH 聊天窗口里渲染成 React 卡片，而不是只显示一段文本：

- 设备某日预约数：大数字 + 占用时长 + 容量利用率 + 任务列表；
- 停机影响：受影响/可重排/推迟/阻塞 + 前后时间；
- 候选排程、重排对比、资源可用性、瓶颈、项目、Test Plan 等。

简单数字问题（例如“周三 EQPT25AA1104 有多少个预约”）应由 `lims_equipment_bookings` 回答，卡片直接给出数字。

### 回答末尾的卡片（turn tail）

DSH 会在回答结束后把一轮的「思考 + 工具调用」折叠成一行汇总，只留在工具组里的卡片会随之收起。为了让人在读完回答时仍然看到结论卡片，插件额外注册了 `conversation.chat.turnTail`：

- 一个 Turn Definition（`client.js` 里的 `limsTurnDefinition`）把本轮每个已结算 `lims_*` 结果按 Turn 归档，数据取自事件里的 `data.meta`（即工具声明的 `presentationMeta`）；
- 收尾卡片渲染在回答正文下方、工具折叠组之外，折叠与否都不影响它；
- 同一轮最多 3 张、按卡片类别去重；`task`/`tasks` 这类纯上下文卡片在有更实质卡片时省略。

工具组展开时卡片会出现两份（一份在工具组、一份在回答末尾），这是有意的：前者是调用轨迹，后者是结论。

## 架构

```
DSH Web
├─ 聊天框（DSH 原生） ── lims_* tools ──┐
├─ 右侧边栏 tab（本插件 client.js）      │
│   └─ /api/lims/*（DSH 认证 Fetch 路由）│
└───────────────────────────────────────┴─ Host plugin (index.js)
                                             ├─ MongoDB 127.0.0.1:27018/agentic_lims
                                             ├─ 领域模型 + 规则引擎（lib/model.js, lib/engine.js）
                                             ├─ JSON 路由（lib/routes.js）
                                             └─ 工具注册（lib/tools.js）
```

- `client.js` 是一个 DSH Client 模块，注册 `sidebar.right.pane.tab` 与右侧边栏 tab 类型。
- 主操作按钮统一为**蓝底白字**；筛选器选中态、图标按钮也使用同一套蓝色。
- 数据请求复用 DSH 的浏览器认证 Cookie，不额外开端口、不走跨域。
- 工具调用与页面调用走**同一组** HTTP handler，避免「聊天里说可行、页面里说不可行」。

## 数据与引擎假设

- 演示时钟冻结在 **2026-10-30 08:00 (+08:00)**（周五），与数据包日期一致。
- 周末：`24h` 日历的设备**且**人员 `weekend_allowed=1` 时开放，否则不排（HC-107）。目前没有人员开放周末，因此等价于"周末不排"。
- 每日容量按资源工作时间与已有 `raw_allocations`（执行中 / Pre-booked / 分包占用）扣减；活动自身的旧占用在重排时会被忽略，避免"自己和自己冲突"。
- 硬约束编号与新规则书对齐：`constraints.csv` 的 HC-101 … HC-112、SC-101 … SC-106。
- 能力项校验只在 `spec.competency_check=ON` 时是硬约束（HC-104）；OFF 时只提示。`Testers` 里的 `TST BY SLT10` / `Performance measure` 是角色占位符，不当作真实人员。
- 站点隔离（HC-110）：`AMPLITUDE` / `VOLTA` 的设备、工位、人员池不共享；`EXTERNAL` 只能由分包资源承接。
- 停机事件按「设备 + 整天」写入 `downtime_events`；重排时该设备当天容量视为 0，确认前会再次拦截停机时段。
- 每次重排生成新的方案版本；旧方案标记为 `superseded`，不能再次确认，便于前后对比。
- 测试计划按项目/标准（`STD…`）分组，活动按优先级与交期顺序排入；同一批内会做重叠检查，冲突时顺延重试。
- 确认方案会替换该活动在 MongoDB 中的原型占用，并写审计事件；不会调用任何生产 LIMS。

## 目录

| 文件 | 作用 |
|---|---|
| `index.js` | Host 入口：Mongo 连接、路由、工具、系统提示 |
| `client.js` | 右侧边栏 React UI（无构建、通过 DSH Client 模块加载） |
| `lib/model.js` | CSV → SPEC/活动/PLAN/能力/标准领域模型，并投影成引擎 task |
| `lib/upgrade.js` | 规则层：订单投影、样品（Instockdate）、预约模式、状态机、规则版本 |
| `lib/engine.js` | 候选方案、硬约束（HC-101…HC-112）、评分、甘特/分析/变更影响 |
| `lib/routes.js` | `/api/lims/*` 路由（含 SPEC、PLAN 批次、周计划、订单、规则、变更影响） |
| `lib/weekplan.js` | 周桶聚合：ISO 周号、周内序号、工时、回填字段可填性 |
| `lib/gantt.js` | 四层甘特：Project → PLAN → SPEC → activity、窗口裁剪、rollup 汇总 |
| `lib/tools.js` | 24 个 `lims_*` 模型工具（含 `lims_list_specs` / `lims_get_spec` / `lims_week_plan`）与卡片元数据 |
| `lib/seed.js` | MongoDB seed、工作区、审计、方案、测试计划、样品、变更事件存取 |
| `data/` | 客户口径数据包 CSV + `lab_rules.json`（规则层，全部 `confirmed: false`） |
| `scripts/start-mongo.sh` | 启动本地 MongoDB（自动探测 mongod，缺省 Docker 兜底） |
| `scripts/reset-demo-data.mjs` | 把演示库恢复到干净初始状态（无方案、无停机） |
| `scripts/check-customer-model.mjs` | 数据结构自测：SPEC 准入、样品、工时、规则、路由、幂等 seed |
| `scripts/check-review-confirm.mjs` | 「需审核」方案不能死锁：无 ack 拒绝、有 ack 确认并写审计 |
| `scripts/check-syntax.mjs` | 对 index.js / client.js / lib / scripts 全量 `node --check`（重启前先跑，防止模板字符串里混进反引号导致插件整体加载失败） |
| `lib/routes.js` → `/api/lims/reset` | 演示数据重置：all / plans / downtime / changes / workspace / task / spec |
| `scripts/check-ui-render.mjs` | headless Chrome 渲染自测：12 个页面、引用桥、变更分析（`AGENTIC_LIMS_UI_SHOT=<dir>` 出截图） |
| `scripts/check-engine.mjs` | 不依赖 DSH 的引擎自测 |
| `scripts/check-upgrade.mjs` | 订单/样品/预约模式/变更影响自测（**旧 task 口径，待重写**） |
| `scripts/check-routes.mjs` | 不依赖 DSH 的 HTTP handler 自测 |
| `scripts/check-downtime.mjs` | 停机影响引擎自测 |
| `scripts/check-downtime-routes.mjs` | 停机登记/重排路由自测 |
| `scripts/check-downtime-confirm.mjs` | 停机窗口阻断旧方案确认的回归测试 |
| `scripts/check-revision.mjs` | 方案重排、前后对比、旧版本替代与确认拦截测试 |
| `scripts/check-projects.mjs` | 项目、模板分组、Test Plan 生成与持久化测试 |
| `scripts/check-resource-schedule.mjs` | 多任务资源排程总览（按周、每任务一个方案）测试 |
| `scripts/reseed-demo.mjs` | 重新导入中文演示数据并生成停机/测试计划/候选方案 |
| `scripts/check-calendar-two-weeks.mjs` | 两周资源窗口（14 天、3 条排程）测试 |
| `scripts/check-overview-counts.mjs` | 概览「已有方案 / 未生成」计数测试 |
| `scripts/check-agent-dashboard-page.mjs` | Agent 生成方案后停留概览、写入 workspace/plans 测试（临时 DB） |
| `scripts/check-template-mapping.mjs` | 模板 × 项目矩阵、任务模板映射修改/重置测试（临时 DB） |
| `scripts/check-task-draft.mjs` | request → task 草稿创建、项目分组与测试计划测试（临时 DB） |
| `scripts/check-demo-prompt.mjs` | 测试计划 + 独立任务 Demo 流程测试（临时 DB） |
| `scripts/check-client-cards.mjs` | 回答末尾卡片（turn tail）+ 卡片引用格式自测，无需浏览器 |
| `scripts/check-ui-render.mjs` | 浏览器冒烟测试：真实 `client.js` 在 headless Chrome 中渲染 概览/订单/影响/排程，验证卡片引用与变更分析（缺浏览器或 React UMD 时自动跳过） |

## 已知边界

- 这是 **可验证可行性的 demo**：单机 MongoDB、冻结时钟、单体排程贪心算法，不是生产级优化器。
- 没有真实权限、审批流、生产写入、SSO 或回滚；审计只保留原型事件。
- 排程按「每日小时」建模，尚未使用分钟级设备时间轴；甘特图是日粒度资源条。
- 停机目前按「设备 + 整天」建模；部分时段停机、跨天停机窗口和分钟级占用尚未实现。
- Test Plan 目前是 draft，不做批量确认；批量应用/回滚和跨项目联动排程尚未实现。
- 页面专属卡片（方案、项目、停机等）依赖页面状态，暂不支持拖拽到其他页面；共享卡片库是当前的自由组合范围。
- 订单号来自排程回填表的 `Order` 列（LIMS 导出没有该字段）；没有订单号的 SPEC 留空，不做推断。
- 状态机、预约模式、能力策略、日历策略与优先级词表都来自 `data/lab_rules.json`，全部 `confirmed: false`；UI 与工具都会这样标注。
- UI 已加「SPEC 看板」「周计划」「甘特」；项目页仍是「项目 → 标准 → 活动」，四层折叠在「甘特」页里实现。
- `scripts/` 里除 `check-customer-model.mjs`、`check-engine.mjs` 外的旧自测脚本仍引用 `TASK-200x` / `EQ-00x`，UI 阶段重写。
- 变更影响只沿「共享设备 / 共享人员」展开，且最多展开 3 个间接任务；任务依赖、样品批次拆分和跨实验室影响尚未建模。
- 卡片引用插入的是纯文本引用块，不是 DSH 的结构化 reference chip；追问仍依赖模型读取 `【引用 · …】` 块。
- SPEC 内的活动顺序（活动 2 必须在活动 1 之后）尚未做成硬约束，目前靠批次避让近似。
- 数据包里的能力目录是原型造的 8 条，结构与客户一致（外部 ID + Type/Domain/Sub Domain/Sub Domain2），ID 值不是客户的。
- 正式的集成、验证、部署与安全要求需另做评估。
