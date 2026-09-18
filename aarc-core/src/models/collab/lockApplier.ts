import { parseCollabLockKey, useCollabLockStore } from "aarc-core/models/stores/collabLockStore";
import { useEnvStore } from "aarc-core/models/stores/envStore";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useSelectionStore } from "aarc-core/models/stores/selectionStore";

/**
 * 他人获得锁时的本地处理（传输层在收到 lock 广播时调用）。
 * 若该对象正被本地激活/选中（锁仲裁的败方，object-locking.md §3.3），
 * 本地降级：先把对象恢复为加锁时登记的快照（撤销我这半截未提交的改动），
 * 再取消激活、移出选区（cancelActive 内部会顺带释放我的锁、丢弃快照）。
 *
 * 快照恢复使"两人同时拖同一站"的冲突不再依赖 LWW：恢复后 save 与
 * undo 基线逐字节一致，下一次取 diff 为空，我的半截改动零网络痕迹。
 * 对象已被删除（本地或远程）时快照无处可写，直接随锁释放丢弃；
 * 降级前已有中间态被广播的极端情况，恢复 diff 仍进入服务器全序流收敛，
 * LWW 保留为兜底而非主要机制。
 */

/** 把锁键对应的对象恢复为加锁时登记的快照；无快照或对象已删除则不动 */
function restoreLockSnapshot(key: string): void {
    const lockStore = useCollabLockStore()
    const snap = lockStore.peekSnapshot(key)
    const parsed = parseCollabLockKey(key)
    if (!snap || !parsed)
        return
    const save = useSaveStore().save
    if (!save)
        return
    const arr = parsed.type === 'pt' ? save.points
        : parsed.type === 'line' ? save.lines
        : save.textTags
    const target = arr?.find(x => x.id === parsed.id) as unknown as Record<string, unknown> | undefined
    if (!target)
        return
    const src = structuredClone(snap) as unknown as Record<string, unknown>
    for (const k of Object.keys(target)) {
        if (!(k in src))
            delete target[k]
    }
    Object.assign(target, src)
}

export function applyRemoteCollabLock(key: string, holder: string): void {
    const lockStore = useCollabLockStore()
    const conflict = lockStore.applyRemoteLock(key, holder)
    const parsed = parseCollabLockKey(key)
    if (!parsed)
        return
    const envStore = useEnvStore()
    const activeObj = parsed.type === 'pt' ? envStore.activePt
        : parsed.type === 'line' ? envStore.activeLine
        : envStore.activeTextTag
    if (activeObj && activeObj.id === parsed.id) {
        restoreLockSnapshot(key)
        envStore.cancelActive()
    }
    // 选区里的同类型同 id 对象也一并让出（线不会进入选区，只需区分点/标签）
    const selectionStore = useSelectionStore()
    if (conflict || selectionStore.selected.size > 0) {
        for (const s of [...selectionStore.selected]) {
            const sameKind = parsed.type === 'pt' ? ('dir' in s) : (parsed.type === 'tag' && !('dir' in s))
            if (sameKind && s.id === parsed.id) {
                restoreLockSnapshot(key)
                selectionStore.selected.delete(s)
                lockStore.releaseMine(key)
            }
        }
    }
}
