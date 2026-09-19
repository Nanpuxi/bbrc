/**
 * 存档数据版本号：单调递增计数，只在"存档内容真的变化"时 +1
 * （远程 op 应用、协作中本地编辑经 captureLocalOp 的 diff 检出、快照整档替换），
 * 与渲染无关。
 *
 * 用途：宿主据此区分"数据驱动的未保存"与"无关渲染"（远程补渲染迟到、图标/参考图
 * 加载完成触发的重绘等）——渲染回调若把"任何主画布渲染"都当成"有未保存更改"，
 * 保存后迟到的补渲染会把未保存标记重新置位（保存按钮"凭空重现"）。
 *
 * savedRevision 由宿主在"当前数据已与云端一致"时打标（加载完成、保存成功）；
 * 仅协作会话内用作未保存判据（非协作维持"渲染即改动"的既有语义）。
 */

let revision = 0
let savedRevision = 0

/** 存档内容变化：递增数据版本 */
export function bumpSaveDataRevision(): void {
    revision++
}

/** 当前数据版本（诊断/测试用） */
export function getSaveDataRevision(): number {
    return revision
}

/** 当前数据已与云端一致（宿主在加载完成、保存成功时调用） */
export function markSaveDataSaved(): void {
    savedRevision = revision
}

/** 是否存在未保存的数据变化（版本号自上次打标后发生过递增） */
export function hasUnsavedSaveDataRevision(): boolean {
    return revision !== savedRevision
}

/** 重置计数（测试用，防模块级状态跨用例泄漏） */
export function resetSaveDataRevision(): void {
    revision = 0
    savedRevision = 0
}
