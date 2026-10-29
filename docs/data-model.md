# Agentic LIMS 数据模型（客户口径）

> 版本：2026-10-29 ｜ 口径来源：客户脱敏导出（SPEC 主数据 / 甘特 / 排程回填模板）
> 变更说明：本版把排程对象从 **task** 改为客户的 **SPEC → 规格活动 → PLAN 批次**，规则与约束同步重写。UI 仍按上一版结构渲染，界面改造在下一阶段。

---

## 1. 一句话结构

```
Project / activity   ──  SPEC 表头上的项目字段（可为空）
  └─ PLAN26AA1126-1  ──  排程批次（一次预订），聚合多个 SPEC
     ├─ SPEC26AA4851      ── 测试规范实例（状态机准入）
     │   ├─ SA26AA4851-01  规格活动：盐雾 / EQPT25AA1100 / 1d / 能力项 ENV-SALT
     │   ├─ SA26AA4851-02  规格活动：冷态电压降 / EQPT25AA1101 / 1d
     │   └─ SA26AA4851-03  规格活动：Laserbay / EQPT25AA1103 / 02h
     └─ SUBS26AA0720      ── 分包 SPEC → 只能占用 VENDOR 资源
```

**只有"规格活动"能被排程。** SPEC 是准入与追溯对象，PLAN 是批次号，`test_execution` 行只是执行记录（不参与排程）。

---

## 2. MongoDB 存储

主键写在 `_id` 上，便于幂等 upsert。

| 集合 | 来源 CSV | 主键 | 行数 | 说明 |
|---|---|---|---|---|
| `raw_specs` | `specs.csv` | `spec_id` | 19 | 测试规范（客户 32 列的归一化版） |
| `raw_spec_activities` | `spec_activities.csv` | `activity_id` | 17 | 规格活动：11 条可排 + 6 条不排（4 条执行中/已完成/已取消 + 2 条 `test_execution` 记录） |
| `raw_plans` | `plans.csv` | `plan_no` | 4 | PLAN 批次 |
| `raw_standards` | `standards.csv` | `standard_id#activity_no` | 9 | 标准 → 活动步骤（4 个标准） |
| `raw_competencies` | `competencies.csv` | `competency_id` | 8 | 能力目录（外部 ID + 5 级分类） |
| `raw_equipment` | `equipment_resources.csv` | `resource_id` | 9 | 设备 6（含 1 台在检）+ 工位 2 + 分包商 1 |
| `raw_persons` | `persons.csv` | `person_id` | 5 | 人员 + 能力项 + 站点 |
| `raw_constraints` | `constraints.csv` | `constraint_id` | 18 | 11 条硬约束 + 6 条软约束 + 1 条前处理 |
| `raw_allocations` | `daily_schedule_allocations.csv` | `allocation_id` | 8 | 既有占用（执行中 / Pre-booked / 分包） |
| `raw_history` | `historical_schedules.csv` | `history_id` | 7 | 历史实际时长（工时回退来源） |
| `raw_person_activities` | `person_activities.csv` | `activity_id` | 3 | 培训/审核/保养占用 |
| `raw_assignments` | `resource_assignments.csv` | `assignment_id` | 3 | 资源分配记录 |
| `lab_rules` | `lab_rules.json` | `lab-rules-v1` | 1 | 规则层（状态机 / 预约模式 / 优先级词表 / 日历 / 工时策略） |
| `sample_status` | 运行时 | `taskId` | 0 | 样品变更覆盖（只有变更事件才写） |
| `task_overrides` | 运行时 | `taskId` | 0 | 交期/优先级变更覆盖 |
| `plans` / `test_plans` / `audit_events` / `change_events` / `workspace` | 运行时 | — | — | 候选方案、测试计划、审计、变更、工作区状态 |

幂等：`seedDatabase` 按 `_id` 插入；`force` 会先清空上述 `raw_*`（含旧版遗留集合），可直接重置。

---

## 3. 字段字典

### 3.1 `raw_specs`

| 字段 | 类型 | 说明 | 客户对应 |
|---|---|---|---|
| `spec_id` | string | `SPEC26AA4851` / `SUBS26AA0720` | `Test Spec Id` |
| `spec_version` / `object_id` / `object_version` | int/string | 对象与版本双字段 | `Object ID` / `Object Version` / `Test Spec Verison` |
| `order_no` | string? | 订单号，**来自排程回填表 Order 列**，LIMS 导出没有 | `Order` |
| `project` | string? | `[0-1] ALL-Ops…`，可为空（客户 2/50 为空） | `Project or activity` |
| `origin_of_need` | string? | Product/Structure/Component verification、Validation plan、Surveillance | `Origin of need` |
| `title` | string? | 名称。**不可用于匹配**（客户 48% 重复） | `Title` |
| `status` | string | 11 态之一，见 §4 | `Status` |
| `team` / `created_by` / `approver` | string? | 团队与人员 | `Team` / `Created_by` / `Approver` |
| `testers` | string | `;` 分隔；可能是角色占位符（`TST BY SLT10`） | `Testers` |
| `standards` | string | `;` 分隔标准号 | `Standards` |
| `competency_ids` | string | `;` 分隔能力项 ID | `Competency External ID` |
| `competency_check` | `ON`/`OFF` | 能力校验开关；OFF 时不硬校验 | `Test_competency_ON/OFF` |
| `est_start_date` / `est_end_date` | date? | 计划窗口；**两者都有才可排** | `Estimated starting date/end date` |
| `instock_date` | date? | 样品到位日期（事实） | `Instockdate` |
| `sample_count` | int | 样品数（1 ~ 1296） | `Total nb of samples` |
| `workload_hours` | number | 客户该列恒 0，保留原值不做解释 | `Workload` |
| `priority` | string? | `P1..P4` 或历史别名 `Routine` | `Priority`（排程表） |
| `priority_source` | string | `planner-grid` / `legacy-import` / `unset` | — |
| `plan_no` | string? | 所属 PLAN 批次 | `Plan No.` |
| `cost_code` / `created_at` / `note` | — | 成本中心、创建时间、备注 | `EOTP cost code` 等 |

### 3.2 `raw_spec_activities`

| 字段 | 说明 |
|---|---|
| `activity_id` | `SA26AA4851-01`（原型内部 ID，客户无此对象） |
| `spec_id` / `plan_no` | 归属 |
| `activity_no` | SPEC 内的活动顺序（1..n） |
| `activity_name` | 客户甘特里的活动名，如 `TD1&2- Salt mist` |
| `activity_type` | `spec_activity` / `test_execution` / `subcontracted` |
| `resource_id` | `EQPT…` 或 `VENDOR-EXT-01` |
| `cube_id` | 前处理工位 `CUBE-A1` / `CUBE-V1` |
| `person_id` | 已分配人员（可为空，由引擎分配） |
| `duration_value` / `duration_unit` | 客户原始时长：`1` + `d`、`2` + `h` |
| `effort_hours` | 工时。**标准活动留空**，由标准推导；分包/记录行才填 |
| `sequence_in_week` | 周内序号（客户 `Sequence` 列，待 UI 阶段启用） |
| `start_datetime` / `end_datetime` / `status` | 已排/已执行的时间与状态 |
| `standard_id` | 关联标准（`STD26AA0001`） |
| `site` | `AMPLITUDE` / `VOLTA` / `EXTERNAL` |

### 3.3 其它

- `raw_standards`：`standard_id, standard_code, standard_title, activity_no, activity_name, equipment_type, competency_id, prep_minutes, test_minutes, duration_label, site`。一个标准 = 多行活动步骤。
- `raw_competencies`：`competency_id, external_id, competency_type, domain, sub_domain, sub_domain2, description`。
- `raw_equipment`：`resource_id, resource_kind(equipment|space|subcontract), equipment_type, site, capabilities, status, calibration_due, calendar_mode(workday|24h), available_from/to, max_concurrent_tasks, lead_time_days, external_label`。
- `raw_persons`：`person_id, person_name, employment_type, team, site, competency_ids, daily_capacity_hours, workday_start/end, weekend_allowed, status`。
- `raw_plans`：`plan_no, project, site, plan_status(Draft|Firm), created_by, window_start/end, spec_ids, note`。

---

## 4. SPEC 状态机（11 态）

| 状态 | 阶段 | 可排 | 含义 |
|---|---|---|---|
| `Draft` | request | ✗ | 草稿，客户 100% 无日期 |
| `In approval` | request | ✗ | 审批中 |
| `Approved` | planning | ✓ | 进入排程池（需有计划窗口） |
| `Pre-booked` | booked | ✓ | **已占位**（是状态，不是预约规则！） |
| `Finalized` | booked | ✓ | 计划已定稿 |
| `In progress` | executing | ✗ | 执行中（已产生占用） |
| `Test results in approval` | post | ✗ | 结果审批 |
| `Report in approval` | post | ✗ | 报告审批 |
| `Completed` | closed | ✗ | 完成 |
| `Cancelled` | closed | ✗ | 取消 |
| `Unknown` | unknown | ✗ | 导出里出现未登记状态 |

**准入门槛 = 状态 + 计划窗口**（HC-101 + HC-102）。`Approved` 但没有 `est_start/est_end` 的 SPEC（客户真实存在 1 条）不会变成任务，而是显示"缺计划窗口"。

---

## 5. 从 SPEC 投影到 task（引擎契约）

`buildDomain()` 只为满足全部条件的活动生成 `task`：

1. `activity_type !== 'test_execution'`（记录行不排）
2. `spec.status ∈ {Approved, Pre-booked, Finalized}`
3. `spec.est_end_date` 存在
4. 活动有 `resource_id` 且资源存在

投影字段：

| task 字段 | 来源 |
|---|---|
| `id` | `activity_id` |
| `specId` / `specStatus` / `planNo` / `activityNo` | SPEC 与 PLAN |
| `name` | 活动名 |
| `dueDate` | `spec.est_end_date`（交期） |
| `requestedStart` | `spec.est_start_date` |
| `effortHours` | 活动 `effort_hours` → 标准 `test+prep` 分钟 → 缺失则 0，并记 `effortSource` |
| `elapsedDays` | `duration_value` 按单位换算 |
| `requirements.competencyIds` | 标准步骤的能力项；`competency_check=OFF` 时为空 |
| `requirements.equipmentIds` / `spaceIds` | 活动的 `resource_id` / `cube_id` |
| `reservationMode` | SPEC 状态默认 → 活动覆盖 → `Shared` |
| `sample` | `spec.instock_date`（缺失 → `Unknown`，需确认） |

引擎（`lib/engine.js`）只改了三处：周末按"设备与人员都允许"开放（HC-107）、约束编号与新规则书对齐、人员活动集合改名 `personActivities`。

---

## 6. 规则层 `lab_rules.json`

| 段 | 作用 |
|---|---|
| `statusMachine` | 11 态 + 允许迁移 + `schedulableStatuses` |
| `reservationModes` | `Exclusive` / `Shared`（≤2 并发）/ `Subcontracted`，**与 `Pre-booked` 状态严格区分** |
| `reservationOverrides` | 按活动覆盖（如 Pre-booked 活动强制独占） |
| `competencyPolicy` | `hard-when-ON`；OFF 只提示；识别角色占位符 |
| `samplePolicy` | 以 `Instockdate` 为准；缺失按"待确认" |
| `calendarPolicy` | `workday 08:00-18:00` / `24h` / `extended`；周末要求设备与人员同时允许 |
| `priorityScale` | `P1→Urgent … P4→Low` + 别名（`Routine→P3`）；未知值落 `Normal` 并告警 |
| `durationPolicy` | 工时 `standard → history → manual` 三级回退（客户 Workload 恒 0） |
| `weekSequencing` | 周内排序：priority → est_end_date → activity_no（UI 阶段启用） |
| `labPolicy` | 站点、周产能阈值 1400（仅告警）、排程目标 |

全部 `confirmed: false`：这些是**从导出反推的规则**，不是客户签字确认的业务规则。

---

## 7. 约束清单（18 条）

| 编号 | 类型 | 名称 |
|---|---|---|
| HC-101 | Hard | SPEC 状态准入门槛 |
| HC-102 | Hard | 计划窗口必填 |
| HC-103 | Hard | 标准与设备能力匹配 |
| HC-104 | Hard | 能力项校验（ON 时硬校验） |
| HC-105 | Hard | 设备状态与校准 |
| HC-106 | Hard | 资源不重复占用 |
| HC-107 | Hard | 日历规则（workday / 24h / 周末） |
| HC-108 | Hard | 样品到位（Instockdate） |
| HC-109 | Hard | 分包走外送资源 |
| HC-110 | Hard | 站点隔离（Amplitude / Volta / EXTERNAL） |
| HC-111 | Hard | 前处理工位（Cube） |
| HC-112 | Hard | 预约模式（Exclusive / Shared / Subcontracted） |
| SC-101 | Soft | 交期 |
| SC-102 | Soft | 优先级与周内序号 |
| SC-103 | Soft | 负载均衡 |
| SC-104 | Soft | 切换成本 |
| SC-105 | Soft | 周产能阈值 1400（仅告警） |
| SC-106 | Soft | 计划稳定性（Firm 计划不自动移动） |

---

## 8. ID 约定

| 对象 | 格式 | 例子 |
|---|---|---|
| SPEC | `SPEC{YY}AA{序号}` | `SPEC26AA4851` |
| 分包 SPEC | `SUBS{YY}AA{序号}` | `SUBS26AA0720` |
| PLAN 批次 | `PLAN{YY}AA{序号}-{版本}` | `PLAN26AA1126-1` |
| 规格活动 | `SA{YY}AA{序号}-{活动序号}` | `SA26AA4851-01`（原型内部，客户无此对象） |
| 标准 | `STD{YY}AA{序号}` | `STD26AA0001` |
| 设备 | `EQPT{YY}AA{序号}` | `EQPT25AA1100` |
| 工位 | `CUBE-{站点首字母}{序号}` | `CUBE-A1` |
| 分包商 | `VENDOR-…` | `VENDOR-EXT-01` |

---

## 9. 与上一版（task 口径）的差异

| 动作 | 内容 |
|---|---|
| 删除 | `test_tasks.csv`、`test_requests.csv`、`templates.csv`、`prototype_upgrade.json`、`candidate_schedules.csv`、`resources.csv`；集合 `raw_tasks` / `raw_templates` / `raw_requests` / `raw_resources` / `raw_candidates` |
| 新增 | `specs.csv`、`spec_activities.csv`、`plans.csv`、`standards.csv`、`competencies.csv`、`lab_rules.json`；集合 `raw_specs` / `raw_spec_activities` / `raw_plans` / `raw_standards` / `raw_competencies` / `lab_rules` |
| 改写 | `equipment_resources.csv`（EQPT 编码 + 站点 + 日历 + 分包）、`persons.csv`（能力项 + 站点）、`constraints.csv`（18 条新规则）、`daily_schedule_allocations.csv`、`historical_schedules.csv` |
| 字段改名 | `Task Type` → `Reservation Mode`；`qualifications` → `competencyIds`（保留同义字段一版）；`requested_start`/`due_date` → `est_start_date`/`est_end_date` |

**关于 `Pre-booked`**：旧版把 `Prebook` 当预约规则。新版里 `Pre-booked` 是 SPEC 状态（已占位），预约模式是另外三个值。这是客户最容易发现的口径错误，已在系统提示与工具描述里明确写了。

---

## 10. 校验

```bash
cd agentic-lims
node scripts/check-customer-model.mjs   # 结构 / 准入 / 样品 / 工时 / 引擎 / 路由
node scripts/check-engine.mjs           # 引擎回归
node scripts/reseed-demo.mjs            # 重置演示数据（force seed）
```

`check-customer-model.mjs` 覆盖：19 SPEC / 17 活动 / 11 可排任务、状态准入、样品读 Instockdate、工时来自标准、能力 OFF、分包、站点隔离、18 条约束全部 `confirmed:false`、路由与幂等 seed。

---

## 11. 进度（2026-10-29 晚）

已完成：

1. **SPEC 看板**：11 态按阶段分组（待排 / 已占位 / 执行中 / 请求审批 / 结果报告 / 已关闭），每行带不可排原因（HC-101 / HC-102）与缺字段，点开是规格活动与逐条可排性。
2. **周计划**：`/api/lims/week-plan` + `lims_week_plan` 工具 + 右侧「周计划」页。按周桶给 Plan No. / LIMS No. / 设备 / 执行人 / 优先级 / 周内序号 / 工作量 / 周号 / 状态 / Event date，并显式标出 18 个回填字段里哪 3 个缺客户主数据（PVP No. / Sample No. / A& SMPL）。
3. **看板入口**：概览页第一张卡换成「SPEC 可排 / 不可排」，并新增「N 个 SPEC 未通过审批」告警。
4. **四层甘特**：`/api/lims/gantt` + 右侧「甘特」页，层级与客户导出完全一致（Project → PLAN 批次 → SPEC → activity），支持折叠、站点过滤、周刻度、今天高亮；历史记录落在窗口外自动隐藏。
5. **UI 自测**：`scripts/check-ui-render.mjs` 用真实 client.js 在 headless Chrome 里跑通 13 个页面与引用桥，覆盖新加的三页（SPEC / 周计划 / 甘特）。
6. **「需审核」不再死锁**：非标准方法的所有候选都是 `needs_review`，旧逻辑一律拒绝确认 → 没有出口。现在确认需带 `reviewAck`（UI 勾选 / 工具 `acknowledgeReview`），并把审核人、时间、未通过的约束项写进 `review_ack` 审计事件；回归脚本 `scripts/check-review-confirm.mjs`。
7. **演示数据一键复位**：`POST /api/lims/reset`（all / plans / downtime / changes / workspace / task / spec），UI 在「自定义 → 测试数据」；全部重置等价于 `seedDatabase({force:true})`，回到 `data/*.csv` 的初始状态。
8. **排程页决策区**：确认动作从"散落的按钮"收进独立的 `data-decision="confirm-plan"` 区块（品牌色底 + 「需要你决定」标题），需要审核时在该区块内勾选后才可确认。

未做（下一阶段）：

1. **xlsx 回填导出**：`lims_export_plan_grid`、按客户 `Planning` 模板生成 Excel 还没做（结构已备好：`buildWeekPlan().grid`）。
2. **站点图例细分**：甘特页有站点过滤，但客户模板里 `Test performed at Amplitude / Volta` 的配色图例还没复刻。
3. **SPEC 内活动串行**：引擎还没有"活动 2 必须晚于活动 1"的前置约束，目前靠 `generate_test_plan` 的批次避让近似。
3. **旧自测脚本**：`check-routes.mjs`、`check-upgrade.mjs` 等 12 个脚本仍引用旧 `TASK-200x` / `EQ-00x`；`check-customer-model.mjs`、`check-engine.mjs`、`check-ui-render.mjs` 已可用并通过。
4. `data/dynamic_ui_payload.json` 是上一版遗留的界面演示数据，待重新生成。
