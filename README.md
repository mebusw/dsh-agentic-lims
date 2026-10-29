# dsh-agentic-lims

一个跑在 **DeepSeek Harness（DSH）右侧边栏**里的 Agentic LIMS 可行性 demo：MongoDB 存模拟实验室数据，确定性引擎判定排程可行性，聊天里的 Agent 通过 `lims_*` 工具排程、解释约束、分析停机影响。

- **形态**：DSH 插件（Host + Client 两半），不是独立网站。
- **界面**：DSH 右侧边栏 tab，一级菜单（概览 / 订单 / SPEC / 项目 / 任务 / 排程 / 周计划 / 甘特 / 影响 / 资源 / 分析 / 自定义 / 审计）+ 角色视图（实验人员 / TM-TL / 运营），内置 SPEC 生命周期看板、周计划、四层甘特、方案对比、约束校验、负荷报表与变更影响。
- **对话**：DSH 原生聊天框；Agent 通过 `lims_*` 工具读数据、跑引擎，并驱动右侧工作区切页。
- **数据**：MongoDB（默认 `127.0.0.1:27018/agentic_lims`），模拟数据包 CSV 原样导入 `raw_*` 集合。
- **规则**：硬约束由代码校验（设备能力、资质、校准、冲突、工作时段、前处理空间、样品到位、Task Type 预约规则），模型只做理解与解释。
- **追问**：任意卡片（含聊天里的工具卡）可「引用」到聊天输入框；选中文字后引用只带选中内容，便于针对某个设备/日期/约束继续追问。

---

## 环境要求

| 组件 | 版本 | 用途 |
|---|---|---|
| [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) | `0.2.x` 及以上 | 提供右侧边栏、插件加载与对话 |
| Node.js | ≥ 20 | DSH 与插件的运行时 |
| pnpm | ≥ 9 | DSH 用它安装插件（`dsh plugin` 只是 pnpm 的包装） |
| MongoDB | 7 或 8，或 Docker | 存模拟数据、方案、审计、停机事件 |

macOS / Linux 均验证过；Windows 建议在 WSL 里跑。

---

## 安装（三步）

### 第 1 步：安装 DSH

```bash
npm install -g @deepseek-ai/dsh
dsh web
```

浏览器打开 <http://127.0.0.1:3080>，按首次启动引导配好模型凭据（能正常对话即可）。
这一步没跑通之前，插件是装不进去的 —— 插件最终是挂到 DSH 的某个 profile 上的。

### 第 2 步：取插件代码

```bash
git clone https://github.com/mebusw/dsh-agentic-lims.git
cd dsh-agentic-lims
```

### 第 3 步：一键设置

```bash
./setup.sh
```

脚本按顺序做四件事，每步都会打印结果，可重复执行：

1. **启动 MongoDB** —— 起在本机 `27018`，数据目录放在仓库内的 `.data/mongodb`（不污染系统数据目录，也不和常见的 `27017` 打架）。本机没有 `mongod` 但有 Docker 时，自动改起 `mongo:7` 容器。
2. **装插件依赖** —— `agentic-lims` 只依赖一个 `mongodb` 驱动，`npm install --omit=dev` 几秒钟。
3. **导入演示数据** —— 把 `agentic-lims/data/*.csv` 导入 `raw_*` 集合，并把工作区重置到概览页。
4. **装进 DSH** —— 执行 `dsh plugin --profile web add ./agentic-lims`，把插件连同 `dsh.profile.bundles` 一起写进 profile。

装完**重启 `dsh web`**并刷新页面，右侧边栏会出现「智能实验室 / Agentic LIMS」tab。找不到的话，点聊天标题栏右侧的烧瓶图标，或在右侧边栏的「+」指南里选它。

#### 常用参数

```bash
./setup.sh                      # 默认：装进 web profile，导入干净数据
./setup.sh --demo               # 导入完整演示数据（预置停机事件、测试计划、候选方案）
./setup.sh --profile lims       # 装进别的 profile
./setup.sh --skip-plugin        # 只准备 MongoDB 和数据，不动 DSH
./setup.sh --help               # 全部选项
```

---

## 安装到底改了哪些东西

想核对或手工复现，就是这么四步（`setup.sh` 做的事完全等价）：

```bash
# 1) MongoDB
./agentic-lims/scripts/start-mongo.sh

# 2) 依赖
(cd agentic-lims && npm install --omit=dev)

# 3) 演示数据
(cd agentic-lims && node scripts/reset-demo-data.mjs)

# 4) 装插件（= pnpm link + 写入 bundle 列表）
dsh plugin --profile web add "$PWD/agentic-lims"
```

这些文件进的是仓库和 DSH home，不会碰系统目录：

| 位置 | 内容 |
|---|---|
| `<repo>/.data/mongodb` | MongoDB 数据文件（已在 `.gitignore`） |
| `<repo>/.data/logs/mongod.log` | mongod 日志 |
| `<repo>/agentic-lims/node_modules` | 唯一的运行时依赖 `mongodb` |
| `$DSH_HOME/profiles/web/package.json` | 依赖 `@local/agentic-lims` + `dsh.profile.bundles` |

---

## 配置

插件在 **DSH 启动时**读环境变量，所以要在启动 `dsh web` 的同一个 shell 里 `export`（或写进 shell 的 rc 文件）：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `AGENTIC_LIMS_MONGO_URI` | `mongodb://127.0.0.1:27018` | 插件连的 MongoDB |
| `AGENTIC_LIMS_DB` | `agentic_lims` | 数据库名 |
| `AGENTIC_LIMS_MONGO_PORT` | `27018` | `start-mongo.sh` 起的端口 |
| `AGENTIC_LIMS_MONGO_DBPATH` | `<repo>/.data/mongodb` | 数据目录 |
| `AGENTIC_LIMS_MONGOD` | 自动探测 | 指定 `mongod` 可执行文件 |
| `AGENTIC_LIMS_MONGO_IMAGE` | `mongo:7` | Docker 兜底时用的镜像 |
| `DSH_PROFILE` | `web` | `setup.sh` 默认装进的 profile |
| `DSH_BIN` | 自动探测 | 指定 `dsh` 可执行文件 |

**用已经在跑的 MongoDB**（比如团队共享的一台，或你自己 `27017` 上的实例）：

```bash
./setup.sh --skip-mongo
export AGENTIC_LIMS_MONGO_URI='mongodb://127.0.0.1:27017'
export AGENTIC_LIMS_DB='agentic_lims'
dsh web
```

**换端口**：

```bash
AGENTIC_LIMS_MONGO_PORT=27019 ./agentic-lims/scripts/start-mongo.sh
export AGENTIC_LIMS_MONGO_URI='mongodb://127.0.0.1:27019'
```

也可以不用环境变量，改 profile 的 patch 层（覆盖插件条目配置）：

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: agentic-lims
  config:
    mongoUri: mongodb://127.0.0.1:27019
    dbName: agentic_lims
```

> 演示时钟冻结在 `2026-10-30 08:00 (+08:00)`（周五），和模拟数据包日期一致，保证每次演示结果可复现。

---

## 验证安装

1. 右侧边栏出现「智能实验室」tab，顶部有「概览 / 项目 / 任务 / 排程 / 影响 / 资源 / 分析 / 自定义 / 审计」。
2. 在聊天框问一句：**「今天实验室怎么样？」** —— Agent 应调用 `lims_overview`，右侧切到概览并显示 KPI。
3. 数据确实进库了：

   ```bash
   mongosh --port 27018 --quiet --eval 'db.getSiblingDB("agentic_lims").raw_tasks.countDocuments()'
   # 8
   ```

4. 不依赖 DSH 也能自测引擎和路由：

   ```bash
   cd agentic-lims
   node scripts/check-engine.mjs
   node scripts/check-routes.mjs
   node scripts/check-upgrade.mjs
   node scripts/check-client-cards.mjs
   # 可选：headless Chrome 渲染测试（需要浏览器 + React UMD；缺依赖时自动跳过）
   # CHROME_BIN=... AGENTIC_LIMS_UI_VENDOR=... node scripts/check-ui-render.mjs
   ```

---

## 30 秒演示脚本

> 2026-10-29 起数据改为客户口径：**SPEC → 规格活动 → PLAN 批次**。下面的提问已经换成新 ID；
> 界面文案还在按旧结构渲染，UI 改造在下一阶段。

在 DSH 聊天框里依次说：

1. **看 SPEC 池**
   > 现在有哪些 SPEC？哪些排不了，为什么？

   Agent 调 `lims_list_specs`，逐条给出状态与不可排原因：HC-101 状态准入（Draft / In approval / In progress…）与 HC-102 计划窗口必填。

2. **看周计划**
   > 未来四周怎么排？给我客户的排程表视图。

   Agent 调 `lims_week_plan`，右侧切「周计划」：按周桶列出 Plan No. / LIMS No. / 设备 / 执行人 / 优先级 / 周内序号 / 工时 / 状态，并标出哪几列缺客户主数据（PVP No. / Sample No. / A& SMPL）。

3. **排一条活动**
   > 帮我排 SA26AA4851-01 这个盐雾活动，优先保交期，给我两个备选方案。

   Agent 调 `lims_get_task` / `lims_generate_plans`，右侧切「排程」，出现候选方案、甘特图、HC-103…HC-112 约束校验和评分拆解。样品 10-28 才到，方案不会早于它。

4. **确认** —— 点候选卡片下方或右侧摘要顶部的**「确认此方案」**。候选方案只是写进 MongoDB，确认后才占资源、写审计。

5. **解释阻塞**
   > 为什么 SA26AA4854-01 排不了？

   Agent 调 `lims_get_task` / `lims_explain_resource`：机械耐久台 EB-01 状态 Maintenance Due（HC-105），给出替代资源或先维护的建议。

6. **停机影响**
   > EQPT25AA1101 明天维护，哪些活动受影响？

   Agent 调 `lims_analyze_downtime`，右侧切「影响」页；对比重排前后的完成时间与延期项。

7. **样品延迟**
   > SPEC26AA4853 的样品晚到 11-05，会影响哪些活动？

   Agent 调 `lims_analyze_change`（`sample_delay`），写 ChangeEvent，返回直接 + 间接影响；样品到位时间读自 `Instockdate`。

8. **按新约束重排**
   > 重新安排 SA26AA4851-01，周五下午不要排实验，优先用 EQPT25AA1103。

9. **项目 / 测试计划**
   > 把 PRJ-01-OPS 里 DIN VDE 0620-1 的活动排成一个测试计划。

   Agent 调 `lims_generate_test_plan`（projectId + 标准 `STD26AA0001`），右侧「项目」页展示项目 → 标准 → 活动 → 合并时间轴。

10. **简单数字**
   > 周三 EQPT25AA1104 有多少个预约？

   走 `lims_equipment_bookings`，聊天里直接渲染预约卡片。

11. **订单与样品**
    > 有哪些订单？ORD-26AA0043 的样品到齐了吗？

    Agent 调 `lims_list_orders` / `lims_get_order`；订单号取自排程表的 `Order` 列，与 SPEC 是精确关联（`linkConfidence: exact`），不再标"原型推断"。

12. **规则解释（客户最爱问的两个坑）**
    > Pre-booked 和预约模式（Exclusive / Shared / Subcontracted）有什么区别？哪些规则还没确认？

    Agent 调 `lims_list_policies`：`Pre-booked` 是 SPEC 状态，预约模式是另一套枚举；11 态状态机、能力校验 ON/OFF、优先级词表全部 `confirmed: false`。

13. **引用卡片追问** —— 悬停任意卡片点「引用」，或选中一段文字后点「引用选中」，内容会进入聊天输入框；补一句「为什么？」即可针对这张卡片追问。
## 数据与重置

```bash
# 干净的演示库（无历史方案、无停机登记）
(cd agentic-lims && node scripts/reset-demo-data.mjs)

# 完整演示数据（预置 EQPT25AA1101 停机、测试计划、SA26AA4851-01 候选方案）
(cd agentic-lims && node scripts/reseed-demo.mjs)

# 数据结构自测（SPEC 准入 / 样品 / 工时 / 规则 / 路由）
(cd agentic-lims && node scripts/check-customer-model.mjs)

# 重启宿主前必跑：全量语法检查
(cd agentic-lims && node scripts/check-syntax.mjs)
```

两个脚本都认 `AGENTIC_LIMS_MONGO_URI` / `AGENTIC_LIMS_DB`，可以指向别的实例。

**演示中的一键复位**：右侧边栏「自定义 → 测试数据」有 6 个按钮（全部重置 / 清空候选方案 / 清空停机 / 清空变更 / 复位工作区 / 重置当前活动），两段确认，等价接口是 `POST /api/lims/reset {"scope":"all" | "plans" | "downtime" | "changes" | "workspace" | "task" | "spec", "targetId": "..."}`。

客户 Demo 的提示词与现场数字见 **[demo/customer-demo-2026-10-30.md](demo/customer-demo-2026-10-30.md)**。

---

## 目录结构

```
dsh-agentic-lims/
├─ setup.sh              一键安装（Mongo → 依赖 → 数据 → 插件）
├─ agentic-lims/         DSH 插件本体
│  ├─ index.js           Host 入口：Mongo 连接、路由、工具、系统提示
│  ├─ client.js          右侧边栏 React UI（无构建，DSH Client 模块）
│  ├─ cordis.patch.yml   bundle 安装行
│  ├─ lib/               model / engine / routes / tools / seed / csv / util / drafts / upgrade
│  ├─ data/              客户口径数据包 CSV/JSON + lab_rules.json（规则层，全部待确认）
│  ├─ scripts/           start-mongo.sh、数据重置、引擎/路由自测
│  ├─ locale/            插件标题与描述（中/英）
│  └─ icon.svg           插件图标
├─ docs/                 客户数据复盘、数据模型、回填示例、界面截图
└─ demo/                 演示脚本与讲稿（旧 task 口径，待 UI 阶段重写）
```

插件自身的详细说明（角色视图、Test Plan 生成顺序、卡片与折叠、工具清单、引擎假设、已知边界）见 **[agentic-lims/README.md](agentic-lims/README.md)**。
数据结构（集合、字段、状态机、投影规则、约束清单）见 **[docs/data-model.md](docs/data-model.md)**。

---

## 常见问题

**右侧没出现 tab**
先确认第 4 步装成功了：`cat $DSH_HOME/profiles/web/package.json` 里应有 `"@local/agentic-lims": "link:.../agentic-lims"`，且 `dsh.profile.bundles` 包含它。装完必须**重启 `dsh web`**（无 HMR 时不会热加载）。还不行就点聊天标题栏的烧瓶图标。

**`dsh plugin` 报 `pnpm: command not found`**
`dsh plugin` 只是把参数转发给 pnpm：`npm i -g pnpm` 后重跑 `./setup.sh --skip-mongo --skip-deps --skip-seed`。

**MongoDB 连不上 / 插件报 2500ms 超时**
`mongosh --port 27018 --eval 'db.runCommand({ping:1})'` 试一下。连不上就看 `.data/logs/mongod.log`；换端口后记得同步 `AGENTIC_LIMS_MONGO_URI`。

**27018 被占用**
`AGENTIC_LIMS_MONGO_PORT=27019 ./setup.sh`，并 `export AGENTIC_LIMS_MONGO_URI='mongodb://127.0.0.1:27019'` 再启动 DSH。

**装了但数据是空的**
插件启动时会自动 `seedDatabase`（幂等），只要 DB 可写就会补上。还是空的就手动跑一次 `reset-demo-data.mjs`，并看 DSH 日志里 `[agentic-lims] ready:` 那行。

**`EPERM` / 权限错误**
多半是 DSH 的文件沙箱或 `$DSH_HOME` 属主问题。DSH 侧装插件需要 `danger-full-access` 或当场批准；`~/.npm`、`~/.dsh` 属主不对时按报错提示 `chown`。

**Windows**
`start-mongo.sh` 用的是 bash + `--fork`，请在 WSL 里跑，或直接用 Docker 起 MongoDB 后 `./setup.sh --skip-mongo`。

---

## 已知边界

- 这是**可验证可行性的 demo**：单机 MongoDB、冻结演示时钟、贪心排程，不是生产优化器。
- 没有真实权限、审批流、生产写入、SSO 或回滚；审计只保留原型事件，确认永远是「模拟确认」。
- 排程按「每日小时」建模，甘特图是日粒度资源条，没有分钟级设备时间轴；周计划已按周桶输出（ISO 周号），但**还不能导出客户的 xlsx 回填模板**。
- 停机目前按「设备 + 整天」建模；部分时段停机、跨天窗口未实现。
- Test Plan 是 draft，不做批量确认。
- SPEC 内的活动顺序（活动 2 必须在活动 1 之后）还没有做成硬约束，目前靠批次避让近似。
- 规则层（`data/lab_rules.json`、`data/constraints.csv`）是从客户导出**反推**的：11 态状态机、预约模式、优先级词表、周产能阈值 1400、站点含义都标了 `confirmed: false`，不是客户已确认的业务规则。
- 能力目录（Competency）是原型造的 8 条，只保证结构与客户一致（外部 ID + Type/Domain/Sub Domain/Sub Domain2），**ID 值不是客户的**。
- UI 已加「SPEC 看板」与「周计划」两页；项目页仍是「项目 → 标准 → 活动」，客户口径的四层折叠（Project → PLAN → SPEC → activity）与双站点图例还没做。
- `agentic-lims/scripts/` 里的 `check-routes.mjs`、`check-upgrade.mjs` 等 15 个旧自测脚本仍引用上一版 `TASK-200x` / `EQ-00x` ID，需在 UI 阶段重写；当前可用的自测是 `check-customer-model.mjs` 与 `check-engine.mjs`。
- 仓库里的演示数据是按客户**结构**造的中性样例（项目名、标准号、活动名沿用客户导出里的值，人员与设备为脱敏后的演示值），不含客户真实业务数据。
