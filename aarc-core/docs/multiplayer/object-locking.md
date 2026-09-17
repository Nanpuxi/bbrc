# 多人协作 — 对象锁定与「移动对象」流程分析

本文分析"移动对象"（ControlPoint / TextTag）三步操作流程的代码结构，回答多人协作的**对象锁定**应如何插入该流程，并提炼对其它操作类型也适用的结论。是 `backend-plan.md`、`id-allocation.md` 的配套分析。

## 1. 三步流程的代码事实

### 第一步：点击选中（activation）

入口是 `pureClickHandler`（`envStore.ts:156`，由 `listenPureClick` 绑在画布容器上，`init()` :91）。它按优先级做命中检测并设置"激活对象"：

| 命中目标 | 代码位置 | 设置的激活状态 |
|---------|---------|---------------|
| 站名 | `envStore.ts:243-273` | `activePt` + `activePtType='name'` |
| 文本标签 | `envStore.ts:277-285` | `activeTextTag` |
| 点 | `envStore.ts:288-328` | `activePt` + `activePtType='body'` |
| 线 | `envStore.ts:333-349` | `activeLine` |
| 空白 | `envStore.ts:351-361` | 无（结束一切编辑） |

关键事实：

- **激活瞬间就可能发生修改**：右键点击切换 `dir`（:297-303）、右键+ctrl 切换 `sta`（:304-310）、右键+alt 切换 `free`（:311-314），都直接改对象并置 `movedPoint=true`。因此"选中后才锁定"来不及，**锁定必须与激活同时发生**
- 激活的其它入口（不经过点击检测）：`createPlainPt` :955、`createTextTag` :915、`duplicateTextTag` :928（新建即激活）、线路延长按钮 :425、菜单插入点 :725、站名在车站团内转移（拖动中 `activePt` 换成另一个点，:487）
- 激活期间的文字编辑（`nameEditStore` / `textTagEditStore`）同样直接改激活对象（站名文字、标签文字），属于锁定范围内的修改
- 激活点时会展开其选区组（`applySelectionGroupsOf` :148），多选集合在 `selectionStore.selected`

### 第二步：拖动（local mutation）

- `moveStartHandler`（:367）：mousedown 命中的就是当前激活对象时置 `movingPoint`/`movingTextTag`（:381-406）
- `movingHandler`（:457）：**拖动中持续直接改存档数据**——`pt.pos`（:471）、`pt.nameP`（:491）、`tag.pos`（:517），期间只有本地渲染和吸附，没有任何"事务"边界
- `moveEndHandler`（:534，mouseup/touchend）：复位 moving 标记；处理拖到**丢弃区**的删除（:550-567，点/站名/标签在此被删）；线路延长场景做 `tryMergePt`（:543）；多选拖动在此刻 `selectionStore.draggingCommit`（:578）把位移**一次性应用到全部选中对象**（selectionStore.ts:122-135）

关键事实：多选拖动的锁单位不是单个对象，而是**整个选中集合**（含选区组展开后的并集）。

### 第三步：点击其他地方（commit + deselect）

再次进入 `pureClickHandler`，**开头的"收尾段"（:170-217）在命中检测之前执行**：

1. `tryMergePt` 尝试合并重叠点（:175，可能**删除另一个点**）
2. `movedPoint`/`movedTextTag` 为真时触发 `rerender`（:188-217）
3. 更新车站团、复位多选 `dragged` 标记
4. 然后 `cancelActive()`（:237）清空 `activePt`/`activeLine`/`activeTextTag`
5. 之后才做新一次的命中检测（可能立即激活另一个对象——**旧对象收尾与新对象激活发生在同一次调用里**）

关键事实：

- **`cancelActive()` 是释放激活的唯一咽喉**（:118），调用点：pureClickHandler :237、`nameSearchStore.ts:44`、`resetterStore.ts:50`、`Menu.vue:60`、`LineOptions.vue:172`；删除路径（`delActivePt` :807、`delActiveTextTag` :934、丢弃区 :553-563）则直接置空 active 引用，**不经过 cancelActive**
- 删除入口汇总：ops 菜单"移除"（:630）、丢弃区（:550-567）、Delete 快捷键（`aarc-web/Editor.vue:380-381`）

### 提交粒度已经存在（重要发现）

撤销栈的入栈点是**每次主画布渲染完成**：`notifyMainCvsRendered`（`mainCvsDispatcher.ts:77-81`）先 `undoStore.push(save)` 再走宿主回调。也就是说：

> 一次操作的收尾（`rerender.value(...)`）= 一次 undo push = 相邻两次 push 之间 au-undo-redo 算出的 patch ≈ 这一次操作的完整 diff

**协作 patch 的发射点可以直接复用这个边界**（在 undo push 处取最近两次状态的 diff 作为 op 广播），不需要为协作新造一套操作捕获机制。这也天然覆盖了"除了位置变化，也可能是 dir、sta 变化，或是被删除"——因为 diff 不关心改了什么。

## 2. 协作锁定的插入设计

### 锁的语义

- **锁键**：`${实体类型}:${id}`，必须带类型前缀——由 id-allocation.md §1 已知 id 只在同类型数组内唯一，点 5 和线 5 是不同对象
- **锁是建议性软锁（advisory lock）**：一致性下限仍由服务器全序 + LWW 保证（backend-plan.md §12），锁只是防止"两人同时拖同一个站"这种必然双输的 UX 灾难，**不是**数据正确性的前提
- **锁随连接消亡**：成员断连/离房时服务器自动释放其全部锁（挂在 backend-plan.md 的 `UserLeft`/空房回收路径上），客户端不需要心跳保活锁

### 生命周期与代码挂钩点

```
第一步 选中   ── 请求锁（type:id）──▶ 服务器仲裁 ──▶ 成功：进入编辑
              pureClickHandler 各激活分支                失败：不激活（见 §3）
              + createPlainPt/createTextTag 等新建路径（新 id 天然属于自己，无需请求）
              
第二步 拖动   ── 纯本地修改，不发任何消息（或可选地广播临时位置做"幽灵光标"，v1 不做）

第三步 收尾   ── 提交 diff（undo push 边界）+ 释放锁
              cancelActive() 统一挂钩；删除路径（delActivePt/delActiveTextTag/丢弃区）单独挂钩，
              删除的提交内容是 remove 而非新位置
```

具体挂钩点：

| 时机 | 挂钩位置 | 动作 |
|------|---------|------|
| 激活点/站名/标签/线 | `pureClickHandler` :247/:279/:293/:337 | 先查本地锁表，被他人锁定则跳过激活；否则激活并异步请求锁 |
| 新建即激活 | :915/:928/:955/:425/:725 | 新对象是自己的分区 id（id-allocation 方案 C），无需锁 |
| 释放 | `cancelActive()` :118 | 释放当前激活对象的锁（所有取消激活的路径自然覆盖） |
| 删除 | `delActivePt` :787、`delActiveTextTag` :930、丢弃区 :550-567 | 提交 remove patch 并释放锁（这些路径绕过 cancelActive，需单独处理） |
| 多选 | `selectionStore.selected` 变化时 | 锁集合 = 激活对象 ∪ selected；笔刷/选区组加入元素时逐个请求，任一失败则该元素不进选区 |

### 需要专门处理的坑

1. **站名拖动中的车站团转移**（movingHandler :480-489）：拖动站名时 `activePt` 可能中途换成团内另一个点，锁必须跟随转移（或按"车站团"粒度上锁）
2. **收尾时的 `tryMergePt`**（:175）：合并会删除**另一个**点，那个点可能正被他人锁定——提交侧策略：merge 目标若被他人锁定则本次不合并（跳过，留给下次），避免远程删除别人正在编辑的对象
3. **锁定期间收到远程 patch 改了我激活的对象**（他人绕过锁或锁前已发出的 op）：本地未提交的修改与远程修改并存——v1 策略：继续保留本地编辑（用户正在操作，不能打断），提交时按服务器 Seq 后到的覆盖；UI 上可提示
4. **远程 patch 删掉了本地激活/选中的对象**：应用 patch 时必须检测并 `cancelActive()` + 从 `selected` 剔除——否则本地残留悬空引用，第三步收尾会往一个已死的对象上写数据（这正是用户所说"自动为其解除选中"的另一个方向）

## 3. 后来者操作被锁对象（拦截设计）

用户要求"试图操作被他人锁定的对象时，自动解除其选中"。实现分层：

1. **检测层拦截（主防线）**：`pureClickHandler` 的四个命中分支在设置 `activeX` 之前查锁表，命中他人锁则视同点中空白（顺带给出"被 XX 编辑中"的轻提示）。`onPt`/`onTextTag`/`onStaName` 本身不改，保持纯检测
2. **笔刷/选区组过滤**：`selectionStore.brush`（selectionStore.ts:31-54）与 `applyGroups`（:60-73）加入元素前过滤他人锁定的对象，保证多选集合不含锁外对象——否则 `draggingCommit` 会连带移动它们
3. **锁到达时的降级**：本地已激活某对象、随后收到他人获得同一对象锁的消息（仲裁竞态的败方）→ 本地 `cancelActive()`，未提交的本地改动直接丢弃（发生在选中后毫秒内，损失可忽略）
4. **服务器仲裁**：两个客户端同时选中同一对象时锁请求必然竞争，由服务器在房间锁内做 first-write-wins，败方收到 lock-denied 走第 3 条。**客户端不等待锁结果就允许本地编辑**（乐观），否则选中会有网络延迟感；失败回退代价小是因为本地修改此刻还未提交

## 4. 更广泛适用的结论

1. **"激活对象"模式天然就是锁的锚点**。本编辑器的所有直接操作都收敛在一个不变式里：*对象的修改只发生在它被激活（或属于选中集合）期间，激活结束于 `cancelActive`/删除*。锁集合 = 激活集合，锁生命周期 = 激活生命周期。凡符合此模式的操作类型，协作化都是同一套挂钩（激活时锁、咽喉处释放、undo push 边界提交）
2. **提交边界复用 undo push**（mainCvsDispatcher.ts:77-81）。撤销栈的 push 时机就是产品语义上的"一次操作完成"，协作 op 的 diff 在同一处取即可；这也自动统一了位置/dir/sta/free/文字/删除等所有变更类型的提交格式
3. **不符合"激活"模式的操作没有锁锚点**：侧栏直接编辑的对象（线路属性 `LineOptions`、lineStyles、patterns、全局 config、数据源等）是即改即生效，没有 select→commit 周期。v1 建议对这类对象不上一致性锁，直接靠服务器全序 + LWW（改动小、冲突概率低、代价是一次覆盖）；若日后需要，可加"面板级"互斥（同一侧栏面板同一时刻一人打开）
4. **锁键必须带实体类型**（id 仅类型内唯一），删除与被删除都要走锁释放路径，且 patch 应用侧要对"本地激活对象被远程删除/修改"做防御——这四条对将来任何新增的可编辑实体类型都成立
5. **软锁 + 全序 LWW 是成本与体验的平衡点**：强一致（锁成功才允许编辑）会让每次选中都有网络往返延迟；纯 LWW 会让两人拖同一站时互相拉扯。乐观锁 + 服务器仲裁 + 败方解除选中，在 v1 的中继架构（backend-plan.md）上无需额外服务器状态，只需房间内一张锁表（`Map<key, userId>`，挂在 `CollabRoom` 上，随 `UserLeft` 清理）
