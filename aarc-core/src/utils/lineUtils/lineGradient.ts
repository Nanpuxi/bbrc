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

/** 自动范围（沿渐变轴比例），见 docs/rendering/branch-line-gradient.md 决策 D */
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
 * - 端点局部淡化：传入 getPtColor 时，主色端取**主色端所在控制点**的局部实际颜色
 *   （该点所在 span 可能因 TimeSlice 被局部时间淡化），目标色端同理取**接续共享点**
 *   在对方线路上的局部实际颜色；取不到时回退整线颜色。手动指定的 targetColor
 *   是字面颜色，不做淡化处理（docs/rendering/branch-line-gradient.md §8.5-P2）；
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
 * @param getPtColor 取线路在某控制点处的接点局部颜色（含 span 级淡化与方向感知，
 * 见 getJunctionPtColor）；approach 为支线驶向接点的方向（本体→接点，两端统一），
 * 由本函数从 formalPts 计算并传入；主色端调用时第一个参数为 parent 线路，
 * 最后一个参数传入支线自身 id（selfLineId）
 */
export function resolveLineGradient(
    line: Line,
    formalPts: FormalPt[] | undefined,
    lines: Line[] | undefined,
    getLineColor: (line: Line) => string,
    getPtColor?: (line: Line, ptId: number, approach?: Coord, selfLineId?: number) => string | undefined
): LineGradientResolution | undefined {
    const cfg = line.gradient
    if (!cfg || !line.parent)
        return undefined
    if (!formalPts || formalPts.length < 2)
        return undefined
    // 目标色来源：指定线路 > 手动颜色 > 自动连接检测。
    // targetPtId = 与对方线路共享的控制点，用于端点局部取色
    let targetColor: string | undefined
    let targetSourceLine: Line | undefined
    let targetPtId: number | undefined
    if (cfg.targetLine != null) {
        targetSourceLine = lines?.find(x => x.id === cfg.targetLine)
        if (targetSourceLine) {
            targetColor = getLineColor(targetSourceLine)
            targetPtId = [line.pts[0], line.pts[line.pts.length - 1]]
                .find(id => targetSourceLine!.pts.includes(id))
        }
    }
    if (!targetColor && cfg.targetColor)
        targetColor = cfg.targetColor
    if (!targetColor) {
        const attach = detectLineAttachEnd(line, lines)
        if (!attach)
            return undefined
        targetColor = getLineColor(attach.targetLine)
        targetSourceLine = attach.targetLine
        targetPtId = attach.end === 0 ? line.pts[0] : line.pts[line.pts.length - 1]
    }
    if (!targetColor)
        return undefined
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
    // 端点局部淡化（方向感知）：主色端跟随主色端点的接点局部颜色，目标色端跟随共享点
    // 在对方线路上的接点局部颜色；手动字面 targetColor 不做淡化
    // approach = 支线"朝向"的方向（单位向量）：两端统一为支线驶向接点的方向
    //（本体 → 接点，人工测试确认）——其穿过接点的延长线指向哪一侧，就取哪一侧的颜色
    const approachAt = (end: 0 | 1): Coord | undefined => {
        const lastIdx = formalPts.length - 1
        const from = end === 0 ? formalPts[1].pos : formalPts[lastIdx - 1].pos
        const to = end === 0 ? formalPts[0].pos : formalPts[lastIdx].pos
        const d: Coord = [to[0] - from[0], to[1] - from[1]]
        const len = Math.hypot(d[0], d[1])
        return len > 1e-9 ? [d[0] / len, d[1] / len] : undefined
    }
    const mainPtId = mainEndIsFirst ? line.pts[0] : line.pts[line.pts.length - 1]
    // 主色端接在 parent 上：采样 parent 在该接点处的方向感知局部颜色（parent 侧
    // span 局部淡化时跟随淡化）；selfLineId 供注入方在支线自身端 span 已淡化时
    // 优先跟随自身（支线该端落笔已回退纯色，渐变起点与之衔接）
    const parentLine = line.parent != null ? lines?.find(x => x.id === line.parent) : undefined
    const mainColor = getPtColor?.(parentLine ?? line, mainPtId, approachAt(mainEndIsFirst ? 0 : 1), line.id)
        ?? getLineColor(line)
    if (targetSourceLine && targetPtId != null) {
        const ptColor = getPtColor?.(targetSourceLine, targetPtId,
            approachAt(targetPtId === line.pts[line.pts.length - 1] ? 1 : 0))
        if (ptColor)
            targetColor = ptColor
    }
    const range = validateRange(cfg.range)
    const firstPos = formalPts[0].pos
    const lastPos = formalPts[formalPts.length - 1].pos
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
 * span 落笔颜色决策（docs/rendering/branch-line-gradient.md §8.5）。
 *
 * 渐变启用时优先于 span 级颜色覆盖，但**时间淡化**例外，回退纯色：
 * 时间淡化可能只覆盖部分 span，而渐变轴是两端点连线（直线），无法表达
 * 沿路径长度变化的灰显边界，烘进渐变会导致未开通区间仍按完整渐变彩显；
 * 回退 span 淡化色（字符串）后与非渐变线路行为一致。淡化来源是整线级的
 * **强调**淡化时继续用渐变——解析渐变时端点色已灰化，视觉等价。
 */
export function resolveSpanStrokeColor(opts: {
    gradient?: LineGradientResolution
    color?: string
    /** 无 span 颜色与渐变时的兜底（调用方传 getLineActualColor 结果） */
    fallbackColor: string
    downplayed: boolean
    /** 整线淡化来源；span 级时间淡化时可能为 undefined */
    downplayedBy?: 'accentuation' | 'time'
}): string | LineGradientResolution {
    const { gradient, color, fallbackColor, downplayed, downplayedBy } = opts
    if (gradient && !(downplayed && downplayedBy !== 'accentuation'))
        return gradient
    return color ?? fallbackColor
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
