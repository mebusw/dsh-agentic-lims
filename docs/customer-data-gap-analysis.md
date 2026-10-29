# 客户真实排程数据复盘 → Agentic LIMS 插件更新清单

> 核对日期：2026-10-29 ｜ 核对对象：客户提供的 4 个脱敏导出文件 ｜ 对照对象：本仓库 `agentic-lims` 插件（v0.2.0 / README-升级版 第 14 章）

---

## 0. 结论先说

1. **客户给的不是"测试请求 + 排程结果 + 甘特"，而是一套 `SPEC 主数据视图` + 一张 `空的年度排程回填表` + 一份 `甘特导出`。** 三个视图之间没有可用外键（50 个 SPEC 与甘特里的 19 个 SPEC **交集为 0**），所以插件必须能"分别吃两套视图"，而不能假设一条 `request → task → plan` 的连续链路。
2. **排程的基本单位不是"任务"，而是 `Spec（测试规范）→ Activity（活动）` 两层**，外面再套 `PLAN（排程批次号）`。我们现在把 `task` 当排程原子，粒度偏粗、层级错位；客户甘特里 1 个 spec 下会挂 `Spec activity`（带设备 `EQPT…`）和 `Test execution` 两种活动，还有 `SUBS…` 分包 spec。
3. **排程哲学不同：客户是"周桶 + 优先级 + 周内序号 + 工作量"的产能分配，不是小时级装箱。** 他们的输出表 `Planning` 只有 19 个业务列 + 52 周 × 2 段的格子，靠 `Priority` + `Sequence` + `Workload` 决定一周内谁先做。我们的引擎给的是 ISO 时间戳的分钟级方案，**默认无法回填这张表**——这是产品定位问题，不是渲染问题。

**P0（不做就会在评审现场被指出来）**：

| # | 问题 | 影响 |
|---|---|---|
| P0-1 | `Pre-booked` 语义撞车：客户是 **spec 状态**，我们当 **Task Type 预约规则** 用 | 同一个词两种含义，客户一看就串戏 |
| P0-2 | `Priority` 词表不统一：`test_requests.csv` 用 `Routine`，代码只认 `Urgent/High/Normal/Low`，`Routine` 被排到 **最末（rank 4）** | 现有 7 条 demo 请求实际是"最低优先级"，演示即错 |
| P0-3 | 我们强依赖 `due_date` 非空；客户 **20/50 个 spec（全部 Draft/In approval）没有任何日期** | 真实导入即崩，或引擎给出假交期 |
| P0-4 | `Workload` 字段客户 **100% 存在、100% 等于 0**；设备只在 activity 行（spec 头 0 条） | `effortHours` 假设不成立，排程输入缺一半 |
| P0-5 | 输出没有 `Plan No. / Week / Sequence` 三个客户必填列 | 方案无法交回客户流程，只能当"参考图" |

---

## 1. 四个文件的事实画像

先纠正一下口径：附件其实是 **4 个**（第 4、5 个被合并成了一句话），逐个核对如下。

| # | 文件 | 真实形态 | 规模 | 时间范围 | 它是什么 |
|---|---|---|---|---|---|
| 1 | `Spec Data_…Draft & InApproval specs.xlsx` | 单 sheet `ExportData`，32 列 | 20 行 | 仅 1 行有日期 | **测试请求**：状态 = `Draft` 17 / `In approval` 2 / `Pre-booked` 1。只有 1 行填了 tester、7 行有标准号、0 行有能力项与设备 |
| 2 | `Spec Data_…StatusAfterApproved.xlsx` | 同上，32 列 | 50 行 | 计划日期 2024-12-05 → 2026-09-22 | **已审批后的 spec 目录**：10 种状态全在，30 行有预计起止日期 |
| 3 | `output 智能排程的输出结果.xlsx` | sheet `Planning`，`A1:DY1517`，第 10 行起预置 1306 行样式，104 个周列 | 有效内容仅表头 9 行 | 52 周 × 2 段 | **空模板**：智能排程结果要回填的年度排程表（不是结果本身） |
| 4 | `gantt_from0801_KarenTestLab….xls` | `ExportData`，15 列，层级靠缩进 | 49 行 | 2026-07-26 → 2026-11-13 | **甘特导出**：`Project → PLAN → SPEC/SUBS → Activity` 四层，带设备与人员 |

### 1.1 五个必须先知道的事实

| 编号 | 事实 | 证据 | 对方案的含义 |
|---|---|---|---|
| F1 | 文件 1 是文件 2 的**子集**（20 ⊂ 50，差集为 0 行） | 按 `Test Spec Id` 比对 | 两个文件是"同一快照按状态切开"，不是两个系统；请求=spec 的早期状态 |
| F2 | 文件 2 与文件 4 的 SPEC **交集 = 0** | 50 个 SPEC vs 甘特里 19 个（16 SPEC + 3 SUBS），`SPEC26AA4770+` 系列在文件 2 里完全不存在 | 不能 join！甘特是 10–11 月排程视图，spec 导出截止到 9 月。→ 插件要能"只有 spec 没有计划"和"只有计划没有 spec"两种残缺状态都不崩 |
| F3 | `Workload` **100% 有值、100% 等于 0** | `Workload.unique() == [0]` | 客户当前**不维护工时**。工时只能来自标准/历史/人工补录，不能假设字段可用 |
| F4 | spec 头的 `Test equipment external ID` **0/50 有值** | 全空 | 设备绑定在 **activity 层**（甘特里 `EQPT25AA1100`），不在 spec 头 |
| F5 | 标题不可用于匹配：24 个重复 `Title`，且大量是 `Test title 00987`、`Create from empty_test by Karen`、`241123.182533.909020` | 重复率 48% | 我们 `matchTemplate()` 靠方法名字匹配 → 在这份数据上会大面积误配。必须改成按 `Standard + Competency + Activity` 匹配 |

另外两个隐性的重要事实：

- **F6 状态与日期强相关**：`Draft` + `In approval` 共 19 行，**100% 没有预计起止日期**；其余 31 行里 30 行有（唯一例外是 1 条 `Finalized`）。也就是说**审批通过 = 排程输入的准入门槛**，这与我们"待审核任务也能生成候选方案"的行为不同。
- **F7 时间语义是"日历时间 + 日桶"**：甘特里 `SPEC26AA4855-1 / 1d` 的时间是 `10-22 21:49 → 10-23 21:49`（精确 24h），短活动是 `02h`。没有 08:00–18:00 工作时段的概念，设备可以跨夜占用。

---

## 2. 客户侧对象模型（从数据反推）

```
Project / activity: [0-1] ALL-Ops Support-Affiliates Manufacturing Plants
└─ PLAN26AA1126-1                    ← 排程批次（一次预订），甘特里聚合多个 spec
   ├─ SPEC26AA4855-1   [Finalized]    ← 测试规范 = 一个测试请求的实例（带版本）
   │  └─ TD1&2- Salt mist            ← Spec activity：Performance measure / EQPT25AA1100 / 1d
   │  └─ (Test execution)            ← 执行活动，可能另有资源
   └─ SUBS26AA0727-1   [Finalized]    ← 分包 spec（外送实验室）
      └─ 261019.025158.039628.1      ← Test execution
```

### 2.1 编号规则（客户主数据口径）

| 前缀 | 例子 | 含义 | 我们现在的对应 |
|---|---|---|---|
| `PLAN` | `PLAN26AA1126-1` | 排程批次/预订号，`YY + AA + 序号 + 版本` | 有 `test_plan`，但 ID 是 `PLAN-<taskId>-<n>`，**格式不对** |
| `SPEC` | `SPEC26AA4855-1` | 测试规范实例（主排程对象） | 我们有 `test_no = SUBS26AA0531`（**用了 SUBS 前缀却当 spec 用**，语义错） |
| `SUBS` | `SUBS26AA0727-1` | 分包 spec | **完全没有** |
| `EQPT` | `EQPT25AA1100` | 设备主数据 | 我们是 `EQ-007`，无 EQPT 编码列 |
| `PVP` | `PVP No.`（模板列） | 待确认 | 无 |
| `SPEC / Object` | `Object ID` + `Object Version` / `Test Spec Id` + `Test Spec Version` | 对象与版本**双字段** | **完全没有版本概念** |

### 2.2 状态机（10 态，客户真实值域）

| 状态 | 文件 2 计数 | 有预计日期 | 我们对应 | 说明 |
|---|---|---|---|---|
| `Draft` | 17 | 0 | `Ready`/`Needs Method Review`（混用） | 未提交，不可排 |
| `In approval` | 2 | 0 | `Needs Method Review` | 审批中，不可排 |
| `Approved` | 6 | 6 | — | **可进入排程池** |
| `Pre-booked` | 1 | 1 | `Task Type = Prebook`（语义冲突！） | 已占位未开工 |
| `Finalized` | 13 (1 无日期) | 12 | `Ready` | 计划已锁定 |
| `In progress` | 2 | 2 | — | 执行中 |
| `Test results in approval` | 1 | 1 | — | 结果审批 |
| `Report in approval` | 1 | 1 | — | 报告审批 |
| `Completed` | 6 | 6 | — | 完成 |
| `Cancelled` | 1 | 1 | — | 取消 |

我们只有 `Ready` / `Needs Method Review` 两个业务态 + 方案态 `candidate/confirmed/superseded`。**客户的状态机前后各有 4 个态我们没有**（审批 2 个、结果/报告 2 个），中间还少"已占位"。

### 2.3 字段字典（客户 32 列 → 覆盖率 → 我们的对应）

| 客户字段 | 覆盖率 | 含义 | 原型对应 | 判定 |
|---|---|---|---|---|
| `Object ID` / `Object Version` | 100% | 对象与版本 | 无 | **新增** |
| `Test Spec Id` / `Test Spec Version` | 100% | 规范与版本 | `task.test_no`（误用 SUBS 前缀） | **改造** |
| `Project or activity` | 96% | `[0-1] 项目名` 或空 | `project_name` | 保留，允许空 |
| `EOTP cost code` / `Description` | 96% | 成本中心（本案全是 `ZZZ/ZZZZ`） | 无 | 新增（可空） |
| `Origin of need` | 96% | 需求来源（Product/Structure/Component verification、Validation plan、Surveillance） | 无 | **新增**（排程分组维度） |
| `Title` | 98% | 名称（本案多为噪音） | `task_name` | 保留但**不可用于匹配** |
| `Status` | 100% | 10 态（见 2.2） | `Ready` 等 2 态 | **新增状态机** |
| `Created_by` / `Team` / `Approver` | 100/100/58% | 创建人/团队/审批人 | 无 | 新增 |
| `Testers` | 58% | 执行人（可为 `TST BY SLT10`、`Performance measure` 这类**角色占位**） | `person.qualifications` 反查 | **改造**：人员是"分配结果"不是"资格条件" |
| `Standards` | 16% | 标准号，如 `2131, DIN VDE 0620-1` | `method_code` | **新增**（真正的匹配键） |
| `Competency External ID` | 18% | 能力项外部 ID，逗号并列 | `required_qualifications`（自由文本） | **改造**：升级为能力目录 |
| `Competency Type/Domain/Sub Domain/Sub Domain2/Description` | 10–22% | 能力 5 级分类，**与 ID 逐位对齐的并列数组** | 无 | **新增**（结构见 2.4） |
| `Estimated starting date` / `end date` | 60% | 计划窗口（日期粒度） | `requested_start` + `due_date` | **改造**：客户是"起止窗口"，我们只有"截止" |
| `Global test status` | 42% | 结果（`Passed`） | 无 | 新增（结果阶段） |
| `Instockdate` | 42% | **样品到位日期（真实字段！）** | `prototype_upgrade.json` 的人工假设 | **P0**：把假设换成事实 |
| `Workload` | 100% | 恒 0 | `estimated_effort_hours` | **P0**：不可依赖 |
| `Test equipment external ID` | 0% | spec 头无设备 | `required_equipment_ids` | 改到 activity 层 |
| `Total nb of samples` | 100% | 样品数（1 ~ 1296） | `sample.required`（假设值） | **改造** |

### 2.4 能力（Competency）模型

```
Competency External ID : "Test_Sub_External_ID, Test_New_External_ID"
Competency Type        : "Test, Test"                 ← 与上列逐位对齐
Competency Domain      : "Test Domain in KarenTestLab, Test_New_Domain"
Competency Sub Domain  : ...
Competency Sub Domain2 : ...
Competency Description : ...
```

要点：**多值 + 并列数组 + 5 级分类 + 外部 ID**。我们当前是 `required_qualifications = "HPLC Level 2; Sample Prep"`（分号自由文本，人员身上挂同名串）。这在客户数据上无法对接，也无法表达"同一 spec 需要多项能力、缺一项即不合格"。

另外文档里出现 `Test_competency_ON` / `Test_competency_OFF` 两个 spec —— 说明客户有**"是否校验能力"的开关**：`OFF` 的 spec 即使没有能力项也可以排。我们现在的规则是"缺资质一律阻塞"，方向相反。

### 2.5 输出模板（`Planning` sheet）：客户要的到底是什么

19 个业务列 + 52 周 × 2 段（104 个周列），外加 11 组条件格式、"Current week"、"Week⇒Date / Date⇒Week" 双向换算表、`WARNING: lower limit = 1400` 阈值提醒。

| 列 | 含义 | 我们能否直接填 | 缺口 |
|---|---|---|---|
| `Order` | 订单号 | ✅ `order.id` | — |
| `Project` | 项目 | ✅ | — |
| `Plan No.` | **排程批次号** `PLAN26AA…` | ⚠️ 有 test_plan，ID 格式不符 | 编号规则 |
| `LIMS No.` | **spec 号** | ⚠️ 有 `test_no`，但值是 `SUBS…` | spec 与 SUBS 未区分 |
| `Equipment` | 设备 | ✅ 改造后可 | 需 `EQPT…` 编码 |
| `PVP No.` | 待确认（产品验证计划？） | ❌ | **需客户确认** |
| `Sample No.` | 样品编号 | ❌ 我们只有"数量" | 样品主数据 |
| `A/& SMPL` | 待确认 | ❌ | **需客户确认** |
| `Priority` | 优先级 | ⚠️ 词表不一致（P0-2） | 词表对齐 |
| `Sequence` | **周内执行序号** | ❌ | **新增** |
| `Test` | 测试/活动名 | ✅ activity 名 | — |
| `Resource` | 设备资源 | ✅ | — |
| `Who` | 执行人 | ✅ | — |
| `Cube` | 待确认（工位/舱位？） | ❌ | **需客户确认** |
| `Workload` | 工作量 | ⚠️ 恒 0 / 我们的 h | 单位与来源 |
| `Week` | **周号（1–52）** | ❌ | **新增周桶** |
| `Sta` + `tus`（两个窄列，各约 3.7 字符宽） | **2 字符状态码**：图例 `L / l`、`F / f`、`ST` ↔ `Not delivered / Delivered / Done / Subcontracted` | ❌ 词表完全不同 | 状态值域映射 |
| `Event date` | 事件日期 | ✅ 计划日期 | — |

图例还有两个维度：`Test performed at Amplitude` / `Volta`（**两个站点**）、`LIMS task` / `Team task`（**内部任务 vs 团队任务**）。→ 我们是单实验室、单一任务类型，两个维度都没有。

### 2.6 一条容易忽略的线索：这套表的术语是"法系"的

`EOTP cost code`、`PVP No.`、`Not delivered / Delivered / Done` 对应状态码 `L / F / ST`，再加上表尾 `# Public` 页脚 —— 状态码极可能是 **Livré（已交付）/ Fait（已完成）/ Subcontracté（分包）** 的缩写。

对我们的直接影响：
1. **术语表必须先对齐再改模型**。把 `LIMS No.` 翻成"任务号"、把 `Pre-booked` 当成我们的预约规则，都是这类错误；客户看到中文标签与自家表不一致，会直接判定"没读懂业务"。
2. 状态是**两字符枚举**，不是长文本。我们 UI 上一律渲染中文长标签，需要在 `locale` 里做 `code ↔ 中文 ↔ 客户缩写` 三层映射。
3. `Done`（完成）与 `Delivered`（交付）是两个不同事件 → 我们的 `Completed` 单态不够，至少需要 `执行完成` 与 `报告交付` 两个时间点（这也对应 spec 状态机里的 `Report in approval` / `Completed`）。

---

## 3. 原型现状（一句话版）

| 层 | 现在是什么 |
|---|---|
| 数据 | 12 个 CSV：`test_tasks`(8)、`templates`(6)、`test_requests`(12)、`equipment_resources`(8 设备 + 3 空间)、`persons`(6)、`constraints`(11)、`historical_schedules`(12)、`candidate_schedules`(10)、`daily_schedule_allocations`(56) + `prototype_upgrade.json`（样品/Task Type 假设） |
| 模型 | `project → task → plan`；task 上挂 `required_equipment_ids` / `required_qualifications` / `effort_hours` / `due_date` |
| 规则 | 11 条硬/软约束（CSV 里 HC-001~006、SC-001~005，HC-007 样品到位在升级层代码里），确定性引擎，`confirmed:false` 标注齐全 |
| 工具 | 21 个 `lims_*`（overview / tasks / projects / plans / test-plan / orders / change / downtime / bottlenecks / policies / drafts / confirm …） |
| UI | 10 个一级页：概览 / 订单 / 项目 / 任务 / 排程 / 影响 / 资源 / 分析 / 自定义 / 审计；3 个角色视图 |

强项（这些不要动）：确定性可行性判定、约束可解释、变更/停机影响分析、审计事件、`confirmed:false` 的诚实标注、卡片可引用追问。**这些客户那张 Excel 一点都没有**，也是我们的差异点。

---

## 4. 差异矩阵

| 维度 | 客户真实 | 原型现状 | 判定 | 优先级 |
|---|---|---|---|---|
| 排程原子 | `SPEC → Activity`（1 spec 多活动） | `task`（1 任务 = 1 次设备占用） | **改造** | P0 |
| 批次对象 | `PLAN26AA…` 聚合多个 spec | `test_plan`（按模板分组） | 改造 + 改编号 | P1 |
| 分包 | `SUBS…` + `Test execution` 活动 | 无 | **新增** | P1 |
| 版本 | 对象版本 + spec 版本 | 无 | 新增 | P2 |
| 状态机 | 10 态，审批是排程门槛 | 2 态 + 方案态 | **新增** | P0 |
| 时间粒度 | 日桶 / 24h 日历 / `1d` `02h` | 分钟级 + 08:00–18:00 工作时段 | **新增日历模式** | P1 |
| 输出形态 | 周号 + 周内序号 + 工作量，回填 Excel | ISO 时间戳 + 甘特图 | **新增周计划导出** | P0 |
| 交期 | 起止窗口（可空） | `due_date` 必填 | **改造** | P0 |
| 工时 | `Workload` 恒 0 | `effort_hours` 必有 | **改造**（可空 + 默认值推导） | P0 |
| 设备 | activity 级 `EQPT…` | task 级 `EQ-…` | **改造** | P0 |
| 人员 | `Testers` 分配结果（可为角色占位） | 资质匹配结果 | **改造** | P1 |
| 资质 | 能力目录（外部 ID + 5 级）+ ON/OFF 开关 | 自由文本资格串 | **改造** | P1 |
| 标准 | `Standards`（16% 覆盖） | `method_code` | 新增字段 | P1 |
| 样品 | `Instockdate` + `Total nb of samples` | 人工假设 JSON | **改造**（换事实） | P0 |
| 站点 | Amplitude / Volta 双站点 | 单实验室 | 新增 | P2 |
| 优先级 | 表内填写，值域未知 | `Urgent/High/Normal/Low`，数据里还有 `Routine` | **先修一致性** | P0 |
| 结果/报告 | `Global test status`、Report in approval | 无 | 新增 | P2 |
| 成本中心 | `EOTP cost code` | 无 | 新增（低优先） | P2 |

---

## 5. 六个会当场暴露的冲突（含证据）

### C1 `Pre-booked` 词义撞车
客户：`Status = Pre-booked`（10 态之一，占位未开工，1/50）。
我们：`Task Type = Prebook`（独占预约规则，`prototype_upgrade.json.taskTypeRules.Prebook`）。
→ **必须改名**：规则改叫 `Reservation Mode（Exclusive / Shared）`，`Prebook` 只在"状态机"里出现。否则客户会问"Prebook 到底是状态还是规则"，我们也答不清。

### C2 `Routine` 优先级被排到最末（现存缺陷）
`lib/util.js:132` → `{Urgent:0, High:1, Normal:2, Low:3}[p] ?? 4`
`data/test_requests.csv` 有 7 行 `priority = Routine` → rank 4，**低于 Low**；前端 badge 映射里也没有 `Routine`，会渲染成未知态。
客户 `Priority` 值域还没确认，但至少要先做**统一词表 + 校验**（未知值应报错或落 `Normal`，不能静默垫底）。

### C3 交期强依赖 vs 40% 数据没有日期
`taskRisk()`、`prioritize()`、`generatePlans()` 都直接 `task.dueDate` 参与比较；`parseInstant(undefined)` 会得到 `Invalid Date`，比较结果恒 false → 排程静默错序。
客户：`Draft` 17 + `In approval` 2 = **19 个 spec 无日期**，且按业务就不该排。
→ 需要"可空交期 + 未通过审批不进池"两道闸。

### C4 工时假设不成立
客户 `Workload` 恒 0；设备绑定 0 条。我们的 `effort_hours` 是手工填的，模板里 `test_duration_min` 也只有 6 条。
→ 需要三级回退：`activity 标准工时` → `同模板历史实际时长（historical_schedules）` → `人工补录 + 标记未确认`。

### C5 时间语义
客户甘特：`10-22 21:49 → 10-23 21:49 / 1d`、`02h`。我们的引擎严格限制在 `08:00–18:00`，`HC-005 工作时段` 是硬约束。
→ 客户的"1d"是日历日，"2d"可能跨夜；气候箱类 24h 设备我们已有 `00:00–23:59`，但引擎没有"跨夜/多日连续占用"模型。这会让"我们算出来 3 天，客户表里 1 天"直接对不上。

### C6 拆解层错位
我们：`request → task`（`lims_prepare_task_draft`）——**把请求拆成任务**。
客户：`spec` 已经是可直接排程的对象（有状态、有窗口、有 tester），真正需要拆的是 `spec → activities`（`TD1&2- Salt mist` 这种来自标准条目的活动）。
→ `prepare_task_draft` 的定位要改成"**spec 缺字段补全 / 活动拆解**"，而不是"凭空造任务"。同时 `draft.templateId` 直连 `templates` 的做法，要换成"标准 → 活动序列"。

---

## 6. 本目录插件需要更新的地方（文件级）

### 6.1 `agentic-lims/data/` — 数据层

| 动作 | 文件 | 改什么 | 为什么 |
|---|---|---|---|
| **新增** | `specs.csv` | 客户 32 列（Object/Version、Spec Id/Version、Project、Origin、Status、Testers、Standards、Competency*、Est start/end、Instockdate、Samples、Workload） | 客户的主对象是 spec，不是 task |
| **新增** | `spec_activities.csv` | `spec_id, plan_no, activity_no, activity_name, activity_type(Spec activity / Test execution), equipment_id, person_id, duration, duration_unit` | 甘特真实层级，设备在这里 |
| **新增** | `plans.csv` | `plan_no(PLAN26AA1126-1), project, spec_ids[], window_start/end` | `Plan No.` 是客户回填第一列 |
| **新增** | `competencies.csv` | `competency_id, type, domain, sub_domain, sub_domain2, description` | 能力目录 + 5 级分类 |
| **新增** | `subcontracts.csv` | `subs_id, parent_spec, vendor, duration` | `SUBS` 对象 |
| **改** | `test_tasks.csv` | `due_date` 可空；加 `spec_id, plan_no, origin_of_need, standards, activity_type`；`estimated_effort_hours` 可空 | C3 / C4 / C6 |
| **改** | `equipment_resources.csv` | 加 `equipment_external_id(EQPT…), site(Amplitude/Volta), calendar_mode(workday/24h)` | F7 / 双站点 |
| **改** | `persons.csv` | `qualifications` 由字符串改为 `competency_ids[]` | 2.4 |
| **改** | `test_requests.csv` | `Routine` → 统一词表；加 `spec_status`、`instock_date`、`samples` | C2 / 2.3 |
| **改** | `prototype_upgrade.json` | 样品段从"逐任务假设"改为"读 `Instockdate`，缺值才退回假设"；`taskTypeRules` → `reservationModes` | P0：把假设换成事实 |

### 6.2 `lib/model.js`

- 新增 `normalizeSpec()` / `normalizeActivity()` / `normalizePlan()` / `normalizeCompetency()`，buildDomain 里挂 `domain.specs / specById / activities / plans / planById / competencies`。
- `normalizeResource()` 加 `externalId / site / calendarMode`。
- `normalizePerson()` 把 `qualifications: string[]` 换成 `competencyIds: string[]`，保留 `qualifications` 兼容字段一版。
- `taskReadiness()` 增加两个前置：`spec.status ∉ {Approved, Pre-booked, Finalized}` → `not_schedulable`；`dueDate == null` → `no_window`。
- `taskRisk()` / `prioritize()` 处理空交期（按 `plan.window` 或 `requested_start` 兜底，不能 `Invalid Date`）。
- 新增 `specLifecycle(spec)` 输出 10 态 + 是否可排 + 缺什么字段。
- 新增 `weeklyBuckets(specs, activities, weeks)` 生成周桶（周号、周内序号、周内工作量）。

### 6.3 `lib/upgrade.js`

- `resolveTaskType()` → 拆分：`resolveReservationMode()`（规则）+ `resolveSpecStatus()`（状态）。`Pre-booked` 只出现在状态机。
- `resolveSample()` 改为三级来源：`spec.instockDate（事实）` > `config.samples[taskId]（假设）` > `unknown`，并保留 `source` 字段（`spec-export` / `prototype-assumption` / `missing`）。
- 新增 `capabilitySwitch(spec)`：`Test_competency_ON/OFF` → 决定能力缺失是"阻塞"还是"仅提示"。
- `deriveOrders()` 的 `ORDER_LINK_MAX_DAYS = 21` 推断规则要加一条**防御**：当标题重复率 > 30%（客户数据 48%）时禁用名称匹配，只按 `spec_id` 直连，其余标记 `no-link`。

### 6.4 `lib/engine.js`

| 改动 | 说明 | 量级 |
|---|---|---|
| 日桶模式 | `policy.calendarMode = 'day'`：以天为排程单位，输出 `Week + Sequence + Workload`，保留现有分钟级模式做"精确视图" | 中 |
| 跨夜/多日连续占用 | 支持 `durationUnit = 'd'` 的设备占用跨越日历日 | 中 |
| PLAN 批量分组 | 已有 `generateTestPlan()` 的批次避让逻辑可复用，但要按 `planNo`/`PVP`/同一设备族分组，输出 `PLAN26AA…` 格式编号 | 小 |
| 周内排序 | `Sequence` = 同周同资源内的执行顺序（优先级 → 交期 → 已开始优先） | 小 |
| 周产能阈值 | `WARNING: lower limit = 1400` 待确认；先实现"周工作量 > 阈值时给 warning，不阻断" | 小 |
| 分包资源 | `SUBS` 作为虚拟资源（外送实验室，日历长、容量大）参与排程 | 小 |
| 空交期 | 无窗口的任务不进主流程，单独列 `unschedulable` 诊断 | 小 |

### 6.5 `lib/tools.js`（21 个工具）

| 工具 | 动作 |
|---|---|
| `lims_overview` | 加 spec 状态分布、待审批数量 |
| `lims_list_tasks` / `lims_get_task` | 输出 spec 号、plan no、activity、周号、序号 |
| **新增** `lims_list_specs` / `lims_get_spec` | 按状态/标准/能力查 spec，含生命周期与缺字段 |
| **新增** `lims_week_plan` | 给周号，返回该周排程行（19 列等价物），这是客户最常问的"下周怎么排" |
| **新增** `lims_export_plan_grid` | 输出可回填 `Planning` sheet 的行（CSV/XLSX） |
| `lims_prepare_task_draft` | 语义改为"spec 补全 + spec→activity 拆解"（C6） |
| `lims_create_task_draft` | 写入 `specs` + `spec_activities`，不再只写 `raw_tasks` |
| `lims_explain_resource` | 加 `EQPT` 外部编码与站点 |
| `lims_list_policies` | 规则版本里区分 `Reservation Mode` 与 `Spec Status Machine`，都标 `confirmed:false` |

### 6.6 `lib/routes.js`

- 新增 `/api/lims/specs`、`/api/lims/spec`、`/api/lims/week-plan`、`/api/lims/plan-grid`、`/api/lims/competencies`。
- `/api/lims/orders` 的 spec 投影补齐客户字段（status、standards、instock、samples）。
- `/api/lims/test-plan` 返回值加 `planNo` + 周号。

### 6.7 `client.js`（右侧边栏）

| 页面 | 改动 |
|---|---|
| 订单 | 从"订单列表"升级为 **Spec 生命周期看板**（10 态泳道 + 阻塞原因），`Draft/In approval` 明确标"不可排" |
| **新增"周计划"页** | 复刻 `Planning` 表：19 列 + 周列 + 优先级/序号 + 工作量热力；这是最能让客户"认出自己系统"的一页 |
| 项目 | 改四层折叠 `Project → PLAN → SPEC → Activity` |
| 排程 | 甘特保留，但加"日桶/精确"切换与 `Sequence` 列；图例补 `Amplitude/Volta`、`LIMS task/Team task`、`Not delivered/Delivered/Done/Subcontracted` |
| 资源 | 设备显示 `EQPT…` 外部编码与站点；24h 设备用连续条 |
| 概览 | 加"待审批 spec 数"（对应客户 19/50 无日期） |
| 审计 | 事件加 `spec_id` / `plan_no` |

### 6.8 其它

- `locale/zh.json`：新增术语表 `LIMS No. / PVP No. / Sample No. / Cube / Workload / Sequence / Pre-booked / Subcontracted`，**中英对照必须与客户表格一致**（客户是双语表格，术语不一致会被当成不懂业务）。
- `README.md` + `agentic-lims/README.md`：重写"引擎假设"章——从"任务级小时装箱"改为"spec 级日桶 + 可回填"；"已知边界"追加"两份导出不可 join"。
- `setup.sh` / `scripts/reseed-demo.mjs`：新集合入 `raw_*`，并加 `--customer-sample` 开关加载客户形状样例数据。
- `demo/agentic-lims-demo-script.md`：演示口径从"帮我排 TASK-2005"改成"帮我排下周的 spec 并回填 Planning 表"。

**粗估**：P0 约 4–5 人日，P1 约 8–10 人日，P2 约 6–8 人日。P1 里的"日桶模式 + 周计划页"是最大块。

---

## 7. 建议的目标模型（草案）

```js
// specs
{ specId:'SPEC26AA4855', version:1,
  project:'[0-1] ALL-Ops Support-Affiliates Manufacturing Plants', originOfNeed:'Product verification',
  title, status:'Finalized',               // 10 态机
  team, createdBy, approver, testers:[{name, source:'assigned'|'role-placeholder'}],
  standards:['2131','DIN VDE 0620-1'],
  competencies:[{externalId, type, domain, subDomain, subDomain2, description}],
  capabilityCheck:true|false,               // Test_competency_ON/OFF
  window:{ start:'2026-06-28', end:'2026-06-29' } | null,
  sample:{ instockDate:'2026/04/28', count:1296, source:'spec-export' },
  workload:null,                            // 客户当前恒 0，null 比 0 诚实
  equipmentExternalId:null,                 // spec 头通常为空
}

// spec_activities（真正的排程原子）
{ specId, planNo:'PLAN26AA1126-1', seq:1,
  name:'TD1&2- Salt mist', type:'spec-activity'|'test-execution',
  equipment:{ externalId:'EQPT25AA1100', name:'new equipment for calendar_002' },
  person:{ name:'Performance measure', kind:'role-placeholder' },
  duration:{ value:1, unit:'d' },           // 保留原始单位，不做隐式换算
  start:'2026-10-22T21:49+08:00', end:'2026-10-23T21:49+08:00',
}

// plan_grid_row（回填 Planning 表的一行）
{ order, project, planNo, limsNo, equipment, pvpNo:null, sampleNo:null,
  priority, sequence, test, resource, who, cube:null, workload, week, status, eventDate,
  fillable:{ planNo:true, pvpNo:false, sampleNo:false, cube:false, status:'value-not-in-customer-vocabulary' } }
```

`fillable` 是关键：**能填的填，不能填的显式标"缺主数据"**，不要用 0 或空字符串糊过去——客户一眼能看出我们是否真的懂他们的表。

---

## 8. 输出回填映射（示例）

`docs/planning-grid-sample.xlsx`（本次生成）把原型 3 条任务按客户模板的 19 列填了进去，用来验证"哪些列能填、哪些不能"，文件中第二个 sheet 逐列写了说明。

| 分类 | 数量 | 列 |
|---|---|---|
| 能直接填 | 7 | Order / Project / Equipment / Test / Resource / Who / Event date |
| 需改造后才能填 | 4 | Plan No.（编号规则）/ LIMS No.（SPEC vs SUBS）/ Priority（词表）/ Workload（单位与来源） |
| 引擎能算、但字段还没建 | 2 | Sequence（周内序号）/ Week（周号） |
| 缺客户主数据 | 4 | PVP No. / Sample No. / A& SMPL / Cube |
| 值域无法映射 | 1 | `Sta`+`tus`（L/l、F/f、ST 状态码） |

即：**18 个逻辑列里只有 7 列现在能如实回填**。这个比例本身就是要跟客户讨论的重点——不是我们算不出来，而是他们的主数据（PVP/样品/Cube）我们还没有。

---

## 9. 分期落地

| 期 | 内容 | 验收 |
|---|---|---|
| **P0**（1 周） | 词表与语义修复（C1/C2）、空交期与状态准入（C3）、`Instockdate` 事实化（C4）、spec/activity 只读投影、`fillable` 标记 | 导入客户 50 条 spec 不崩；`Routine` 不再垫底；无日期 spec 显式"不可排"；能回答"哪些 spec 因为缺日期/未审批不能排" |
| **P1**（2–3 周） | 日桶引擎 + 周内 Sequence + `PLAN` 编号、周计划页、`lims_week_plan`、`plan-grid` 导出、能力目录与 ON/OFF | 能给出一周计划并回填进客户模板；能力 OFF 的 spec 不被误判阻塞 |
| **P2**（2 周） | 分包资源、双站点、结果/报告状态、对象版本、成本中心 | 甘特能显示 `SUBS` 与 `Amplitude/Volta` |

---

## 10. 必须找客户确认的 12 个问题（不确认就会猜错）

| # | 问题 | 不确认的后果 |
|---|---|---|
| 1 | `PVP No.` 是什么编号？（产品验证计划？） | 输出表缺一列主键 |
| 2 | `A/& SMPL` 两列是什么？`&` 是"部分到样"吗？ | 无法判断样品齐套 |
| 3 | `Cube` 是工位、舱位还是容积？ | 无法做空间约束 |
| 4 | `WARNING: lower limit = 1400` 是周/年工时阈值还是样品数？ | 产能校验没有依据 |
| 5 | `Priority` 与 `Sequence` 的取值域和填写规则（谁填、何时填） | 排序结果无法对齐他们的直觉 |
| 6 | `Pre-booked` 的业务含义：是"已占设备"还是"已确认计划"？ | 与我们的 Prebook 规则再次混淆 |
| 7 | `Spec activity` 与 `Test execution` 的区别（前者=性能测量，后者=执行记录？） | 活动拆解层级会错 |
| 8 | `SUBS` 与 `SPEC` 是同一对象的不同类型，还是独立对象？ | 分包建模方式 |
| 9 | `Workload` 恒 0 是"未使用"还是"这批数据没填"？单位是 h 还是人日？ | 工时回退策略 |
| 10 | 排程时间语义：日历日 24h，还是有工作时段？气候箱是否独占周末？ | 我们算的天数天生对不上 |
| 11 | `Test_competency_ON/OFF` 是实验室级开关还是 spec 级？OFF 时是否真的跳过资质校验？ | 资质硬约束会误阻塞 |
| 12 | `Amplitude` / `Volta` 是两个实验室还是两个楼层？共享设备池吗？ | 双站点模型 |

补充两个"数据本身"的问题：**两份导出无法 join（交集 0）是环境差异还是时段差异？正式对接时以哪个为准？** 以及**客户是否希望我们把结果回填到这张 Excel，还是走 API 写回 LIMS？**

---

## 附录 A：覆盖率统计（文件 2，n=50）

```
Object/Spec ID/Status/Created_by/Team/Workload/Samples   100%
Title 98% ｜ Project + cost code + origin 96%
Est start/end 60% ｜ Testers 58% ｜ Approver 58%
Global test status 42% ｜ Instockdate 42%
Competency Type 22% ｜ Competency External ID 18% ｜ Standards 16%
Test equipment external ID 0%（设备只在 activity 层）
Workload 值域 = {0}（100%）
标题重复 24/50
```

## 附录 B：核对方式

- 用 `pandas` + `openpyxl`/`xlrd` 读三个 xlsx 与一个 xls，逐列统计非空率、值域、跨文件交集。
- `Planning` sheet 用 `openpyxl` 读值 + 直接解包 `xl/worksheets/sheet1.xml` 看 `dimension=A1:DY1517`、`_FilterDatabase=A10:S1308`、11 组 `conditionalFormatting`、无 `dataValidation`/无公式 → 判定为**带样式的空模板**。
- 甘特按缩进层级还原为 `Project → PLAN → SPEC/SUBS → Activity` 四层，统计 16 个 `SPEC` + 3 个 `SUBS`、15 条 `Spec activity`、6 条 `Test execution`、唯一资源 `EQPT25AA1100`。
