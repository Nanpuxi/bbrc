import { Coord, FormalPt, twinPts2Ray, twinPts2SgnCoord } from "aarc-core/models/coord";
import { Line } from "aarc-core/models/save";
import { WayRel, rayRel } from "aarc-core/utils/rayUtils/rayParallel";
import { applyBias, applyBiasFree } from "aarc-core/utils/coordUtils/coordBias";
import { coordCrossProduct, coordDotProduct, coordSub, makeCoordLength1 } from "aarc-core/utils/coordUtils/coordMath";
import { coordDist } from "aarc-core/utils/coordUtils/coordDist";
import { isZero } from "aarc-core/utils/sgn";
import { isRingByFormalPts } from "aarc-core/utils/lineUtils/isRing";
import { formalArcGeometry, formalCornerRays, freeArcGeometry, freeCornerRays } from "aarc-core/utils/drawUtils/arcGeometry";
import { ArcPrimitive, LinePrimitive, PathPrimitive } from "aarc-core/utils/lineUtils/linePathPrimitives";

/**
 * 转角半径请求的上下文。半径来源的任何变化（线路配置、角度函数、span 样式、缩放等）
 * 都应被隔离在 GetTurnRadiusOf 的实现内部；新增来源所需字段在此扩展即可，
 * 既有处理器与调用方不受影响。
 */
export interface TurnRadiusContext {
    line: Line
    /** 8 方向关系（formal 分支）或自由点内角 theta（free 分支） */
    relOrTheta: WayRel | number
    prevPt: Coord
    nowPt: Coord
    nextPt: Coord
    prevDist: number
    nextDist: number
}

export type GetTurnRadiusOf = (ctx: TurnRadiusContext) => number

/** 过渡期适配：把旧的位置参数签名（configStore.getTurnRadiusOf）包装为上下文签名 */
export function adaptLegacyGetTurnRadiusOf(
    legacy: (line: Line, relOrTheta: WayRel | number) => number,
): GetTurnRadiusOf {
    return ctx => legacy(ctx.line, ctx.relOrTheta)
}

/** 转角处理结果：相邻直线图元的截断距离与转角图元 */
export interface CornerResult {
    /** 前一直线图元在顶点侧截断的长度 */
    trimPrev: number
    /** 后一直线图元在顶点侧截断的长度 */
    trimNext: number
    /** 顶点回退 trimPrev 后的切点 */
    prevSok: Coord
    /** 顶点前进 trimNext 后的切点 */
    nextSok: Coord
    /** 转角图元（弧；退化时为连接两切点的直线） */
    primitive: PathPrimitive
}

export interface CornerHandlerContext {
    prevPt: Coord
    nowPt: Coord
    nextPt: Coord
    /** 转角弧的区间索引标注（顶点 formal 点的 afterIdxEqv） */
    arcSpanIdx: number
    lineInfo: Line
    getTurnRadiusOf: GetTurnRadiusOf
}

/**
 * 转角处理器：识别一种转角几何（8 方向圆角、自由点圆角、未来的贝塞尔圆角等），
 * 输出切点与转角图元。通过注册表分派，注册即对绘制与采样两端同时生效。
 */
export interface CornerHandler {
    match(prevFormal: FormalPt, nowFormal: FormalPt, nextFormal: FormalPt): boolean
    buildCorner(hctx: CornerHandlerContext): CornerResult
}

/** 由两切点与顶点构造转角弧图元；无法求圆心（近退化）时退化为直线 */
function cornerArcPrimitive(
    prevSok: Coord,
    nowPt: Coord,
    nextSok: Coord,
    mode: 'formal' | 'free',
    arcSpanIdx: number,
): PathPrimitive {
    const span: readonly [number, number] = [arcSpanIdx, arcSpanIdx]
    const geo = mode === 'formal'
        ? formalArcGeometry(...formalCornerRays(prevSok, nowPt, nextSok))
        : freeArcGeometry(...freeCornerRays(prevSok, nowPt, nextSok))
    if (!geo)
        return new LinePrimitive(prevSok, nextSok, span)
    return ArcPrimitive.fromGeometry(geo, prevSok, span)
}

export const formalCornerHandler: CornerHandler = {
    match(prevFormal, nowFormal, nextFormal) {
        return !prevFormal.free && !nowFormal.free && !nextFormal.free
    },
    buildCorner({ prevPt, nowPt, nextPt, arcSpanIdx, lineInfo, getTurnRadiusOf }): CornerResult {
        const prevDist = coordDist(prevPt, nowPt)
        const nextDist = coordDist(nowPt, nextPt)
        const rel = rayRelLocal(prevPt, nowPt, nextPt)
        const turnRadius = getTurnRadiusOf({ line: lineInfo, relOrTheta: rel, prevPt, nowPt, nextPt, prevDist, nextDist })
        // 实际圆角半径不能超过前后线段长度的一半，防止弧越界
        const d = Math.min(turnRadius, prevDist / 2, nextDist / 2)
        const prevSok = applyBias(nowPt, twinPts2SgnCoord(nowPt, prevPt), d)
        const nextSok = applyBias(nowPt, twinPts2SgnCoord(nowPt, nextPt), d)
        const primitive = cornerArcPrimitive(prevSok, nowPt, nextSok, 'formal', arcSpanIdx)
        return { trimPrev: d, trimNext: d, prevSok, nextSok, primitive }
    },
}

export const freeCornerHandler: CornerHandler = {
    match(prevFormal, nowFormal, nextFormal) {
        return !!(prevFormal.free || nowFormal.free || nextFormal.free)
    },
    buildCorner({ prevPt, nowPt, nextPt, arcSpanIdx, lineInfo, getTurnRadiusOf }): CornerResult {
        const span: readonly [number, number] = [arcSpanIdx, arcSpanIdx]
        const v1 = coordSub(nowPt, prevPt)
        const v2 = coordSub(nextPt, nowPt)
        const len1 = Math.hypot(v1[0], v1[1])
        const len2 = Math.hypot(v2[0], v2[1])
        // 任一段退化成长度为 0，或两段近乎平行（同向/反向）：不画弧，退化为过顶点的直线
        if (isZero(len1) || isZero(len2))
            return degenerateCorner(nowPt, span)
        const u1 = makeCoordLength1(v1)
        const u2 = makeCoordLength1(v2)
        const dot = coordDotProduct(u1, u2)
        const cross = coordCrossProduct(u1, u2)
        if (isZero(cross))
            return degenerateCorner(nowPt, span)
        // 内角 theta = atan2(|cross|, -dot)，范围 [0, pi]
        const theta = Math.atan2(Math.abs(cross), -dot)
        const turnRadius = getTurnRadiusOf({ line: lineInfo, relOrTheta: theta, prevPt, nowPt, nextPt, prevDist: len1, nextDist: len2 })
        const d = Math.min(
            turnRadius / Math.tan(theta / 2),
            len1 / 2,
            len2 / 2,
        )
        const prevSok = applyBiasFree(nowPt, [-u1[0], -u1[1]] as Coord, d)
        const nextSok = applyBiasFree(nowPt, u2, d)
        const primitive = cornerArcPrimitive(prevSok, nowPt, nextSok, 'free', arcSpanIdx)
        return { trimPrev: d, trimNext: d, prevSok, nextSok, primitive }
    },
}

function degenerateCorner(nowPt: Coord, span: readonly [number, number]): CornerResult {
    const primitive = new LinePrimitive(nowPt, nowPt, span)
    return { trimPrev: 0, trimNext: 0, prevSok: nowPt, nextSok: nowPt, primitive }
}

/** 转角处理器注册表，按顺序取首个 match 的处理器 */
export const cornerHandlers: CornerHandler[] = [formalCornerHandler, freeCornerHandler]

function rayRelLocal(prevPt: Coord, nowPt: Coord, nextPt: Coord): WayRel {
    return rayRel(twinPts2Ray(prevPt, nowPt), twinPts2Ray(nowPt, nextPt))
}

export interface BuildLinePathGeometryOptions {
    /** 简化模式：不处理转角，直接输出 formal 折线（与 linkPts 的 simplify 分支一致） */
    simplify?: boolean
}

/**
 * 把 formal 点序列构造成与屏幕渲染同源的几何图元序列（直线段 + 转角弧交替）。
 *
 * 构造步骤与 linkPts 的转角循环同构：
 * 1. 依 formal 点序列生成初始直线段（simplify 模式下即全部输出）；
 * 2. 逐顶点查注册表得转角处理器，截断相邻直线段并插入转角图元；
 * 3. 非环线从首点走到末点；环线从头部切点开始，追加回到头部切点的闭合段；
 * 4. 零长图元保留在序列中（绘制为无害 no-op，采样行走天然跳过 length 为 0 的图元）。
 */
export function buildLinePathGeometry(
    formalPts: FormalPt[],
    lineInfo: Line,
    getTurnRadiusOf: GetTurnRadiusOf,
    options?: BuildLinePathGeometryOptions,
): PathPrimitive[] {
    if (formalPts.length <= 1)
        return []
    const pts = formalPts.map(x => x.pos)
    const isRingLine = !!isRingByFormalPts(formalPts)
    const n = pts.length

    const segSpan = (j: number): readonly [number, number] =>
        [formalPts[j].afterIdxEqv, formalPts[j + 1].afterIdxEqv]

    if (options?.simplify) {
        const prims: PathPrimitive[] = []
        for (let j = 0; j < n - 1; j++)
            prims.push(new LinePrimitive(pts[j], pts[j + 1], segSpan(j)))
        return prims
    }

    // 确定转角顶点索引范围（与 linkPts 一致）
    let cornerStartIdx: number
    let cornerEndIdx: number // 包含该索引
    let getPrevIdx: (i: number) => number
    if (!isRingLine) {
        cornerStartIdx = 1
        cornerEndIdx = n - 2
        getPrevIdx = i => i - 1
    } else {
        cornerStartIdx = 0
        cornerEndIdx = n - 2
        getPrevIdx = i => i === 0 ? n - 2 : i - 1
    }

    interface CornerAt {
        vertexIdx: number
        result: CornerResult
    }
    const corners: CornerAt[] = []
    for (let i = cornerStartIdx; i <= cornerEndIdx; i++) {
        const prevFormal = formalPts[getPrevIdx(i)]
        const nowFormal = formalPts[i]
        const nextFormal = formalPts[i + 1]
        const handler = cornerHandlers.find(h => h.match(prevFormal, nowFormal, nextFormal)) ?? formalCornerHandler
        const result = handler.buildCorner({
            prevPt: pts[getPrevIdx(i)],
            nowPt: pts[i],
            nextPt: pts[i + 1],
            arcSpanIdx: nowFormal.afterIdxEqv,
            lineInfo,
            getTurnRadiusOf,
        })
        corners.push({ vertexIdx: i, result })
    }

    const prims: PathPrimitive[] = []
    if (isRingLine && corners.length > 0) {
        // 环线：从头部转角的弧/直线开始，段间插入直线，最后闭合回头部切点
        const first = corners[0]
        prims.push(first.result.primitive)
        for (let k = 1; k < corners.length; k++) {
            const prev = corners[k - 1]
            const cur = corners[k]
            // 两转角之间是 formal 段 prev.vertexIdx → cur.vertexIdx（cur 与 prev 相邻）
            prims.push(new LinePrimitive(prev.result.nextSok, cur.result.prevSok, segSpan(prev.vertexIdx)))
            prims.push(cur.result.primitive)
        }
        const last = corners[corners.length - 1]
        // 闭合段：末转角切点回到头部切点，覆盖 formal 段 last.vertexIdx → n-1(=0)
        prims.push(new LinePrimitive(last.result.nextSok, first.result.prevSok, segSpan(last.vertexIdx)))
        return prims
    }

    // 非环线：首段直线 + （转角, 段直线）交替 + 末段直线
    let cursor: Coord = pts[0]
    let cursorSegStart = 0 // cursor 所在 formal 段的起点索引
    for (const corner of corners) {
        prims.push(new LinePrimitive(cursor, corner.result.prevSok, segSpan(cursorSegStart)))
        prims.push(corner.result.primitive)
        cursor = corner.result.nextSok
        cursorSegStart = corner.vertexIdx
    }
    prims.push(new LinePrimitive(cursor, pts[n - 1], segSpan(cursorSegStart)))
    return prims
}
