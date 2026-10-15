import { defineStore, storeToRefs } from "pinia";
import { computed } from "vue";
import { useSaveStore } from "../../saveStore";
import { useConfigStore } from "../../configStore";
import { Line, LineTimeInfo } from "aarc-core/models/save";
import { Coord } from "aarc-core/models/coord";
import { useRenderOptionsStore } from "../../renderOptionsStore";
import { useColorProcStore } from "../../utils/colorProcStore";
import { useLineSpanStore } from "../slice/lineSpanStore";

export const useLineStateStore = defineStore('lineState', () => {
    const saveStore = useSaveStore()
    const { save } = storeToRefs(saveStore)
    const { 
        accentuationLineIds, accentuationEnabled, accentuationConfig,
        effectiveTimeMoment, timeConfig,
        exporting 
    } = storeToRefs(useRenderOptionsStore())
    const configStore = useConfigStore()
    const colorProc = useColorProcStore()
    const lineSpanStore = useLineSpanStore()

    const lineActualColors = computed<Map<number, {color:string, downplayed?:boolean, downplayedBy?: 'accentuation' | 'time'}>>(() => {
        const res: Map<number, {
            color: string
            time?: LineTimeInfo,
            downplayed?: boolean
            downplayedBy?: 'accentuation' | 'time'
        }> = new Map()
        if (!save.value?.lines)
            return res

        // 初步算出线路的“实际颜色”
        for (const line of save.value.lines) {
            let actualColor = line.color
            if (line.colorPre) {
                actualColor = configStore.getPresetColor(line.colorPre)
            }
            res.set(line.id, {color: actualColor, time: {...line.time}})
        }
        
        // 根据“强调”设置，对该黑白化的线路进行黑白化
        const runDownplayByAcc = 
            accentuationEnabled.value 
            && accentuationLineIds.value.length>0 
            && (exporting.value || accentuationConfig.value.enabledPreview)
        if(runDownplayByAcc){
            const acc = accentuationConfig.value
            const accIds = accentuationLineIds.value
            let accentuatedColors = acc.spread ? new Set<string>() : undefined
            let accentuatedLineIds = new Set<number>()
            for (const [lineId, { color }] of res.entries()) {
                if (accIds.includes(lineId) && color) {
                    accentuatedColors?.add(color)
                    accentuatedLineIds.add(lineId)
                }
            }
            for (const [lineId, {color}] of res.entries()){
                if(!color) continue
                const line = saveStore.getLineById(lineId)
                const isTerrain = line?.type
                const inAccIds = accIds.includes(lineId)
                const accBySpread = accentuatedColors?.has(color)
                const accByTerrain = acc.terrain && isTerrain
                const accByParent = line?.parent && accentuatedLineIds?.has(line?.parent)
                const downplay = !inAccIds && !accBySpread && !accByTerrain && !accByParent
                if(downplay){
                    const newColor = colorProc.colorProcDownplay.convert(color)
                    res.set(lineId, {color:newColor, downplayed:true, downplayedBy: 'accentuation'})
                }
            }
        }
        
        // 根据“时间”设置，对该黑白化的线路进行黑白化
        const runDownplayByTime = 
            typeof effectiveTimeMoment.value == 'number'
            && (exporting.value || timeConfig.value.enabledPreview)
        if(runDownplayByTime){
            const t = effectiveTimeMoment.value ?? 999999
            const notOpenLineIds = new Set<number>()
            for (const [lineId, { time, downplayed }] of res.entries()) {
                if(downplayed)
                    continue
                if (typeof time?.open == 'number' && t < time.open){
                    notOpenLineIds.add(lineId)
                }
            }
            for (const [lineId, {color, downplayed}] of res.entries()){
                if(downplayed) continue
                const line = saveStore.getLineById(lineId)
                const inNotOpenIds = notOpenLineIds.has(lineId)
                const notOpenByParent = line?.parent && notOpenLineIds.has(line.parent)
                const downplay = inNotOpenIds || notOpenByParent
                if(downplay){
                    const newColor = colorProc.colorProcDownplay.convert(color)
                    res.set(lineId, {color:newColor, downplayed:true, downplayedBy: 'time'})
                }
            }
        }


        return res
    })
    function getLineActualColor(line:Line) {
        return lineActualColors.value.get(line.id)?.color || line.color
    }
    function getLineActualColorById(lineId:number){
        return lineActualColors.value.get(lineId)?.color
    }
    function isLineDownplayed(lineId:number){
        return lineActualColors.value.get(lineId)?.downplayed
    }

    /**
     * 获取标签应该使用的线路实际颜色
     * 
     * 逻辑：
     * 1. 先取整线基础色（处理 colorPre）
     * 2. 如果线路因“强调”被淡化，直接使用 lineActualColors 中的淡化色
     * 3. 如果所有 FlatSpan 都因时间未开通而淡化，则对基础色应用淡化
     * 4. 否则返回原色
     */
    function getLineTagActualColor(line: Line): string {
        let baseColor = line.color
        if (line.colorPre) {
            baseColor = configStore.getPresetColor(line.colorPre)
        }
        const lineState = lineActualColors.value.get(line.id)
        if (lineState?.downplayedBy === 'accentuation') {
            return lineState.color || baseColor
        }
        if (isLineTagDownplayed(line.id)) {
            return colorProc.colorProcDownplay.convert(baseColor)
        }
        return baseColor
    }

    /**
     * 判断标签是否应该被淡化
     * 
     * 逻辑：
     * 1. 如果线路因“强调”被淡化，标签也淡化
     * 2. 否则只在时间模式下，且该线路（若是主线，还包括所有 parent 指向它的支线）
     *    的每一个 FlatSpan 都未开通时才淡化
     * 3. 不再直接依据线路级 Line.time 做判断
     */
    function isLineTagDownplayed(lineId: number): boolean {
        if (lineActualColors.value.get(lineId)?.downplayedBy === 'accentuation') return true
        if (!shouldRunDownplayByTime()) return false

        const line = saveStore.getLineById(lineId)
        if (!line) return false

        // 如果是主线（无 parent），需要同时检查自身和所有支线
        const lineIdsToCheck: number[] = [lineId]
        if (!line.parent) {
            for (const l of save.value?.lines || []) {
                if (l.parent === lineId) {
                    lineIdsToCheck.push(l.id)
                }
            }
        }

        let hasAnySpan = false
        for (const id of lineIdsToCheck) {
            const flattened = lineSpanStore.getFlattenedLine(id)
            const spans = flattened?.spans
            if (!spans || spans.length === 0) continue
            hasAnySpan = true
            for (let i = 0; i < spans.length; i++) {
                const spanTimeInfo = lineSpanStore.getSpanTime(id, i)
                if (!isTimeDownplayed(spanTimeInfo?.time)) return false
            }
        }
        return hasAnySpan
    }

    /**
     * 获取指定线路指定 span 的实际颜色
     * 
     * 逻辑：
     * 1. 先取整线基础色（与 lineActualColors 一致）
     * 2. 如果该 span 有独立的时间状态（TimeSlice 或 Line.time），按时间判断是否淡化
     * 3. 如果整线已被淡化（lineActualColors 中 downplayed），span 也淡化
     * 4. 强调淡化保持整线级别（不细分到 span）
     */
    /**
     * 判断是否应该运行时间淡化逻辑
     */
    function shouldRunDownplayByTime(): boolean {
        return typeof effectiveTimeMoment.value == 'number'
            && (exporting.value || timeConfig.value.enabledPreview === true)
    }

    /**
     * 判断给定时间信息是否应该被淡化
     */
    function isTimeDownplayed(time?: LineTimeInfo): boolean {
        if (!shouldRunDownplayByTime() || !time) return false
        const t = effectiveTimeMoment.value ?? 999999
        return typeof time.open == 'number' && t < time.open
    }

    function getSpanActualColor(lineId: number, spanIdx: number): string | undefined {
        const line = saveStore.getLineById(lineId)
        if (!line) return undefined

        // 计算基础色（处理 colorPre，但不考虑时间淡化）
        let baseColor = line.color
        if (line.colorPre) {
            baseColor = configStore.getPresetColor(line.colorPre)
        }

        // 如果整线已被强调淡化，span 直接继承淡化色
        if (lineActualColors.value.get(lineId)?.downplayedBy === 'accentuation') {
            return lineActualColors.value.get(lineId)?.color || baseColor
        }

        // 检查 span 的时间状态
        const spanTimeInfo = lineSpanStore.getSpanTime(lineId, spanIdx)
        if (isTimeDownplayed(spanTimeInfo?.time)) {
            return colorProc.colorProcDownplay.convert(baseColor)
        }

        return baseColor
    }

    /**
     * 方向判定阈值：approach 与某一侧的方向夹角 ≤60°（dot ≥ 0.5）才信任方向，
     * 否则视为垂直/无法判定，走非淡化优先兜底（docs/rendering/branch-line-gradient.md §8.6）
     */
    const JUNCTION_APPROACH_MIN_DOT = 0.5

    function normalizeCoord(c: Coord): Coord | undefined {
        const len = Math.hypot(c[0], c[1])
        return len > 1e-9 ? [c[0] / len, c[1] / len] : undefined
    }

    /**
     * 交界 span 选侧：approach（支线"朝向"的方向，语义见 resolveLineGradient 的
     * approachAt）与"接点指向各相邻 span 另一侧"的方向做点积，取得分最高的一侧——
     * 支线几何上朝向哪一侧就取哪一侧的颜色。方向缺失或与两侧夹角都超过 60°
     * （含垂直）时，兜底非淡化优先（与车站圆圈 getStaColorFromSpan 同一策略）。
     */
    function pickJunctionSpan(
        line: Line,
        ptId: number,
        ptIdx: number,
        adjacent: number[],
        approach: Coord | undefined,
        spans: { fromIdx: number, toIdx: number, fromPt: number, toPt: number }[]
    ): number {
        if (approach) {
            const junctionPos = saveStore.getPtById(ptId)?.pos
            if (junctionPos) {
                let bestSpan = -1
                let bestScore = -Infinity
                for (const spanIdx of adjacent) {
                    const span = spans[spanIdx]
                    const otherPtId = ptIdx === span.fromIdx ? span.toPt : span.fromPt
                    const otherPos = saveStore.getPtById(otherPtId)?.pos
                    if (!otherPos) continue
                    const ray = normalizeCoord([otherPos[0] - junctionPos[0], otherPos[1] - junctionPos[1]])
                    if (!ray) continue
                    const score = ray[0] * approach[0] + ray[1] * approach[1]
                    if (score > bestScore) {
                        bestScore = score
                        bestSpan = spanIdx
                    }
                }
                if (bestSpan >= 0 && bestScore >= JUNCTION_APPROACH_MIN_DOT)
                    return bestSpan
            }
        }
        // 垂直/无方向信息：优先未淡化 span，全淡化取第一个（即淡化色）
        const notDownplayed = adjacent.find(i => !isSpanDownplayed(line.id, i))
        return notDownplayed ?? adjacent[0]
    }

    /**
     * 收集接点在某线路上的相邻 span 索引：span 内部 → 唯一；span 边界（交界点）→
     * 前后两个；线路端点 → 只有一个。点不在线路上或无 span 信息时返回 undefined。
     */
    function adjacentSpansOf(lineId: number, ptId: number): { adjacent: number[], ptIdx: number, line: Line } | undefined {
        const line = saveStore.getLineById(lineId)
        if (!line) return undefined
        const ptIdx = line.pts.indexOf(ptId)
        if (ptIdx < 0) return undefined
        const flattened = lineSpanStore.getFlattenedLine(lineId)
        if (!flattened || flattened.spans.length === 0) return undefined

        const adjacent: number[] = []
        flattened.spans.forEach((span, spanIdx) => {
            if (ptIdx > span.fromIdx && ptIdx < span.toIdx)
                adjacent.push(spanIdx)                 // span 内部：唯一相邻
            else if (ptIdx === span.fromIdx || ptIdx === span.toIdx)
                adjacent.push(spanIdx)                 // span 边界：前后均相邻（交界点）
        })
        if (adjacent.length === 0) return undefined
        return { adjacent, ptIdx, line }
    }

    /**
     * 交界 span 选侧（approach 语义与兜底见 pickJunctionSpan）；单个相邻 span 直接返回。
     */
    function resolveJunctionSpanIdx(lineId: number, ptId: number, approach?: Coord): number | undefined {
        const info = adjacentSpansOf(lineId, ptId)
        if (!info) return undefined
        if (info.adjacent.length === 1) return info.adjacent[0]
        const flattened = lineSpanStore.getFlattenedLine(lineId)!
        return pickJunctionSpan(info.line, ptId, info.ptIdx, info.adjacent, approach, flattened.spans)
    }

    /**
     * 取某线路某 span 的渐变端点用色：导出模式下 span 未开通（被过滤、不渲染）
     * → 背景色（渐变末端"溶入背景"）；否则取 span 实际颜色。
     */
    function spanEndpointColor(lineId: number, spanIdx: number): string | undefined {
        const t = effectiveTimeMoment.value
        if (exporting.value && typeof t === 'number' && !lineSpanStore.isSpanOpened(lineId, spanIdx, t))
            return configStore.config.bgColor
        return getSpanActualColor(lineId, spanIdx)
    }

    /**
     * 接点局部取色（方向感知，docs/rendering/branch-line-gradient.md §8.6）。
     *
     * 用于渐变端点取色：渐变轴端落在某个点上时，该点处的颜色由相邻 span 的局部
     * 状态决定，而非整线统一颜色：
     * - 非交界点（线路端点或 span 内部）只有一个相邻 span，直接取其颜色；
     * - 交界点（前后两个 span 均相邻）按 approach 方向选侧，垂直/无方向时非淡化
     *   优先兜底；
     * - 导出模式下选中 span 未开通（被 filterNotOpened 过滤、不渲染）→ 返回背景色，
     *   渐变末端"溶入背景"；预览模式淡化 span 仍渲染，取淡化色；
     * - 点不在线路上或无 span 信息时返回 undefined，调用方回退整线颜色。
     *
     * @param approach 支线驶向接点的方向（本体 → 接点，由 resolveLineGradient 从支线
     * formalPts 计算，两端统一）；undefined 表示无方向信息，直接走非淡化优先兜底
     * @param selfLineId 主色端调用时传入的支线自身 id：支线自身端 span 被淡化时
     * 优先跟随自身（该 span 落笔已按 §8.5 回退纯色，渐变起点与之衔接），不淡化
     * 才取传入线路（parent）的接点局部颜色
     */
    function getJunctionPtColor(lineId: number, ptId: number, approach?: Coord, selfLineId?: number): string | undefined {
        if (selfLineId != null) {
            const selfSpanIdx = resolveJunctionSpanIdx(selfLineId, ptId, undefined)
            if (selfSpanIdx != null && isSpanDownplayed(selfLineId, selfSpanIdx))
                return spanEndpointColor(selfLineId, selfSpanIdx)
        }
        const spanIdx = resolveJunctionSpanIdx(lineId, ptId, approach)
        if (spanIdx == null) return undefined
        return spanEndpointColor(lineId, spanIdx)
    }

    /**
     * 获取指定线路指定 span 是否被淡化
     */
    function isSpanDownplayed(lineId: number, spanIdx: number): boolean {
        if (lineActualColors.value.get(lineId)?.downplayedBy === 'accentuation') return true

        const spanTimeInfo = lineSpanStore.getSpanTime(lineId, spanIdx)
        return isTimeDownplayed(spanTimeInfo?.time)
    }

    return {
        lineActualColors,
        getLineActualColor,
        getLineActualColorById,
        isLineDownplayed,
        getLineTagActualColor,
        isLineTagDownplayed,
        getSpanActualColor,
        getJunctionPtColor,
        isSpanDownplayed
    }
})