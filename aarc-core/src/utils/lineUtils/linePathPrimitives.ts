import { Coord } from "aarc-core/models/coord";
import { coordDist } from "aarc-core/utils/coordUtils/coordDist";
import { CvsContext } from "aarc-core/models/cvs/common/cvsContext";
import { ArcGeometry } from "aarc-core/utils/drawUtils/arcGeometry";

/**
 * 一维路径图元：采样与绘制都只认识图元，不认识“线”。
 *
 * 新增渲染几何（贝塞尔、圆弧段等）时只需新增一个实现类，
 * `sampleLinePath` 行走循环与 `linkPts` 绘制循环均不感知图元种类。
 */
export interface PathPrimitive {
    readonly kind: string
    /**
     * 该图元覆盖的原控制点区间索引（afterIdxEqv 语义）：
     * [图元所在线段起点的 afterIdxEqv, 终点的 afterIdxEqv]。
     * 转角弧跨两个区间，约定归属转角顶点自身的 afterIdxEqv（近似类需求足够）。
     */
    readonly spanIdxRange: readonly [number, number]
    /** 图元的长度（世界坐标单位），实现须缓存或 O(1) 计算 */
    length(): number
    /** 图元起点 */
    start(): Coord
    /** 距图元起点的弧长 s ∈ [0, length()] 处的点 */
    pointAt(s: number): Coord
    /** 追加到 canvas 路径（假定当前点已位于图元起点） */
    appendTo(ctx: CvsContext): void
}

export class LinePrimitive implements PathPrimitive {
    readonly kind = 'line' as const
    private _len: number | undefined
    constructor(
        readonly p0: Coord,
        readonly p1: Coord,
        readonly spanIdxRange: readonly [number, number],
    ) {}
    length(): number {
        if (this._len === undefined)
            this._len = coordDist(this.p0, this.p1)
        return this._len
    }
    start(): Coord {
        return this.p0
    }
    end(): Coord {
        return this.p1
    }
    pointAt(s: number): Coord {
        const L = this.length()
        if (L <= 0)
            return [...this.p0] as Coord
        if (s >= L)
            return [...this.p1] as Coord
        if (s <= 0)
            return [...this.p0] as Coord
        const t = s / L
        return [this.p0[0] + (this.p1[0] - this.p0[0]) * t, this.p0[1] + (this.p1[1] - this.p0[1]) * t]
    }
    appendTo(ctx: CvsContext): void {
        ctx.lineTo(...this.p1)
    }
}

export class ArcPrimitive implements PathPrimitive {
    readonly kind = 'arc' as const
    /** 有向扫掠角（canvas 坐标系，逆时针为负），|sweep| = length / r */
    private _sweep: number | undefined
    constructor(
        readonly center: Coord,
        readonly r: number,
        readonly startAngle: number,
        readonly endAngle: number,
        readonly ccw: boolean,
        /** 弧起点（切点）。canvas 用角度重画弧，但 pointAt(0)/start 需要精确切点 */
        readonly startPoint: Coord,
        readonly spanIdxRange: readonly [number, number],
    ) {}
    static fromGeometry(geo: ArcGeometry, startPoint: Coord, spanIdxRange: readonly [number, number]): ArcPrimitive {
        return new ArcPrimitive(geo.center, geo.radius, geo.startAngle, geo.endAngle, geo.counterClockwise, startPoint, spanIdxRange)
    }
    /** 与 canvas ctx.arc 相同的扫掠语义得到的有向角：ccw=false 沿角度增大方向 */
    private sweep(): number {
        if (this._sweep === undefined) {
            const twoPi = 2 * Math.PI
            const norm = (x: number) => ((x % twoPi) + twoPi) % twoPi
            this._sweep = this.ccw
                ? -norm(this.startAngle - this.endAngle)
                : norm(this.endAngle - this.startAngle)
        }
        return this._sweep
    }
    length(): number {
        return this.r * Math.abs(this.sweep())
    }
    start(): Coord {
        return this.startPoint
    }
    pointAt(s: number): Coord {
        const L = this.length()
        const sweep = this.sweep()
        if (L <= 0)
            return [...this.startPoint] as Coord
        const t = Math.min(Math.max(s, 0), L) / L
        const ang = this.startAngle + sweep * t
        return [this.center[0] + this.r * Math.cos(ang), this.center[1] + this.r * Math.sin(ang)]
    }
    appendTo(ctx: CvsContext): void {
        ctx.arc(...this.center, this.r, this.startAngle, this.endAngle, this.ccw)
    }
}

/** 沿图元行走时的浮点容差（世界坐标单位） */
export const walkEpsilon = 1e-9

/** 折线整体弧长 */
export function totalPathLength(prims: PathPrimitive[]): number {
    let total = 0
    for (const p of prims)
        total += p.length()
    return total
}

/** 沿图元序列在弧长 s 处取点（s 越界时钳制到路径端点） */
export function pointAtArcLength(prims: PathPrimitive[], s: number): Coord {
    if (prims.length === 0)
        throw new Error('pointAtArcLength: 空图元序列')
    let consumed = 0
    for (const p of prims) {
        const L = p.length()
        if (s <= consumed + L + walkEpsilon)
            return p.pointAt(clamp(s - consumed, 0, L))
        consumed += L
    }
    const last = prims[prims.length - 1]
    return last.pointAt(last.length())
}

function clamp(x: number, lo: number, hi: number): number {
    return Math.min(Math.max(x, lo), hi)
}
