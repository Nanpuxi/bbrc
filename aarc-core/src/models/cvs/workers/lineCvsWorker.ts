/**
 * SVG 导出兼容说明：
 * 
 * 本文件内有多个 `buildPath` 变量，仅在 svgcanvas（SVG 导出）模式下创建和使用。
 * 
 * 背景：svgcanvas 的 stroke() 不会创建新的 <path> 元素，而是修改当前元素的样式。
 * 当线路有多层样式（multi-layer line style）时，strokeStyledLine 会对同一条路径
 * 调用多次 stroke()，导致后一层覆盖前一层的样式，最终 SVG 只显示最后一层。
 * 
 * 解决方案：在 strokeStyledLine 中，每次 stroke() 前调用 pathBuilder 回调，
 * 重新 beginPath() 并重建路径，确保每层样式都有自己的独立 <path> 元素。
 * 
 * 性能考虑：buildPath 仅在检测到 svgcanvas 上下文时才创建；正常 Canvas 渲染时
 * 为 undefined，完全保持原有行为，不增加任何开销。
 * 
 * 涉及位置：
 * - 简化模式（ignoreStyleAndSpan）
 * - Carpet 渲染
 * - renderAllSpansBase（逐 span）
 * - renderAllSpansStyle（按组聚合）
 * - 旧版 doRender（选中点局部）
 */

import { useSaveStore } from "../../stores/saveStore";
import { ControlPoint, Line, LineType } from "../../save";
import { FormalPt } from "../../coord";
import { useEnvStore } from "aarc-core/models/stores/envStore";
import { useConfigStore } from "aarc-core/models/stores/configStore";
import { FormalizedLine, SpanRenderInfo, useFormalizedLineStore } from "aarc-core/models/stores/saveDerived/formalizedLineStore";
import { WayRel } from "aarc-core/utils/rayUtils/rayParallel";
import { defineStore } from "pinia";
import { ptInLineIndices } from "aarc-core/utils/lineUtils/ptInLineIndices";
import { getByIndexInRing, isRing } from "aarc-core/utils/lineUtils/isRing";
import { adaptLegacyGetTurnRadiusOf, buildLinePathGeometry } from "aarc-core/utils/lineUtils/buildLinePathGeometry";
import { CvsContext } from "../common/cvsContext";
import { useCvsBlocksControlStore } from "../common/cvs";
import { LineStrokeTarget, strokeStyledLine } from "../common/strokeStyledLine";
import { useLineStateStore } from "aarc-core/models/stores/saveDerived/state/lineStateStore";
import { useColorProcStore } from "aarc-core/models/stores/utils/colorProcStore";
import { LineStyle } from "aarc-core/models/save";
import { useEditorLocalConfigStore } from "aarc-core/app/localConfig/editorLocalConfig";
import { useCvsFrameStore } from "aarc-core/models/stores/cvsFrameStore";
import { useRenderOptionsStore } from "aarc-core/models/stores/renderOptionsStore";
import { formalize } from "aarc-core/utils/lineUtils/formalize";
import { buildLineGradient, resolveLineGradient, LineGradientResolution } from "aarc-core/utils/lineUtils/lineGradient";

type LineRenderType = 'both'|'body'|'carpet'

export type GetTurnRadiusOf = (lineInfo: Line, rel: WayRel | number) => number

/**
 * 将一组 formalized 线路点连接成 canvas 路径。
 *
 * 几何构造委托给 buildLinePathGeometry（与采样功能同源）：
 * - 相邻两段直线的转角处，用圆角（arc）代替尖角；
 * - 直线部分只画到“切点”（sok），圆角部分用切点-顶点-切点三点画弧；
 * - 环线从头部切点开始，末尾画回该切点平滑闭合。
 *
 * 本函数只负责“走一遍图元序列”：moveTo 到首图元起点后逐个 appendTo，
 * 不识别图元种类；新转角/新几何在 buildLinePathGeometry 的注册表处扩展。
 */
export function linkPts(
    ctx:CvsContext,
    formalPts:FormalPt[],
    lineInfo:Line,
    getTurnRadiusOf:GetTurnRadiusOf,
    simplify?: boolean
){
    // 点数不足时无法形成线段，直接返回
    if(formalPts.length<=1){
        return;
    }
    const prims = buildLinePathGeometry(formalPts, lineInfo,
        adaptLegacyGetTurnRadiusOf(getTurnRadiusOf), { simplify })
    if(prims.length === 0)
        return
    ctx.moveTo(...prims[0].start())
    for(const p of prims){
        p.appendTo(ctx)
    }
}

export const useLineCvsWorker = defineStore('lineCvsWorker', ()=>{
    const saveStore = useSaveStore();
    const lineStateStore = useLineStateStore()

    const envStore = useEnvStore();
    const formalizedLineStore = useFormalizedLineStore()
    const cs = useConfigStore();
    const colorProc = useColorProcStore()
    const cvsFrameStore = useCvsFrameStore()
    const editorLocalConfigStore = useEditorLocalConfigStore()
    const renderOptionsStore = useRenderOptionsStore()
    const cvsBlocksControlStore = useCvsBlocksControlStore()

    const lineFobThrsBase = 0.000001

    function lineShouldSimplify(): boolean {
        if (renderOptionsStore.exporting) return false
        const viewRect = cvsFrameStore.getViewRectSideLengths()
        const viewRectArea = viewRect[0] * viewRect[1]
        if (!viewRectArea) return false
        const ratio = cs.config.lineTurnAreaRadius / viewRectArea
        const thrs = lineFobThrsBase * (Number(editorLocalConfigStore.lineFob) || 1)
        return ratio < thrs
    }
    function getLineOmitPadding(line:Line[]){
        const maxLineWidth = Math.max(...line.map(l => (l.width || 1) * cs.config.lineWidth))
        return cs.config.lineTurnAreaRadius + maxLineWidth + cs.config.lineCarpetWiden
    }
    function checkOmittableLine(minX:number, maxX:number, minY:number, maxY:number, line:Line[]){
        const { cvsWidth, cvsHeight } = saveStore
        const { left, right, top, bottom } = cvsBlocksControlStore.blockTotalBoundary
        const padding = getLineOmitPadding(line)
        if((maxX + padding)/cvsWidth < left)
            return true
        if((minX - padding)/cvsWidth > right)
            return true
        if((maxY + padding)/cvsHeight < top)
            return true
        if((minY - padding)/cvsHeight > bottom)
            return true
        return false
    }
    function renderAllLines(ctx:CvsContext, ltype?:LineType, rtype?:LineRenderType){
        if(!saveStore.save){
            return
        }
        ctx.lineJoin = 'round'
        const lines = saveStore.linesSortedByZIndex;
        for(const line of lines){
            if(line.parent) //TODO:确保parent要么falsy，要么指向一个存在的线路，不能有dangling情况
                continue
            if(ltype !== undefined){
                if(ltype != line.type)
                    continue
            }
            let toRender = [line]
            const children = saveStore.getLinesByParent(line.id)
            if(children)
                toRender.push(...children)
            renderLine(ctx, toRender, rtype)
        }
    }
    /**
     * 渲染某个线路（可选择“及其支线”）
     * @param ctx 
     * @param line 线路（单个或数组，如果是数组，应为x线路及其支线（x和parent设为x.id的线路））
     * @param rtype 渲染类型（地毯/本体）
     * @param writeCache 是否把 formalPts 写入/驱逐共享缓存（formalizedLineStore）。
     * 共享缓存只应由主画布整帧渲染维护（点击检测以它为准，须与主画布像素一致）；
     * active 画布的局部渲染传 false——只画不写，否则在主画布渲染被抑制（如协作远程调度）
     * 期间会把新几何写进缓存，造成"看不见的位置能点中"
     * @returns 
     */
    function renderLine(ctx:CvsContext, line:Line|Line[], rtype?:LineRenderType, writeCache:boolean = true){
        if(!(line instanceof Array)){
            line = [line]
        }
        if(line.length===0)
            return
        
        // 先用原始控制点算包围盒，在 formalize 之前做省略判定，
        // 避免视野外线路每帧都 formalize 的固定开销
        // （formal中间点可能略微超出控制点包围盒，由 checkOmittableLine 的 padding 兜底）
        const ptsOfLines:ControlPoint[][] = []
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for(const l of line){
            const pts = saveStore.getPtsByIds(l.pts)
            if(pts.length<=1){
                // 点数不足（含控制点id悬空）无法渲染：与下方省略路径对称，
                // 驱逐整个family的formalPts缓存，避免残留旧缓存导致"未渲染但可点中"的幽灵线
                if(writeCache){
                    for(const l2 of line)
                        formalizedLineStore.setLinesFormalPts(l2.id, undefined)
                }
                return;
            }
            ptsOfLines.push(pts)
            for(const p of pts){
                const [x, y] = p.pos
                if(x < minX) minX = x
                if(x > maxX) maxX = x
                if(y < minY) minY = y
                if(y > maxY) maxY = y
            }
        }

        // 填充地形或导出时不能省略，避免内容缺失
        const isFilledTerrain = line.some(l => l.isFilled && l.type === LineType.terrain)
        if(!isFilledTerrain && !renderOptionsStore.exporting && checkOmittableLine(minX, maxX, minY, maxY, line)){
            // 省略时清掉formalPts缓存：点击判定不会命中过期数据，缩略图渲染会按需重新formalize
            if(writeCache){
                for(const l of line)
                    formalizedLineStore.setLinesFormalPts(l.id, undefined)
            }
            return
        }

        // formalize 结果先放本地供绘制使用；写缓存是独立动作（见 writeCache 说明）
        const formalPtsOfLines:FormalPt[][] = []
        for(let i=0;i<line.length;i++){
            const formalPts = formalize(ptsOfLines[i])
            formalPtsOfLines.push(formalPts)
            if(writeCache)
                formalizedLineStore.setLinesFormalPts(line[i].id, formalPts)
        }

        const includeCarpet = !rtype || rtype == 'carpet' || rtype == 'both'

        // 简化模式：无视样式和分段，整线统一绘制
        if(editorLocalConfigStore.ignoreStyleAndSpan || lineShouldSimplify()){
            for(let i=0;i<line.length;i++){
                const l = line[i]
                const formalPts = formalPtsOfLines[i]
                const gradient = resolveLineGradient(l, formalPts,
                    saveStore.save?.lines, x => lineStateStore.getLineActualColor(x))
                const buildPath = () => {
                    ctx.beginPath()
                    linkPts(ctx, formalPts, l, cs.getTurnRadiusOf, lineShouldSimplify())
                }
                buildPath()
                doRender(ctx, l, undefined, undefined, 'both', 'base', gradient, buildPath)
            }
            return
        }

        // 1. Carpet 保持整线绘制
        if(includeCarpet){
            for(let i=0;i<line.length;i++){
                const l = line[i]
                const formalPts = formalPtsOfLines[i]
                const buildPath = () => {
                    ctx.beginPath()
                    linkPts(ctx, formalPts, l, cs.getTurnRadiusOf, lineShouldSimplify())
                }
                buildPath()
                doRender(ctx, l, undefined, undefined, 'carpet', undefined, undefined, buildPath)
            }
        }

        // 2. Body 按 span 拆分渲染
        // 收集所有 line（含 children）的所有 spans，然后统一先画 base 再画 style
        // 这样可以避免不同 line 之间的 base/style 覆盖问题（如支线分叉处）
        const includeBody = !rtype || rtype == 'body' || rtype == 'both'
        if(includeBody){
            const allSpanInfos: SpanRenderInfo[] = []
            for(let i=0;i<line.length;i++){
                allSpanInfos.push(...formalizedLineStore.collectSpanRenderInfos(line[i], undefined, formalPtsOfLines[i]))
            }
            renderAllSpansBase(ctx, allSpanInfos)
            renderAllSpansStyle(ctx, allSpanInfos)
        }
    }
    function renderSegsAroundActivePt(ctx:CvsContext)
        :{relatedPts:Iterable<ControlPoint>, formalizedSegs:FormalizedLine[]}
    {
        const activeId = envStore.activePt?.id;
        if(!activeId)
            return{relatedPts:[],formalizedSegs:[]};
        const searchRes:{formalizePtIds:number[], trimLeft:boolean, trimRight:boolean, line:Line}[] = []
        saveStore.save?.lines.forEach(line=>{
            const indices = ptInLineIndices(activeId, line)
            if(indices.length==0)
                return;
            indices.forEach(idx=>{
                const maxIdx = line.pts.length-1
                const formalizePtIds:number[] = []
                let trimLeft = false; let trimRight = false;
                if(isRing(line)){
                    const pm3 = getByIndexInRing(line, idx-3)
                    if(pm3){formalizePtIds.push(pm3);trimLeft = true}
                    const pm2 = getByIndexInRing(line, idx-2)
                    if(pm2){formalizePtIds.push(pm2)}
                    const pm1 = getByIndexInRing(line, idx-1)
                    if(pm1){formalizePtIds.push(pm1)}
                    formalizePtIds.push(line.pts[idx]);
                    const pa1 = getByIndexInRing(line, idx+1)
                    if(pa1){formalizePtIds.push(pa1)}
                    const pa2 = getByIndexInRing(line, idx+2)
                    if(pa2){formalizePtIds.push(pa2)}
                    const pa3 = getByIndexInRing(line, idx+3)
                    if(pa3){formalizePtIds.push(pa3);trimRight = true}
                }else{
                    if(idx-3>=0){formalizePtIds.push(line.pts[idx-3]); trimLeft = true}
                    if(idx-2>=0){formalizePtIds.push(line.pts[idx-2])}
                    if(idx-1>=0){formalizePtIds.push(line.pts[idx-1])}
                    formalizePtIds.push(line.pts[idx]);
                    if(idx+1<=maxIdx){formalizePtIds.push(line.pts[idx+1])}
                    if(idx+2<=maxIdx){formalizePtIds.push(line.pts[idx+2])}
                    if(idx+3<=maxIdx){formalizePtIds.push(line.pts[idx+3]); trimRight = true}
                }
                searchRes.push({formalizePtIds, trimLeft, trimRight, line})
            })
        })
        const relatedPts:Set<ControlPoint> = new Set()
        const formalizedSegs:FormalizedLine[] = []
        searchRes.forEach(res=>{
            // 得到区间首个点（肯定是靠近线路起点的）在线路中的索引，使formalize算出正确的afterIdxEqv
            const firstPt = res.formalizePtIds.at(0)
            if(firstPt === undefined) return 
            const line = res.line
            const firstPtInLineIdx = line.pts.indexOf(firstPt)
            if(firstPtInLineIdx == -1) return
            const fpts = saveStore.getPtsByIds(res.formalizePtIds)
            const formalized = formalize(fpts, firstPtInLineIdx)
            if(res.trimLeft && formalized.length>0){
                let leftIdx = formalized[0].afterIdxEqv
                const trimCount = formalized.findIndex(x=>x.afterIdxEqv!==leftIdx)
                formalized.splice(0, trimCount)
                fpts.shift()
            }
            if(res.trimRight && formalized.length>1){
                let rightIdx = formalized[formalized.length-2].afterIdxEqv
                const trimFrom = formalized.findIndex(x=>x.afterIdxEqv===rightIdx)
                formalized.splice(trimFrom+1)
                fpts.pop()
            }
            fpts.forEach(pt=>relatedPts.add(pt))
            formalizedSegs.push({lineId:line.id, pts:formalized})
            const buildPath = () => {
                ctx.beginPath()
                linkPts(ctx, formalized, line, cs.getTurnRadiusOf, lineShouldSimplify())
            }
            buildPath()
            const enforceLineWidth = line.isFilled ? 1 : undefined
            // 局部线段仍使用整线解析的渐变（CanvasGradient 为设备坐标系对象，对局部 path 同样适用）
            const wholeFormalPts = formalizedLineStore.getLinesFormalPts(line.id)
            const gradient = resolveLineGradient(line, wholeFormalPts,
                saveStore.save?.lines, x => lineStateStore.getLineActualColor(x))
            doRender(ctx, line, true, enforceLineWidth, undefined, undefined, gradient, buildPath)
        })
        formalizedLineStore.setLocalFormalSegs(formalizedSegs)
        return {
            relatedPts,
            formalizedSegs
        }
    }
    interface SpanRenderOptions {
        color?: string
        downplayed?: boolean
        style?: LineStyle
        styleId?: number
        strokeTarget?: LineStrokeTarget
        gradient?: LineGradientResolution
    }

    /**
     * 新版渲染函数（渲染单个 span，carpet 部分除外）
     */
    function doRenderSpan(
        ctx: CvsContext,
        lineInfo: Line,
        options: SpanRenderOptions & { pathBuilder?: () => void }
    ) {
        const { color, downplayed, style, styleId, strokeTarget, gradient, pathBuilder } = options
        // 支线渐变色按整线解析（各 span 共用），启用时优先于 span 级颜色覆盖
        const lineColor = gradient ?? color ?? lineStateStore.getLineActualColor(lineInfo)

        // 填充线路（如湖泊）；支线渐变不适用填充，回退主色
        if (lineInfo.isFilled && lineInfo.type === LineType.terrain) {
            ctx.fillStyle = typeof lineColor === 'string' ? lineColor : lineColor.fromColor
            ctx.fill()
            return
        }

        // 普通 stroke 线路
        const lineWidth = cs.config.lineWidth * (lineInfo.width || 1)
        ctx.lineJoin = 'round'

        const lineDownplayed = downplayed ?? lineStateStore.isLineDownplayed(lineInfo.id)
        const effectiveStyleId = styleId ?? lineInfo.style
        const itsStyle = style ?? saveStore.save?.lineStyles?.find(x => x.id === effectiveStyleId)

            const scale = ctx.getCurrentScale()
            const offset = ctx.getCurrentOffset()

            strokeStyledLine(ctx, {
                target: strokeTarget ?? 'both',
                scale,
                offset,
                lineStyle: itsStyle,
                lineWidthBase: lineWidth,
                baseCap: lineCapWithDefault(lineInfo),
                dynaColor: lineColor,
                bgColor: cs.config.bgColor,
                fixedColorConverter: (c) => {
                    if (lineDownplayed)
                        return colorProc.colorProcDownplay.convert(c)
                    return c
                },
                pathBuilder
            })
    }



    /**
     * 统一绘制所有 span 的 base（新版渲染函数的包装器）
     */
    function renderAllSpansBase(ctx: CvsContext, infos: SpanRenderInfo[]) {
        for (const info of infos) {
            const buildPath = () => {
                ctx.beginPath()
                linkPts(ctx, info.formalPts, info.line, cs.getTurnRadiusOf, lineShouldSimplify())
            }
            buildPath()
            doRenderSpan(ctx, info.line, {
                color: info.color,
                downplayed: info.downplayed,
                style: info.style,
                styleId: info.styleId,
                strokeTarget: 'base',
                gradient: info.gradient,
                pathBuilder: buildPath
            })
        }
    }

    /**
     * 统一绘制所有 span 的 style（新版渲染函数的包装器）
     * 
     * 将样式相同的 span 聚集后批量渲染，减少 canvas 状态切换次数。
     * 
     * 分组依据：(styleId, line.width, color, downplayed, gradientKey)
     * 这五个参数决定了 strokeStyledLine 在 target='style' 时的全部视觉表现：
     * - styleId/style → lineStyle.layers 决定每层 lineWidth 倍率、opacity、strokeStyle、lineCap、dash、pattern
     * - line.width    → lineWidthBase，所有样式层宽度的计算基准
     * - color         → dynaColor，当 layer.colorMode === 'line' 时的线条颜色
     * - downplayed    → fixedColorConverter，当 layer.colorMode !== 'line' 时对固定颜色的淡化处理
     * - gradientKey   → 支线渐变色（colorMode === 'line' 层的 dynaColor），不同渐变的 span 不能合并
     * 
     * 同组的 span 具有完全相同的 canvas 渲染状态，因此可以把它们的路径累积到同一条
     * path 中（linkPts 内部使用 moveTo 开始每个 span，不会互相干扰），然后只需
     * 调用一次 doRenderSpan → strokeStyledLine 即可完成该组所有 span 的样式渲染。
     * 
     * scale 和 offset 来自 ctx 本身，同一次渲染中对所有 span 相同，无需参与分组。
     */
    function renderAllSpansStyle(ctx: CvsContext, infos: SpanRenderInfo[]) {
        // 按 (styleId, line.width, color, downplayed) 分组
        const groups = new Map<string, SpanRenderInfo[]>()
        for (const info of infos) {
            const effectiveStyleId = info.styleId ?? info.line.style
            const itsStyle = info.style || saveStore.save?.lineStyles?.find(x => x.id === effectiveStyleId)
            if (!itsStyle) continue

            const lineWidth = info.line.width || 1
            const key = `${itsStyle.id}|${lineWidth}|${info.color ?? ''}|${info.downplayed}|${info.gradientKey}`
            const existing = groups.get(key)
            if (existing) {
                existing.push(info)
            } else {
                groups.set(key, [info])
            }
        }

        for (const groupInfos of groups.values()) {
            const representative = groupInfos[0]
            const buildPath = () => {
                ctx.beginPath()
                for (const info of groupInfos) {
                    linkPts(ctx, info.formalPts, info.line, cs.getTurnRadiusOf, lineShouldSimplify())
                }
            }
            buildPath()
            doRenderSpan(ctx, representative.line, {
                color: representative.color,
                downplayed: representative.downplayed,
                style: representative.style,
                styleId: representative.styleId,
                strokeTarget: 'style',
                gradient: representative.gradient,
                pathBuilder: buildPath
            })
        }
    }

    /** 
     * 旧版渲染函数（整条线，目前仅用于 carpet 和选中点局部）
     */
    function doRender(
        ctx:CvsContext, lineInfo:Line, enforceNoFill?:boolean,
        enforceLineWidth?:number, type?:LineRenderType, strokeTarget?:LineStrokeTarget,
        gradient?:LineGradientResolution, pathBuilder?:()=>void
    ){
        const drawCarpet = (!type || type==='both' || type==='carpet') && (lineInfo.carpet ?? cs.config.lineCarpet)
        const drawBody = !type || type==='both' || type==='body'
        if(!lineInfo.isFilled || enforceNoFill || lineInfo.type!==LineType.terrain){
            const lineWidth = cs.config.lineWidth * (enforceLineWidth||lineInfo.width||1)
            ctx.lineJoin = 'round'
            ctx.lineCap = 'round'
            if(drawCarpet){
                if(pathBuilder) pathBuilder()
                const carpetWiden = lineInfo.carpetWidth ?? cs.config.lineCarpetWiden
                ctx.lineWidth = lineWidth+carpetWiden
                ctx.strokeStyle = cs.config.bgColor
                const opacityOriginal = ctx.globalAlpha || 1
                ctx.globalAlpha = opacityOriginal * (lineInfo.carpetOpacity ?? cs.config.lineCarpetOpacity ?? 1)
                ctx.stroke()
                ctx.globalAlpha = opacityOriginal
            }
            if(drawBody){
                const lineColor = gradient ?? lineStateStore.getLineActualColor(lineInfo)
                const lineDownplayed = lineStateStore.isLineDownplayed(lineInfo.id)
                let styleId = lineInfo.style
                if(styleId == -1 && lineInfo.parent){
                    // -1 表示跟随主线路的样式
                    styleId = saveStore.getLineById(lineInfo.parent)?.style
                }
                const itsStyle = saveStore.save?.lineStyles?.find(x=>x.id===styleId)
                if(itsStyle){
                    const scale = ctx.getCurrentScale()
                    const offset = ctx.getCurrentOffset()
                    strokeStyledLine(ctx, {
                        target: strokeTarget,
                        scale,
                        offset,
                        lineStyle: itsStyle,
                        lineWidthBase: lineWidth,
                        baseCap: lineCapWithDefault(lineInfo),
                        dynaColor: lineColor,
                        bgColor: cs.config.bgColor,
                        fixedColorConverter: (c)=>{
                            if(lineDownplayed)
                                return colorProc.colorProcDownplay.convert(c)
                            return c
                        },
                        pathBuilder
                    })
                }else{
                    if(pathBuilder) pathBuilder()
                    ctx.lineWidth = lineWidth
                    ctx.strokeStyle = typeof lineColor === 'string'
                        ? lineColor
                        : buildLineGradient(ctx, lineColor, lineWidth)
                    ctx.stroke()
                }
            }
        }else{
            ctx.lineJoin = 'round'
            ctx.lineCap = 'round'
            if(drawCarpet){
                if(pathBuilder) pathBuilder()
                const carpetWiden = cs.config.lineWidth * 0.5
                ctx.lineWidth = carpetWiden
                ctx.strokeStyle = cs.config.bgColor
                const opacityOriginal = ctx.globalAlpha || 1
                ctx.globalAlpha = opacityOriginal * (lineInfo.carpetOpacity ?? cs.config.lineCarpetOpacity ?? 1)
                ctx.stroke()
                ctx.globalAlpha = opacityOriginal
            }
            if(drawBody){
                ctx.fillStyle = lineStateStore.getLineActualColor(lineInfo)
                ctx.fill()
            }
        }
    }

    function lineCapWithDefault(lineInfo: Line){
        return lineInfo.cap || (lineInfo.type == LineType.common ? 'butt' : 'round') // 线路默认用方头，地形默认用圆头
    }

    return { renderAllLines, renderLine, renderSegsAroundActivePt }
})