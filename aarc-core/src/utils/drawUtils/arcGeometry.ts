import { Coord, FormalRay, FreeRay, twinPts2Ray, twinPts2SgnCoord, wayAngle } from "aarc-core/models/coord";
import { rayRel } from "../rayUtils/rayParallel";
import { rayAfterRotate90, rayAfterRotate90Free } from "../rayUtils/rayRotate";
import { rayIntersect } from "../rayUtils/rayIntersection";
import { coordDist } from "../coordUtils/coordDist";
import { coordCrossProduct, coordSub, makeCoordLength1 } from "../coordUtils/coordMath";
import { isZero } from "aarc-core/utils/sgn";

/** 一段圆弧的几何参数（与 canvas ctx.arc 的参数一一对应） */
export interface ArcGeometry {
    center: Coord
    radius: number
    startAngle: number
    endAngle: number
    counterClockwise: boolean
}

/**
 * 由两条 8 方向射线求转角弧的几何（与 drawArcByFormalRays 的画法同源）。
 * 射线约定：a.source 为弧起点、b.source 为弧终点，方向均为“沿着线的前进方向”。
 * 两段平行或无法求圆心时返回 undefined（调用方退化为直线）。
 */
export function formalArcGeometry(a: FormalRay, b: FormalRay, radius?: number): ArcGeometry | undefined {
    const rel = rayRel(a, b)
    if (rel === 'parallel')
        return undefined
    const ap = rayAfterRotate90(a)
    const bp = rayAfterRotate90(b)
    const center = rayIntersect(ap, bp)
    if (!center)
        return undefined
    if (!radius) {
        radius = coordDist(a.source, center)
    }
    const counterClockwise = coordCrossProduct(a.way, b.way) < 0
    const startAngle = wayAngle(twinPts2SgnCoord(center, a.source))
    const endAngle = wayAngle(twinPts2SgnCoord(center, b.source))
    return { center, radius, startAngle, endAngle, counterClockwise }
}

/**
 * 由两条浮点方向射线（自由点转角）求转角弧的几何（与 drawArcByFreeRays 的画法同源）。
 * 近乎平行或无法求圆心时返回 undefined（调用方退化为直线）。
 */
export function freeArcGeometry(a: FreeRay, b: FreeRay, radius?: number): ArcGeometry | undefined {
    const au = makeCoordLength1(a.way)
    const bu = makeCoordLength1(b.way)
    const cross = coordCrossProduct(au, bu)
    if (isZero(cross))
        return undefined
    // 分别沿 a、b 的方向旋转 90° 得到垂线方向，交点即为圆心
    const na = rayAfterRotate90Free({ source: a.source, way: au }).way
    const nb = rayAfterRotate90Free({ source: b.source, way: bu }).way
    // 解 a.source + s*na = b.source + t*nb
    const denom = coordCrossProduct(na, nb)
    if (isZero(denom))
        return undefined
    const s = coordCrossProduct(coordSub(b.source, a.source), nb) / denom
    const center: Coord = [a.source[0] + s * na[0], a.source[1] + s * na[1]]
    if (!radius) {
        radius = coordDist(a.source, center)
    }
    const startAngle = Math.atan2(a.source[1] - center[1], a.source[0] - center[0])
    const endAngle = Math.atan2(b.source[1] - center[1], b.source[0] - center[0])
    let delta = endAngle - startAngle
    while (delta <= -Math.PI) delta += 2 * Math.PI
    while (delta > Math.PI) delta -= 2 * Math.PI
    const counterClockwise = delta < 0
    return { center, radius, startAngle, endAngle, counterClockwise }
}

/** 由切点-顶点-切点三点构造 formal 模式射线对（与 drawArcByThreePoints 的 'formal' 分支一致） */
export function formalCornerRays(prevSok: Coord, nowPt: Coord, nextSok: Coord): [FormalRay, FormalRay] {
    const ray0 = twinPts2Ray(prevSok, nowPt)
    const ray1 = twinPts2Ray(nowPt, nextSok)
    ray1.source = nextSok
    return [ray0, ray1]
}

/** 由切点-顶点-切点三点构造 free 模式射线对（与 drawArcByThreePoints 的 'free' 分支一致） */
export function freeCornerRays(prevSok: Coord, nowPt: Coord, nextSok: Coord): [FreeRay, FreeRay] {
    const ray0: FreeRay = { source: prevSok, way: makeCoordLength1(coordSub(nowPt, prevSok)) }
    const ray1: FreeRay = { source: nextSok, way: makeCoordLength1(coordSub(nextSok, nowPt)) }
    return [ray0, ray1]
}
