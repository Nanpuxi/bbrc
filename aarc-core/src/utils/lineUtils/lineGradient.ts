import { Coord, FormalPt } from "aarc-core/models/coord";
import { Line, LineType } from "aarc-core/models/save";
import { CvsContext } from "aarc-core/models/cvs/common/cvsContext";

/**
 * 支线渐变：末端连接检测结果。
 * “接在另一条线上”指双方共享一个控制点（同一 point id），仅视觉重合不算。
 */
export interface LineAttachInfo {
    /** 0 = pts[0] 端，1 = pts[last] 端 */
    end: 0 | 1
    targetLine: Line
}

/**
 * 支线渐变解析结果（逻辑坐标）。
 * 渐变轴 from→to：from 端为主色（支线自身 color，即 parent 颜色），to 端为目标色。
 */
export interface LineGradientResolution {
    from: Coord
    to: Coord
    /** 渐变作用范围（沿渐变轴比例 0..1） */
    range: [number, number]
    fromColor: string
    toColor: string
}

/** 自动范围（沿渐变轴比例），见 docs/branch-line-gradient.md 决策 D */
export const LINE_GRADIENT_AUTO_RANGE: [number, number] = [0.25, 0.75]

/**
 * 检测支线某一末端"接在"的线路（共享控制点 id；地形线与自身不参与）。
 * 一个点被多条线路共享时只返回第一条，需要全部候选请用 {@link attachesOfEnd}。
 */
export function attachOfEnd(line: Line, lines: Line[] | undefined, end: 0 | 1): Line | undefined {
    return attachesOfEnd(line, lines, end)[0]
}

/**
 * 检测支线某一末端"接在"的**所有**线路（同一控制点可被多条线路共享）。
 */
export function attachesOfEnd(line: Line, lines: Line[] | undefined, end: 0 | 1): Line[] {
    if (!lines || line.pts.length < 2)
        return []
    const ptId = end === 0 ? line.pts[0] : line.pts[line.pts.length - 1]
    return lines.filter(x => x.type === LineType.common && x.id !== line.id && x.pts.includes(ptId))
}

/**
 * 检测支线末端"接在"的另一条线路（自动目标色来源）。
 * 同一端有多条候选时优先非 parent；两端都接线时非 parent 端优先（决策 C），
 * 都为/都不是 parent 时取 pts[last] 端。
 * 环线（pts[0] === pts[last]）不参与。
 */
export function detectLineAttachEnd(line: Line, lines: Line[] | undefined): LineAttachInfo | undefined {
    if (!lines || line.pts.length < 2)
        return undefined
    if (line.pts[0] === line.pts[line.pts.length - 1])
        return undefined
    const pick = (cands: Line[]) => cands.find(x => x.id !== line.parent) ?? cands[0]
    const a0 = pick(attachesOfEnd(line, lines, 0))
    const a1 = pick(attachesOfEnd(line, lines, 1))
    if (a0 && a1) {
        if (a0.id !== line.parent && a1.id === line.parent)
            return { end: 0, targetLine: a0 }
        return { end: 1, targetLine: a1 }
    }
    if (a0)
        return { end: 0, targetLine: a0 }
    if (a1)
        return { end: 1, targetLine: a1 }
    return undefined
}

function validateRange(range: [number, number] | undefined): [number, number] {
    if (range) {
        const [a, b] = range
        // 允许 a === b：表现为在 a 处瞬间换色
        if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b <= 1 && a <= b)
            return [a, b]
    }
    return LINE_GRADIENT_AUTO_RANGE
}

/**
 * 解析支线渐变为可渲染的描述。
 * - 主色 = getLineColor(line)（支线 color 跟随 parent，已含淡化）；
 * - 目标色来源优先级："指定线路"（targetLine）> 手动颜色（targetColor）> 自动
 *   （连接线路的整线主色，决策 G）；自动模式下未检测到连接则返回 undefined（回退单色）；
 * - 自动角度 = 两端点连线方向（决策 D）；
 *   手动角度以两端点中点为轴心，目标色一侧自动旋转到 targetEnd 方向；
 * - 自动范围 = LINE_GRADIENT_AUTO_RANGE（决策 D）。
 *
 * 主色端/目标色端的判定：目标色来自某条线路时，目标色端 = **接该线路的末端**
 * （与该线路颜色无缝衔接）；目标色为手动颜色（无线路来源）时，主色端优先取
 * 接在 parent 上的末端，其次取未连接的一端；两端状态相同（都接/都游离）时
 * 主色端取 pts[0]。
 *
 * @param formalPts 线路 formal 点（自动角度/轴端点来源）；不足 2 个时返回 undefined
 * @param getLineColor 取线路实际颜色（含淡化），调用方注入以便测试
 */
export function resolveLineGradient(
    line: Line,
    formalPts: FormalPt[] | undefined,
    lines: Line[] | undefined,
    getLineColor: (line: Line) => string
): LineGradientResolution | undefined {
    const cfg = line.gradient
    if (!cfg || !line.parent)
        return undefined
    if (!formalPts || formalPts.length < 2)
        return undefined
    const mainColor = getLineColor(line)
    // 目标色来源：指定线路 > 手动颜色 > 自动连接检测
    let targetColor: string | undefined
    let targetSourceLine: Line | undefined
    if (cfg.targetLine != null) {
        targetSourceLine = lines?.find(x => x.id === cfg.targetLine)
        if (targetSourceLine)
            targetColor = getLineColor(targetSourceLine)
    }
    if (!targetColor && cfg.targetColor)
        targetColor = cfg.targetColor
    if (!targetColor) {
        const attach = detectLineAttachEnd(line, lines)
        if (!attach)
            return undefined
        targetColor = getLineColor(attach.targetLine)
        targetSourceLine = attach.targetLine
    }
    if (!targetColor)
        return undefined
    const range = validateRange(cfg.range)
    const firstPos = formalPts[0].pos
    const lastPos = formalPts[formalPts.length - 1].pos
    // 主色端判定（见函数注释）
    const firstAttaches = attachesOfEnd(line, lines, 0)
    const lastAttaches = attachesOfEnd(line, lines, 1)
    let mainEndIsFirst: boolean
    if (targetSourceLine && firstAttaches.some(x => x.id === targetSourceLine.id) && !lastAttaches.some(x => x.id === targetSourceLine.id))
        mainEndIsFirst = false    // 目标色端 = 首端（接目标来源线路）
    else if (targetSourceLine && lastAttaches.some(x => x.id === targetSourceLine.id) && !firstAttaches.some(x => x.id === targetSourceLine.id))
        mainEndIsFirst = true     // 目标色端 = 末端
    else if (firstAttaches.some(x => x.id === line.parent))
        mainEndIsFirst = true
    else if (lastAttaches.some(x => x.id === line.parent))
        mainEndIsFirst = false
    else if (firstAttaches.length === 0 && lastAttaches.length > 0)
        mainEndIsFirst = true
    else if (firstAttaches.length > 0 && lastAttaches.length === 0)
        mainEndIsFirst = false
    else
        mainEndIsFirst = true
    let mainEnd: Coord = mainEndIsFirst ? firstPos : lastPos
    let targetEnd: Coord = mainEndIsFirst ? lastPos : firstPos
    if (cfg.angle !== undefined) {
        // 手动角度：轴心为两端点中点，把目标色的一侧旋转到 targetEnd 方向
        const mid: Coord = [(mainEnd[0] + targetEnd[0]) / 2, (mainEnd[1] + targetEnd[1]) / 2]
        const half = Math.hypot(targetEnd[0] - mainEnd[0], targetEnd[1] - mainEnd[1]) / 2 || 1
        let dir: Coord = [Math.cos(cfg.angle), Math.sin(cfg.angle)]
        const toSide: Coord = [mid[0] + dir[0] * half, mid[1] + dir[1] * half]
        const nearTarget = Math.hypot(toSide[0] - targetEnd[0], toSide[1] - targetEnd[1])
            <= Math.hypot(toSide[0] - mainEnd[0], toSide[1] - mainEnd[1])
        if (!nearTarget)
            dir = [-dir[0], -dir[1]]
        mainEnd = [mid[0] - dir[0] * half, mid[1] - dir[1] * half]
        targetEnd = [mid[0] + dir[0] * half, mid[1] + dir[1] * half]
    }
    return { from: mainEnd, to: targetEnd, range, fromColor: mainColor, toColor: targetColor }
}

/**
 * 由解析结果创建 CanvasGradient。
 * 渐变轴向两端各外延半个线宽（逻辑单位），避免方头端帽截断渐变；
 * 范围以外的区间填充纯色（决策 D 的 0.25-0.75 语义）。
 */
export function buildLineGradient(
    ctx: CvsContext | CanvasRenderingContext2D,
    res: LineGradientResolution,
    lineWidthBase: number
): CanvasGradient {
    const dx = res.to[0] - res.from[0]
    const dy = res.to[1] - res.from[1]
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const ext = lineWidthBase / 2
    const g = ctx.createLinearGradient(
        res.from[0] - ux * ext, res.from[1] - uy * ext,
        res.to[0] + ux * ext, res.to[1] + uy * ext
    )
    const [r0, r1] = res.range
    g.addColorStop(0, res.fromColor)
    g.addColorStop(r0, res.fromColor)
    g.addColorStop(r1, res.toColor)
    g.addColorStop(1, res.toColor)
    return g
}
