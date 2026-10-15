import { Coord, FormalPt } from "aarc-core/models/coord";
import { defineStore } from "pinia";
import { useKvStoreCore } from "./common/kvStoreCore";
import { Line, LineStyle } from "aarc-core/models/save";
import { useLineSpanStore } from "./slice/lineSpanStore";
import { useLineStateStore } from "./state/lineStateStore";
import { useRenderOptionsStore } from "../renderOptionsStore";
import { extractSpanFormalPts } from "aarc-core/utils/lineUtils/extractSpanFormalPts";
import { useSaveStore } from "../saveStore";
import { useConfigStore } from "../configStore";
import { formalize } from "aarc-core/utils/lineUtils/formalize";
import { adaptLegacyGetTurnRadiusOf, buildLinePathGeometry } from "aarc-core/utils/lineUtils/buildLinePathGeometry";
import { sampleLinePath } from "aarc-core/utils/lineUtils/sampleLinePath";
import { PathPrimitive } from "aarc-core/utils/lineUtils/linePathPrimitives";
import { intervalMidpoints } from "aarc-core/utils/lineUtils/intervalMidpoints";
import { turn45Ratio } from "../configStore";
import { resolveLineGradient, LineGradientResolution } from "aarc-core/utils/lineUtils/lineGradient";

export interface FormalizedLine{
    lineId:number,
    pts:FormalPt[]
}

export interface SpanRenderInfo {
    line: Line
    formalPts: FormalPt[]
    color: string | undefined
    downplayed: boolean
    style: LineStyle | undefined
    styleId: number | undefined
    /** 支线渐变色解析结果（整线共享，各 span 视觉连续）；未启用或未解析出为 undefined */
    gradient: LineGradientResolution | undefined
    /** gradient 的内容键（分组渲染时区分不同渐变） */
    gradientKey: string
}

export const useFormalizedLineStore = defineStore('formalizedLine', ()=>{
    const { getItem, setItem, enumerateItems, clearItems } = useKvStoreCore<FormalPt[]>()

    /**
     * 路径几何缓存条目（见 docs/sampling/interval-midpoints.md）。
     * 几何与区间中点同条目缓存：中点由几何纯函数派生，几何在则中点零成本。
     */
    interface LinePathCacheEntry {
        formalPts: FormalPt[]
        radiusKey: string
        prims: PathPrimitive[]
        midpoints: Coord[]
    }
    /** 由存档数据派生的缓存，随 store 实例生灭；正确性由读取时的引用/快照校验保证，清缓存只是内存管理 */
    const pathCache = new Map<number, LinePathCacheEntry>()

    function clearAllItems(){
        clearItems()
        pathCache.clear()
    }

    /** formalizedLines“选中点拖动时”的局部值（activeCvs画布中算出的，正经值可能还没更新）该值仅对activePt有效 */
    let localFormalSegs:FormalizedLine[]|null = null
    
    /** 设置formalizedLines“正经值” */
    function setLinesFormalPts(lineId: number, formalPts:FormalPt[]|undefined){
        // 设置“正经值”时，清空局部值
        localFormalSegs = null
        setItem(lineId, formalPts)
    }

    // TODO: 无法处理自交点，考虑另外加一个以站点id为参数的
    function findAdjacentFormalPts(ptIdx:number, lineId:number){
        let pts:FormalPt[]|null = null
        // 先在“局部”里找
        if(localFormalSegs){
            const seg = localFormalSegs.find(x=>x.lineId==lineId)
            if(seg){
                pts = seg.pts
            }
        }
        // 再在KvStore里找
        if(!pts){
            const linePts = getItem(lineId)
            if(linePts)
                pts = linePts 
        }
        if(!pts || pts.length == 0)
            return []
        const idx = pts.findIndex(x=>x.afterIdxEqv==ptIdx)
        if(idx===-1)
            return []
        const res:Coord[] = []
        if(idx>0){
            res.push(pts[idx-1].pos)
        }
        if(idx<pts.length-1){
            res.push(pts[idx+1].pos)
        }
        return res
    }

    function setLocalFormalSegs(segs:FormalizedLine[]){
        localFormalSegs = segs
    }

    /**
     * 收集单条线路的所有 span 渲染信息
     * 
     * @param line 线路
     * @param filterNotOpened 是否过滤掉未开通的 span（用于导出时）
     * @param formalPtsOverride 直接使用给定的 formal 点而非读缓存
     * （active 画布等"只画不写缓存"的调用方使用，避免读到别处的旧缓存）
     */
    function collectSpanRenderInfos(line: Line, filterNotOpened?: boolean, formalPtsOverride?: FormalPt[]): SpanRenderInfo[] {
        const lineSpanStore = useLineSpanStore()
        const lineStateStore = useLineStateStore()
        const { effectiveTimeMoment } = useRenderOptionsStore()
        const flattened = lineSpanStore.getFlattenedLine(line.id)
        if (!flattened || flattened.spans.length === 0) return []

        const allFormalPts = formalPtsOverride ?? getItem(line.id) ?? []
        const infos: SpanRenderInfo[] = []
        const timeMoment = typeof effectiveTimeMoment === 'number' ? effectiveTimeMoment : undefined

        // 支线渐变色按整线解析一次，所有 span 共用（StyleSlice 截段时视觉连续，见决策 F）
        const gradient = resolveLineGradient(line, allFormalPts,
            useSaveStore().save?.lines, l => lineStateStore.getLineActualColor(l),
            (l, ptId, approach, selfLineId) => lineStateStore.getJunctionPtColor(l.id, ptId, approach, selfLineId))
        const gradientKey = gradient
            ? JSON.stringify([gradient.from, gradient.to, gradient.range, gradient.fromColor, gradient.toColor])
            : ''

        for (let spanIdx = 0; spanIdx < flattened.spans.length; spanIdx++) {
            const span = flattened.spans[spanIdx]
            const spanFormalPts = extractSpanFormalPts(allFormalPts, span)
            if (spanFormalPts.length < 2) continue

            // 导出模式下过滤未开通的 span
            if (filterNotOpened && typeof timeMoment === 'number') {
                if (!lineSpanStore.isSpanOpened(line.id, spanIdx, timeMoment)) {
                    continue
                }
            }

            const spanStyleInfo = lineSpanStore.getSpanStyle(line.id, spanIdx)
            const spanStyle = spanStyleInfo?.style
            const spanStyleId = spanStyleInfo?.styleSlice?.style ?? line.style
            const spanColor = lineStateStore.getSpanActualColor(line.id, spanIdx)
            const spanDownplayed = lineStateStore.isSpanDownplayed(line.id, spanIdx)

            infos.push({
                line,
                formalPts: spanFormalPts,
                color: spanColor,
                downplayed: spanDownplayed,
                style: spanStyle,
                styleId: spanStyleId,
                gradient,
                gradientKey
            })
        }
        return infos
    }

    /**
     * 取线路的 formal 点；视野外（渲染层已驱逐缓存）的线路即时 formalize，
     * 不回写 formal 点缓存，避免污染渲染节奏
     */
    function resolveFormalPts(line: Line): FormalPt[] {
        return getItem(line.id) ?? formalize(useSaveStore().getPtsByIds(line.pts))
    }

    /** 半径相关输入的快照，任一变化即令几何失效（不信任钩子、只认输入） */
    function radiusKeyOf(cs: ReturnType<typeof useConfigStore>, line: Line): string {
        return `${cs.config.lineTurnAreaRadius}|${cs.config.lineWidth}|${turn45Ratio}|${line.width}|${line.type}`
    }

    function ensureLinePathEntry(line: Line): LinePathCacheEntry {
        const cs = useConfigStore()
        const radiusKey = radiusKeyOf(cs, line)
        const livePts = getItem(line.id)
        const cached = pathCache.get(line.id)
        // formal 点缓存被驱逐时 livePts 为 undefined，引用比对必失败 → 即时 formalize 重建，校验自然通过
        if (cached && cached.radiusKey === radiusKey && cached.formalPts === livePts)
            return cached
        const formalPts = resolveFormalPts(line)
        const prims = buildLinePathGeometry(formalPts, line,
            adaptLegacyGetTurnRadiusOf(cs.getTurnRadiusOf))
        const entry: LinePathCacheEntry = { formalPts, radiusKey, prims, midpoints: intervalMidpoints(prims) }
        pathCache.set(line.id, entry)
        return entry
    }

    /** 线路的路径几何（带缓存）。几何 = formal 点 + 半径来源，二者任一变化自动重建 */
    function getLinePathGeometry(line: Line): PathPrimitive[] {
        return ensureLinePathEntry(line).prims
    }

    /**
     * 线路所有控制点区间的中点（带缓存，派生自 getLinePathGeometry）。
     * 返回外层数组的浅拷贝：坐标数组均为新建，调用方对返回数组的增删改
     * 不会影响缓存与其他消费者。
     */
    function getLineIntervalMidpoints(line: Line): Coord[] {
        return [...ensureLinePathEntry(line).midpoints]
    }

    /**
     * 面向业务的线路“采样”入口：以固定间隔沿线路实际绘制轨迹生成一系列点，
     * 采样点与屏幕所见的线贴合（含圆角，复刻 linkPts 的几何）。
     *
     * 默认始终按非简化几何采样（与缩放级别无关）；如需与屏幕所见严格一致，
     * 可自行传入 simplify（对应 lineShouldSimplify() 的结果）。
     * 非简化几何走 getLinePathGeometry 缓存，与区间中点等消费者共享同一份几何；
     * simplify 是临时视图态，不缓存、现构。
     */
    function sampleLineCoords(line: Line, interval: number, options?: {
        includeEnds?: boolean
        simplify?: boolean
    }): Coord[] {
        const prims = options?.simplify
            ? buildLinePathGeometry(resolveFormalPts(line), line,
                adaptLegacyGetTurnRadiusOf(useConfigStore().getTurnRadiusOf), { simplify: true })
            : ensureLinePathEntry(line).prims
        return sampleLinePath(prims, interval, options?.includeEnds ?? true)
    }

    return { 
        setLinesFormalPts,
        getLinesFormalPts: getItem,
        enumerateFormalizedLines: enumerateItems,
        findAdjacentFormalPts,
        clearItems: clearAllItems,
        setLocalFormalSegs,
        collectSpanRenderInfos,
        sampleLineCoords,
        getLinePathGeometry,
        getLineIntervalMidpoints
    }
})