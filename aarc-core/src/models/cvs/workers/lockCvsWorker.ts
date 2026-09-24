import { defineStore } from "pinia";
import { CvsContext } from "../common/cvsContext";
import { Coord } from "aarc-core/models/coord";
import { drawCross } from "aarc-core/utils/drawUtils/drawCross";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useConfigStore } from "aarc-core/models/stores/configStore";
import { parseCollabLockKey, useCollabLockStore } from "aarc-core/models/stores/collabLockStore";
import { useTextTagRectStore } from "aarc-core/models/stores/saveDerived/textTagRectStore";
import { useFormalizedLineStore } from "aarc-core/models/stores/saveDerived/formalizedLineStore";

export interface LockCrossMark {
    center: Coord
    /** 十字臂长（端点到中心的距离） */
    arm: number
    /** 笔宽 */
    width: number
}

const lockCrossColor = '#e02020'
const lockCrossHaloColor = '#ffffff'

/**
 * 协作锁可视化：被其他成员锁定的对象画红色叉（45° 十字，白边垫底保证任何底色上可见）。
 * 画在 active 图层（每 50ms 自动重绘），锁变化无需额外触发主画布渲染
 */
export const useLockCvsWorker = defineStore('lockCvsWorker', () => {
    const saveStore = useSaveStore()
    const configStore = useConfigStore()
    const collabLockStore = useCollabLockStore()
    const textTagRectStore = useTextTagRectStore()
    const formalizedLineStore = useFormalizedLineStore()

    /** 收集所有“被他人锁定且仍存在”的对象的叉标记（纯数据计算，便于测试） */
    function collectLockCrosses(): LockCrossMark[] {
        const marks: LockCrossMark[] = []
        if (!collabLockStore.hasOtherLocks)
            return marks
        const save = saveStore.save
        if (!save)
            return marks
        const baseArm = configStore.config.ptStaSize
        const baseWidth = configStore.config.ptStaLineWidth
        for (const key of collabLockStore.otherLocks.keys()) {
            const parsed = parseCollabLockKey(key)
            if (!parsed)
                continue
            if (parsed.type === 'pt') {
                const pt = saveStore.getPtById(parsed.id)
                if (!pt)
                    continue
                const ratio = saveStore.getLinesDecidedPtSize(pt.id)
                marks.push({
                    center: [...pt.pos],
                    arm: baseArm * ratio * 1.8,
                    width: baseWidth * ratio * 1.5
                })
            }
            else if (parsed.type === 'tag') {
                // 优先用渲染登记的实际包围盒，叉覆盖整个标签；未登记时退化为锚点处固定大小的叉
                let quad: Coord[] | undefined
                textTagRectStore.enumerateTextTagRects((id, item) => {
                    if (id === parsed.id)
                        quad = item.quad
                })
                if (quad) {
                    const cx = quad.reduce((s, c) => s + c[0], 0) / quad.length
                    const cy = quad.reduce((s, c) => s + c[1], 0) / quad.length
                    const cornerDist = (c: Coord) => Math.hypot(c[0] - cx, c[1] - cy)
                    const arm = Math.max(...quad.map(cornerDist)) * 0.8
                    marks.push({ center: [cx, cy], arm, width: baseWidth * 2 })
                }
                else {
                    const tag = saveStore.getTextTagById(parsed.id)
                    if (tag)
                        marks.push({ center: [...tag.pos], arm: baseArm * 2.5, width: baseWidth * 2 })
                }
            }
            else {
                const line = saveStore.getLineById(parsed.id)
                if (!line)
                    continue
                // 每个控制点区间的中点画一个叉，标出被锁范围
                const mids = formalizedLineStore.getLineIntervalMidpoints(line)
                if (mids.length === 0) {
                    // 退化线路（如只剩 1 个控制点，无区间）：退化为在控制点处画叉，保持可见性
                    const pt = line.pts.map(id => saveStore.getPtById(id)).find(p => !!p)
                    if (pt)
                        marks.push({ center: [...pt.pos], arm: baseArm * 2.5, width: baseWidth * 2 })
                    continue
                }
                for (const m of mids)
                    marks.push({ center: m, arm: baseArm * 2.5, width: baseWidth * 2 })
            }
        }
        return marks
    }

    function renderLockCrosses(ctx: CvsContext) {
        for (const m of collectLockCrosses()) {
            drawCross(ctx, {
                pos: m.center,
                angleDeg: 45,
                armLength: m.arm,
                repetitions: [
                    { armWidth: m.width * 2.2, color: lockCrossHaloColor },
                    { armWidth: m.width, color: lockCrossColor }
                ]
            })
        }
    }

    return { collectLockCrosses, renderLockCrosses }
})
