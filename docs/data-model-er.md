# Agentic LIMS MongoDB 结构与 ER 图

> 快照：2026-10-30 11:03（演示时钟冻结 2026-10-30 08:00）
> 实例：`mongodb://127.0.0.1:27018` / 库 `agentic_lims`
> 口径：直接读当前库的集合、字段与引用值，并与 `agentic-lims/lib/model.js` 的投影逻辑核对。

## 1. 三层结构

| 层 | 集合 | 写入方式 | 作用 |
|---|---|---|---|
| 原始层 | `raw_*` | 启动时从 `agentic-lims/data/*.csv` 原样导入 | 客户导出的系统记录，**所有标量都是字符串**；改数据不改这里 |
| 规则层 | `lab_rules` | 单例文档，`_id = lab-rules-v1` | 11 态状态机、预约模式、能力项、日历、优先级词表、工时回退；全部 `confirmed: false` |
| 运行时层 | `plans` / `test_plans` / `audit_events` / `change_events` / `change_impacts` / `sample_status` / `task_overrides` / `downtime_events` / `workspace` / `meta` | 业务动作追加写 | 候选方案、测试计划、审计、变更影响、工作区状态 |

**不落库的派生对象**：`task`（= 可排的规格活动投影）、`Project`、`Order`、周计划、甘特、`test_execution` 行。  
所以库里没有 `projects` / `orders` / `tasks` 集合；`taskId` 在运行时集合里就是 `raw_spec_activities.activity_id`。

## 2. 集合清单（当前条数）

| 集合 | 条数 | 主键 `_id` | 说明 |
|---|---:|---|---|
| `raw_specs` | 19 | `spec_id` | SPEC 主数据（11 态、计划窗口、样品到位） |
| `raw_spec_activities` | 17 | `activity_id` | 13 `spec_activity` + 2 `subcontracted` + 2 `test_execution` |
| `raw_plans` | 4 | `plan_no` | 客户 PLAN 批次（PLAN26AA…-1） |
| `raw_standards` | 9 | `standard_id#activity_no` | 一个标准拆多行步骤，**主键是复合键** |
| `raw_competencies` | 8 | `competency_id` | 能力项目录 |
| `raw_equipment` | 9 | `resource_id` | 6 设备 + 2 工位 + 1 分包商 |
| `raw_persons` | 5 | `person_id` | 人员、站点、能力项、日历 |
| `raw_allocations` | 14 | `allocation_id` | 既有占用（设备小时 / 人员工时） |
| `raw_assignments` | 3 | `assignment_id` | 资源分配记录 |
| `raw_history` | 7 | `history_id` | 历史实际时长（工时回退来源） |
| `raw_person_activities` | 3 | `activity_id` | 培训 / 审核等人员占用 |
| `raw_constraints` | 18 | `constraint_id` | 规则目录，无外键，靠 `constraint_id` 被评估结果引用 |
| `lab_rules` | 1 | `lab-rules-v1` | 规则单例 |
| `plans` | 11 | `planId` | 候选方案；`superseded 6 / confirmed 3 / feasible 1 / at_risk 1` |
| `test_plans` | 0 | `testPlanId` | 项目级测试计划 |
| `audit_events` | 12 | `id` | 追加式审计 |
| `change_events` | 0 | `id` | 变更事件（样品 / 交期 / 优先级） |
| `change_impacts` | 0 | `changeId-index` | 变更影响行，随事件写入 |
| `sample_status` | 0 | `taskId` | 只在样品变更时写，覆盖 `instock_date` |
| `task_overrides` | 0 | `taskId` | 交期 / 优先级覆盖 |
| `downtime_events` | 1 | `DT-设备-日期` | 计划停机 |
| `task_template_overrides` | 0 | `taskId` | 旧 task 模板桥接，当前空 |
| `workspace` | 1 | `default` | 右侧工作区状态（页面、选中方案、消息） |
| `meta` | 2 | `seed` / `diagnostics` | 种子版本、读工作区计数 |

旧版遗留且当前为空：`raw_tasks`、`raw_requests`、`raw_templates`、`raw_resources`、`raw_activities`、`raw_candidates`、`prototype_config`。其中 `lims_create_task_draft` 仍会写 `raw_tasks`，属旧 task 口径通道。

## 3. ER：主数据与排程对象

读法：左符号 = 每个右实体对应几个左实体（`||` 恰好 1，`|o` 0 或 1）；右符号 = 每个左实体对应几个右实体。

```mermaid
erDiagram
    %% 原始层：客户导出，字段全为字符串
    raw_plans {
        string plan_no PK "PLAN26AA1126-1"
        string project "项目名字符串 非外键"
        string site "AMPLITUDE / VOLTA / EXTERNAL"
        string plan_status "Draft / Firm"
        string window_start
        string window_end
        string spec_ids "分号分隔 冗余反向列表"
    }
    raw_specs {
        string spec_id PK "SPEC26AA4851 或 SUBS26AA0720"
        string status "11 态之一"
        string plan_no FK "可为空"
        string project "项目名字符串"
        string order_no "来自排程回填表 Order 列"
        string standards "分号分隔 存 standard_code"
        string competency_ids "分号分隔 COMP-星号"
        string competency_check "ON / OFF"
        string est_start_date
        string est_end_date "缺则 HC-102 不可排"
        string instock_date "样品到位 HC-108"
        string sample_count
        string workload_hours "客户该列恒 0"
        string priority "P1 到 P4"
        string testers "人名或角色占位符"
    }
    raw_spec_activities {
        string activity_id PK "SA26AA4851-01"
        string spec_id FK
        string plan_no FK "冗余 与 SPEC 一致"
        int activity_no
        string activity_type "spec_activity / subcontracted / test_execution"
        string resource_id FK "设备 工位或分包商"
        string cube_id FK "前处理工位"
        string person_id FK "可为空 由引擎分配"
        string standard_id FK "指向标准步骤组"
        string duration_value
        string duration_unit
        string effort_hours "标准活动留空 由标准推导"
        string start_datetime
        string end_datetime
        string status
        string site
    }
    raw_standards {
        string key PK "standard_id 加 activity_no"
        string standard_id
        string standard_code "DIN VDE 0620-1"
        int activity_no
        string activity_name
        string equipment_type "类型匹配 不是外键"
        string competency_id FK
        string prep_minutes
        string test_minutes
    }
    raw_competencies {
        string competency_id PK "COMP-ENV-SALT"
        string external_id "ENV-SALT-MIST-L2"
        string domain
        string sub_domain
        string sub_domain2
    }
    raw_equipment {
        string resource_id PK "EQPT 或 CUBE 或 VENDOR"
        string resource_kind "equipment / space / subcontract"
        string equipment_type
        string site "站点隔离 HC-110"
        string status
        string calibration_due
        string calendar_mode "workday / 24h"
        string max_concurrent_tasks
    }
    raw_persons {
        string person_id PK "P-102"
        string person_name
        string site
        string competency_ids "分号分隔"
        string daily_capacity_hours
        string workday_start
        string workday_end
        string weekend_allowed
    }
    raw_allocations {
        string allocation_id PK
        string task_id FK "规格活动 ID"
        string plan_id FK "引擎候选方案 ID"
        string resource_id FK "设备或工位"
        string person_id "混有人名与 P-xxx"
        string allocation_date
        string planned_load
        string load_unit
    }
    raw_assignments {
        string assignment_id PK
        string task_id FK
        string resource_id "多态 设备或人名"
        string resource_role
        string assignment_status
    }
    raw_history {
        string history_id PK
        string template_id FK "存 standard_id"
        string equipment_id FK
        string space_id FK
        string tester_id FK
        string planned_duration_min
        string actual_duration_min
        string final_status
    }
    raw_person_activities {
        string activity_id PK
        string person_id FK
        string activity_type
        string start_datetime
        string end_datetime
        string availability_impact
        string blocked_hours
    }
    plans {
        string planId PK "PLAN-SA26AA4851-01-1-GGS73L"
        string taskId FK "规格活动 ID"
        string status "feasible / at_risk / confirmed / superseded"
        string strategy
        string startAt
        string endAt
        string dueAt
        object resources "equipment person space 内嵌"
        object reservation "Exclusive / Shared / Subcontracted"
        object sample "readyAt 快照"
        object inputSnapshot "确认时复验用"
        array segments "逐日分段 设备 人员 工位"
        array evaluations "HC 与 SC 判定"
        array risks
    }

    raw_plans |o--o{ raw_specs : "plan_no"
    raw_specs ||--o{ raw_spec_activities : "spec_id"
    raw_plans |o--o{ raw_spec_activities : "plan_no 冗余"
    raw_equipment |o--o{ raw_spec_activities : "resource_id"
    raw_equipment |o--o{ raw_spec_activities : "cube_id"
    raw_persons |o--o{ raw_spec_activities : "person_id"
    raw_standards |o--o{ raw_spec_activities : "standard_id"
    raw_standards }o--|| raw_competencies : "competency_id"
    raw_persons }o--o{ raw_competencies : "competency_ids"
    raw_specs }o--o{ raw_competencies : "competency_ids"
    raw_specs }o--o{ raw_standards : "standard_code 非 ID"
    raw_persons ||--o{ raw_person_activities : "person_id"
    raw_spec_activities ||--o{ raw_allocations : "task_id"
    raw_spec_activities ||--o{ raw_assignments : "task_id"
    raw_persons ||--o{ raw_history : "tester_id"
    raw_equipment ||--o{ raw_history : "equipment_id"
    raw_standards |o--o{ raw_history : "template_id"
    raw_spec_activities ||--o{ plans : "taskId"
    plans |o--o{ raw_allocations : "plan_id"
```

## 4. ER：运行时与智能体集合

```mermaid
erDiagram
    %% 任务锚点就是规格活动
    raw_spec_activities {
        string activity_id PK "SA26AA4851-01"
    }
    raw_equipment {
        string resource_id PK "EQPT25AA1100"
    }
    plans {
        string planId PK "PLAN-SA26AA4851-01-1-GGS73L"
        string taskId FK
        string status "confirmed 才占资源"
        string startAt
        string endAt
        string generatedAt
        string confirmedAt
        string confirmedBy
    }
    test_plans {
        string testPlanId PK "TP-PRJ-1001-..."
        string projectId "项目名字符串 非外键"
        string templateId "模板分组"
        array taskIds "展开的活动 ID"
        array plans "内嵌候选方案快照"
        object summary "scheduled / late / unscheduled"
        string status "draft"
    }
    sample_status {
        string taskId PK
        string status
        string readyAt
        string source "workspace 或 spec-export"
        string updatedAt
    }
    task_overrides {
        string taskId PK
        string priority
        string dueDate
        string reason
        string updatedAt
    }
    change_events {
        string id PK "CHG-..."
        string taskId FK
        string type "sample_delay / due_date / priority"
        string field
        string from
        string to
        object analysis "直接与间接影响"
        string ruleVersion
        string at
    }
    change_impacts {
        string id PK "changeId 加序号"
        string changeId FK
        string taskId
        string kind "direct / indirect"
        string relation "shared-equipment / shared-person"
        string severity
        string deltaHours
    }
    downtime_events {
        string id PK "DT-设备-日期"
        string equipmentId FK
        string date
        string reason
        string actor
    }
    audit_events {
        string id PK "AUD-..."
        string type "plan_confirmed 等"
        string actor
        string taskId
        string planId
        string resourceId
        object data
        string at
    }
    workspace {
        string id PK "default"
        string page
        string taskId
        array planIds
        string selectedPlanId
        string testPlanId
        string changeId
        int revision
    }

    raw_spec_activities ||--o{ plans : "taskId"
    raw_spec_activities ||--o| sample_status : "taskId"
    raw_spec_activities ||--o| task_overrides : "taskId"
    raw_spec_activities ||--o{ change_events : "taskId"
    change_events ||--o{ change_impacts : "changeId"
    raw_spec_activities |o--o{ audit_events : "taskId"
    raw_equipment ||--o{ downtime_events : "equipmentId"
    raw_equipment |o--o{ audit_events : "resourceId"
    plans |o--o{ audit_events : "planId"
    plans |o--o{ test_plans : "taskIds 与内嵌 plans"
    plans |o--o| workspace : "selectedPlanId"
    test_plans |o--o| workspace : "testPlanId"
    change_events |o--o| workspace : "changeId"
```

## 5. 关系与数据质量备注

1. **两套 PLAN 命名空间**：`raw_plans.plan_no = PLAN26AA1126-1` 是客户批次；`plans.planId = PLAN-SA26AA4851-01-1-GGS73L` 是引擎候选方案。`raw_allocations.plan_id` 指后者，别和前者 join。
2. **`raw_specs.standards` 存的是 `standard_code`**（如 `DIN VDE 0620-1`），不是 `standard_id`。实测 10 个值按 `standard_id` 匹配全部落空，必须按 `standard_code` 关联。
3. **列表字段是 `;` 分隔字符串**：`raw_plans.spec_ids`、`raw_specs.standards`、`raw_specs.competency_ids`、`raw_persons.competency_ids`。不能直接 `$lookup`，要先 split；Mongo 里没有数组。
4. **人员引用不统一**：`raw_persons` 用 `P-102`；`raw_specs.testers` 存人名或角色占位符 `TST BY SLT10`；`raw_allocations.person_id` 与 `raw_assignments.resource_id` 混有人名（实测 `Tingting Tang`、`Meixia WANG`）和 `P-102`。按人名当外键会漏。
5. **`resource_id` 是多态引用**：同一字段可能是 `EQPT...`（设备）、`CUBE-A1`（工位）、`VENDOR-EXT-01`（分包）。`raw_assignments.resource_id` 还会放人名。
6. **`raw_standards` 不是一行一个标准**：`_id = standard_id#activity_no`，一个 `standard_id` 对应多行步骤；活动只引用到 `standard_id` 这一组。
7. **无数据库级外键**：所有关联由 `lib/model.js` 在内存 join（`task` 由其按状态、计划窗口、资源投影）。Mongo 不拦孤儿引用，写入时也不校验。
8. **`raw_specs.workload_hours` 客户恒 0**，工时来自 `raw_standards` 的 prep + test 分钟（`effortSource: standard`），或历史 `raw_history` 回退。
9. **13 个 SPEC 没有 `plan_no`**，所以 PLAN → SPEC 是 0..1 对多，不是必填。
10. **空集合是正常状态**：`sample_status` / `task_overrides` / `change_events` / `change_impacts` / `test_plans` 只有发生对应动作才写；不要把它们当缺失数据。
