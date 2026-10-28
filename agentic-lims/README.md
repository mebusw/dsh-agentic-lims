# Agentic LIMS（DSH 右侧边栏插件）— MVP

把「AI-Native 智能实验室预约与排程」做成一个 DSH 插件：

- **UI 在 DSH 右侧边栏**：顶部一级菜单（概览 / 订单 / 项目 / 任务 / 排程 / 影响 / 资源 / 分析 / 自定义 / 审计），页面、卡片、甘特图、报表组件都在这里；顶部可切换角色视图（实验人员 / TM-TL / 运营）。
- **聊天就是 DSH 聊天框**：Agent 通过 `lims_*` 工具读取 MongoDB、运行确定性排程引擎，并把右侧工作区切到对应页面。
- **MongoDB 是后端数据存储**：模拟数据包的 CSV 原样导入 `raw_*` 集合；方案、审计、共享工作区是独立集合。
- **确定性引擎负责可行性**：硬约束（设备能力、资质、校准、冲突、工作时段、前处理空间）由代码校验，模型只负责理解和解释。

## 升级后第一次启动

宿主代码（`index.js` / `lib/*`）变更需要重启 `dsh web` 才会加载；客户端 `client.js` 刷新页面即可。

```bash
# 1) 重启 DSH Web（同一个 shell，保留 AGENTIC_LIMS_* 环境变量）
dsh web
# 2) 刷新 http://127.0.0.1:3080
# 3) 可选：清掉升级前生成的旧候选方案，重新生成带 inputSnapshot 的方案
(cd agentic-lims && node scripts/reset-demo-data.mjs)
```

插件启动时会幂等补齐 `prototype_config` / `sample_status` 集合，不需要手工迁移；旧方案没有 `inputSnapshot`，确认时会跳过样品快照比对，但仍会按当前规则复验设备、资质、容量、停机、样品和 Task Type。

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
   > 帮我安排 TASK-2005，优先保证交付日期，给我两个备选方案，说明风险和资源安排。

2. **解释设备不可用**
   > 为什么 TASK-2003 不能用 EQ-004？有哪些替代设备？

3. **修改约束后重排（UC-03）**
   > 重新安排 TASK-2005，从 10/29 开始，周五下午不要排实验，优先用 EQ-005。

   Agent 调用 `lims_revise_plan`，右侧显示变更前后对比：完成时间、评分、资源、执行日、风险变化；旧方案标记为“已替代”，不能再次确认。

4. **设备停机影响分析（UC-04）**
   > EQ-007 明天全天维护，帮我分析受影响的预约并给出重排方案。

   Agent 调用 `lims_analyze_downtime`，右侧切到「影响」页：受影响任务、原计划、建议组合、完成时间变化、可能延期/阻塞。

5. **运营瓶颈**
   > 未来两周最主要的排程瓶颈是什么？如果增加一台 HPLC，能减少多少延期？

6. **确认（模拟）**
   > 采用方案 A，确认。

7. **项目与 Test Plan**
   > 把 PRJ-1001 的 Tensile Strength Test 任务排成一个测试计划。

   Agent 调用 `lims_get_project` / `lims_generate_test_plan`，右侧切到「项目」页，展示项目 → 模板分组 → 多个任务 → 合并时间轴。

8. **简单数字问题**
   > 周三 EQ-007 有多少个预约？

   Agent 调用 `lims_equipment_bookings`，聊天窗口直接渲染预约数、占用小时、容量利用率和任务卡片。

9. **订单 / 规范**
   > 有哪些测试订单还没拆任务？ORD-7002 的样品到齐了吗？

   Agent 调用 `lims_list_orders` / `lims_get_order`，右侧切到「订单」页：订单 → Spec → 原型推断关联的任务、样品状态、交期风险。订单与任务的关联会明确标注「原型推断，需 TL 确认」。

10. **样品延迟 / 交期变更**
    > TASK-2005 的样品晚到 10/31，会影响哪些任务？

    Agent 调用 `lims_analyze_change`，写入 ChangeEvent，重排变更对象，并沿共享设备/人员给出直接 + 间接影响。右侧「影响」页会回放同一份分析。

11. **规则与 Task Type**
    > Prebook 和 Test Spec 的预约规则有什么不同？哪些规则还没确认？

    Agent 调用 `lims_list_policies`，返回规则版本、Task Type 独占/共享规则、样品策略和每个任务的样品状态；所有规则都标记 `confirmed: false`。

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

## 订单 / 规范 / 样品（README-升级版 14.4、14.8）

- **Test Order** 来自 `test_requests.order_id`，**Test Specification** 对应一条 request（mock 数据里是 1:1），**Test Task** 是项目制 CSV 的任务。三者是不同的业务对象，页面和工具都分开呈现。
- 项目 CSV 没有订单外键，因此订单 → 任务**只能做原型推断**：同模板 + 交期相差 ≤ 21 天，且一个任务只被一个订单认领。每条关联都带 `linkBasis` 和 `confidence`，UI 与聊天都必须说明「需 TL 确认」。没有匹配到任务的订单显示「待拆解任务」，没有订单的任务显示在「未关联订单的任务」。
- **样品到位是一等输入**：`sample_status` 集合保存每个任务的 `status / required / available / expectedInStockAt / actualInStockAt`，全部来自 `data/prototype_upgrade.json` 的原型假设（`source: prototype-assumption`、`confirmed: false`）。
- 引擎新增 **HC-007 样品到位**：实际测试不得早于样品实际/预计到位时间；样品「未到位且没有到位时间」时方案判为不可行；「部分到样」给出警告。
- 每个方案保存 `inputSnapshot`（样品到位时间、Task Type、规则版本、交期）；确认前会重新比对快照，样品时间变了会拒绝确认并要求重新生成。

## Task Type 与预约规则（14.10）

- `data/prototype_upgrade.json` 定义三类规则：
  - `Prebook`：设备与人员整日独占，同日同设备不允许其他任务；
  - `Test Spec`：允许按剩余容量共享，同日上限 2 个任务；
  - `Non-standard validation`：必须方法审核，同日上限 1 个任务。
- 引擎新增 **HC-008 Task Type 预约规则**，冲突会给出规则 ID、规则版本和证据。
- TASK-2001 被配置为 Prebook，TASK-2007 为非标验证，其余默认 Test Spec；这些分配都标记 `confirmed: false`。切换或修改规则只会影响后续方案，历史方案保留自己的 `ruleVersion`。
- `lims_list_policies` 返回规则版本、Task Type 规则、样品策略、任务分配和样品状态，供「为什么不能共享设备」这类追问使用。

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

## 聊天卡片

`lims_*` 工具结果会在 DSH 聊天窗口里渲染成 React 卡片，而不是只显示一段文本：

- 设备某日预约数：大数字 + 占用时长 + 容量利用率 + 任务列表；
- 停机影响：受影响/可重排/推迟/阻塞 + 前后时间；
- 候选排程、重排对比、资源可用性、瓶颈、项目、Test Plan 等。

简单数字问题（例如“周三 EQ-007 有多少个预约”）应由 `lims_equipment_bookings` 回答，卡片直接给出数字。

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

- 演示时钟冻结在 **2026-10-27 08:00 (+08:00)**，与模拟数据包日期一致。
- 周末不排程；每日人员/设备/空间容量按工作时间与已有 `daily_schedule_allocations` 扣减。
- 任务自身的旧分配在重排时会被忽略，避免「自己和自己冲突」。
- 硬约束对应 `constraints.csv` 的 HC-001 … HC-006；非标准方法（`TASK-2007`）标记为「需方法审核」，确认会被拒绝。
- 停机事件按「设备 + 整天」写入 `downtime_events`；重排时该设备当天容量视为 0，确认前会再次拦截停机时段。
- 每次重排生成新的方案版本；旧方案标记为 `superseded`，不能再次确认，便于前后对比。
- 测试计划按项目/模板分组，任务按优先级与交期顺序排入；同一批任务之间会做重叠检查，冲突时顺延到后一天重试。
- 确认方案会替换该任务在 MongoDB 中的原型占用，并写审计事件；不会调用任何生产 LIMS。

## 目录

| 文件 | 作用 |
|---|---|
| `index.js` | Host 入口：Mongo 连接、路由、工具、系统提示 |
| `client.js` | 右侧边栏 React UI（无构建、通过 DSH Client 模块加载） |
| `lib/model.js` | CSV → 领域模型、资质/设备/风险判断 |
| `lib/upgrade.js` | 订单/Spec 投影、样品到位、Task Type 规则、规则版本 |
| `lib/engine.js` | 候选方案、硬约束（HC-001…HC-008）、评分、甘特/分析/变更影响 |
| `lib/routes.js` | `/api/lims/*` 路由（含订单、规则、变更影响） |
| `lib/tools.js` | 21 个 `lims_*` 模型工具与聊天卡片元数据 |
| `lib/seed.js` | MongoDB seed、工作区、审计、方案、测试计划、样品、变更事件存取 |
| `data/` | 模拟数据包原始 CSV/JSON（已复制，便于离线运行） |
| `scripts/start-mongo.sh` | 启动本地 MongoDB（自动探测 mongod，缺省 Docker 兜底） |
| `scripts/reset-demo-data.mjs` | 把演示库恢复到干净初始状态（无方案、无停机） |
| `scripts/check-engine.mjs` | 不依赖 DSH 的引擎自测 |
| `scripts/check-upgrade.mjs` | 订单/样品/Task Type/变更影响升级自测（临时 DB） |
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
- 订单 ↔ 任务的关联是原型推断（同模板 + 交期接近），不是 LIMS 已确认关系；没有真实 `order_id` 外键可用。
- 样品状态、Task Type 分配和实验室优先级都是 `data/prototype_upgrade.json` 的原型假设，全部 `confirmed: false`；UI 与工具都会这样标注。
- 变更影响只沿「共享设备 / 共享人员」展开，且最多展开 3 个间接任务；任务依赖、样品批次拆分和跨实验室影响尚未建模。
- 卡片引用插入的是纯文本引用块，不是 DSH 的结构化 reference chip；追问仍依赖模型读取 `【引用 · …】` 块。
- 模拟数据包中的 `TASK-2007` 资质数据本身存在冲突（无人同时具备 HPLC Level 2 + Sample Prep），原型有意暴露为「需审核」，而不是自动放宽硬约束。
- 正式的集成、验证、部署与安全要求需另做评估。
