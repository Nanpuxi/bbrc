import { Coord } from "aarc-core/models/coord";
import { isSameCoord } from "aarc-core/utils/sgn";
import { PathPrimitive, pointAtArcLength, totalPathLength, walkEpsilon } from "aarc-core/utils/lineUtils/linePathPrimitives";

/**
 * 沿几何图元序列按固定间隔等距采样。行走循环只调用 `length()/pointAt()`，
 * 不 switch 图元种类——新增贝塞尔、样条等图元时本函数零改动。
 *
 * @param prims 由 buildLinePathGeometry 得到的图元序列
 * @param interval 世界坐标单位下的间隔
 * @param includeEnds 是否包含路径起点/终点（环线首尾重合，不会重复输出）
 */
export function sampleLinePath(
    prims: PathPrimitive[],
    interval: number,
    includeEnds = true,
): Coord[] {
    const out: Coord[] = []
    if (prims.length === 0 || !(interval > 0))
        return out
    const total = totalPathLength(prims)
    if (!(total > 0))
        return out

    let lastEmittedS: number | undefined
    if (includeEnds) {
        out.push(prims[0].start())
        lastEmittedS = 0
    }

    let s = interval // 下一个采样点的弧长位置
    let consumed = 0
    for (const p of prims) {
        const L = p.length()
        const end = consumed + L
        // s 贴近 total 的点不在此输出：环线即起点（不重复），非环线由收尾的终点补点输出精确终点
        while (s <= end + walkEpsilon && s < total - walkEpsilon) {
            out.push(p.pointAt(Math.min(Math.max(s - consumed, 0), L)))
            lastEmittedS = s
            s += interval
        }
        consumed = end
    }

    if (includeEnds && (lastEmittedS === undefined || total - lastEmittedS > interval * 1e-6)) {
        const last = prims[prims.length - 1]
        const endPt = last.pointAt(last.length())
        // 环线首尾切点重合，行走自然闭合，不重复输出首点
        if (!(out.length > 0 && isSameCoord(endPt, out[0])))
            out.push(endPt)
    }
    return out
}

export { pointAtArcLength, totalPathLength }

/**
 * 第 idx 个控制点区间（afterIdxEqv 语义）覆盖的弧长范围 [start, end)。
 *
 * 归属约定：直线段归属其起点 formal 点的 afterIdxEqv 区间；
 * 转角弧归属顶点的 afterIdxEqv 区间（弧跨两个区间，近似类需求下取一侧）。
 * 因此“区间 i 的起点”恰好包含位于控制点 i 处的转角弧，与“第 i 段从控制点 i 出发”的直觉一致。
 *
 * 供“区间中点”类需求使用：中点 = pointAtArcLength(prims, (start + end) / 2)，是精确解而非采样近似。
 */
export function intervalArcRange(prims: PathPrimitive[], idx: number): [number, number] | undefined {
    let start: number | undefined
    let end: number | undefined
    let consumed = 0
    for (const p of prims) {
        if (p.spanIdxRange[0] === idx) {
            if (start === undefined)
                start = consumed
            end = consumed + p.length()
        }
        consumed += p.length()
    }
    if (start === undefined || end === undefined)
        return undefined
    return [start, end]
}
