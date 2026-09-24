import { Coord } from "aarc-core/models/coord";
import { PathPrimitive, pointAtArcLength } from "aarc-core/utils/lineUtils/linePathPrimitives";
import { intervalArcRange } from "aarc-core/utils/lineUtils/sampleLinePath";

/**
 * 单个控制点区间的中点（精确解：弧长范围取半后 pointAtArcLength）。
 * 区间不存在（或整段零长）时返回 undefined。
 */
export function intervalMidpoint(prims: PathPrimitive[], idx: number): Coord | undefined {
    const range = intervalArcRange(prims, idx)
    if (!range)
        return undefined
    return pointAtArcLength(prims, (range[0] + range[1]) / 2)
}

/**
 * 所有控制点区间的中点，按路径走向排序。
 *
 * 遍历图元 spanIdxRange[0] 的 distinct 值（保持图元顺序即路径顺序），
 * 跳过 intervalArcRange 无结果的索引。本函数不感知 Line/formal 点/半径来源，
 * 任何能构造出 PathPrimitive[] 的调用方都可直接使用。
 */
export function intervalMidpoints(prims: PathPrimitive[]): Coord[] {
    const out: Coord[] = []
    const seen = new Set<number>()
    for (const p of prims) {
        const idx = p.spanIdxRange[0]
        if (seen.has(idx))
            continue
        seen.add(idx)
        const mid = intervalMidpoint(prims, idx)
        if (mid)
            out.push(mid)
    }
    return out
}
