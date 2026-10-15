import { Coord, QuadCoord, RectCoord, SgnCoord, SgnNumber } from "aarc-core/models/coord"
//import { concatFontStr } from "../lang/fontStr"
import { splitLinesClean } from "../lang/splitLines"
import { CvsContext, isSvgCanvasContext } from "aarc-core/models/cvs/common/cvsContext"
import { TextMetricsSelected } from "../type/TextMetricsSelected"
import { rotateRectToQuad, scaleRect, unionRect } from "../coordUtils/coordRect"

export interface DrawTextBodyOption{
    text?:string
    color:string
    font:string
    weight?:string
    style?:string
    fontSize:number
    rowHeight:number
}
export interface DrawTextStrokeOption{
    width:number
    color:string
    opacity:number
}
/**
 * 解析缩放倍率：非正数、非有限值（例如 input 清空后残留的空串）按 fallback 处理。
 * 负倍率会镜像矩形、翻转四边形顶点的环绕方向，破坏 quadInside 的命中检测，故不接受。
 */
export function resolveTextScale(value:unknown, fallback = 1):number{
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
/**
 * 副行带独立缩放的变换参数（绘制与测量共用，两条路径必须严格一致）。
 * - 横向：主、副行带沿锚点同侧对齐，副行带的锚点侧边缘恰落在 pos 上，主倍率绕 pos
 *   缩放不移动它，因此副横向只绕 pos（即该边缘）缩放。若绕副行带自身中心缩放，
 *   副文字会整体横移、脱离锚点侧，与主文字的表现不一致。
 * - 纵向：主、副行带是上下相接的两段，跟随主倍率的是**整块**（主+副）的锚点侧边缘，
 *   即 ySgn=1 块的顶边、ySgn=-1 块的底边、ySgn=0 块的中心线；块顶由调用方传入
 *   （rectFull 与 rectMain 的上边缘相同），块的底边就是 rectSub[1][1]。
 *   副倍率只改变块高，主副之间始终无缝相接：块整体平移 blockTranslateY，
 *   不能只把副顶边钉在“主倍率位置”而让块底边（在 ySgn=0/-1 时就是锚点侧）被推离锚点。
 *   ySgn=1 时块的顶边就是主行带上边缘、本已被主倍率钉住，位移为 0；副倍率等于主倍率时位移也为 0，
 *   因此“副跟随主”的整体缩放路径不受影响。
 * 倍率为 1 时缩放退化为平移（锚点公式 0/0），故分别给出 scaleCenter 与 translate。
 */
function getSubScaleTransform(rectSub:RectCoord, pos:Coord, ySgn:SgnNumber,
    blockTop:number, sx:number, sy:number, ssx:number, ssy:number){
    const subBandTop = rectSub[0][1]
    const subBandBottom = rectSub[1][1]
    const subBandHeight = subBandBottom - subBandTop
    const scaleMainY = (v:number)=>pos[1] + sy * (v - pos[1])
    //整块按“主副各自倍率”缩放后，把它平移回“锚点侧边缘跟随主倍率”的位置
    let blockTranslateY = 0
    if(ySgn === -1)
        blockTranslateY = scaleMainY(subBandBottom) - (scaleMainY(subBandTop) + ssy * subBandHeight)
    else if(ySgn === 0)
        blockTranslateY = scaleMainY((blockTop + subBandBottom)/2)
            - (scaleMainY(blockTop) + scaleMainY(subBandTop) + ssy * subBandHeight)/2
    const subTopTargetY = scaleMainY(subBandTop) + blockTranslateY
    return {
        blockTranslateY,
        scaleCenter: [
            pos[0],
            ssy !== 1 ? (subTopTargetY - ssy*subBandTop) / (1 - ssy) : subBandTop
        ] as Coord,
        translate: [
            0,
            ssy === 1 ? subTopTargetY - subBandTop : 0
        ] as Coord,
        mapRect: (r:RectCoord):RectCoord => [
            [pos[0] + ssx*(r[0][0]-pos[0]), subTopTargetY + ssy*(r[0][1]-subBandTop)],
            [pos[0] + ssx*(r[1][0]-pos[0]), subTopTargetY + ssy*(r[1][1]-subBandTop)]
        ],
        /** 主行带：按主倍率绕锚点缩放后，随整块一起平移 */
        mapMainRect: (r:RectCoord):RectCoord => {
            const scaled = scaleRect(r, pos, sx, sy)
            if(!blockTranslateY)
                return scaled
            return [
                [scaled[0][0], scaled[0][1] + blockTranslateY],
                [scaled[1][0], scaled[1][1] + blockTranslateY]
            ]
        }
    }
}
export function drawText(
    ctx:CvsContext, pos:Coord, align:SgnCoord, textAlignOverride: SgnNumber|undefined,
    main:DrawTextBodyOption, sub:DrawTextBodyOption, stroke?:DrawTextStrokeOption|false,
    task:'draw'|'measure'|'both' = 'both', width?:number, angle?:number,
    scaleX?:number, scaleY?:number, subScaleX?:number, subScaleY?:number
    ): {rectFull:QuadCoord, rectMain:QuadCoord}|undefined
{
    const [x, y] = pos
    const [xSgn, ySgn] = align

    ctx.textBaseline = 'middle'
    const { mainHeight, subHeight, mainLines, subLines } = splitLines(main, sub)
    if(mainLines.length===0 && subLines.length===0)
        //主、副文本均无有效行时不产生包围盒（调用方应清除缓存的矩形）
        return undefined
    const totalHeight = mainHeight+subHeight
    const mainRowMargin = main.rowHeight - main.fontSize
    const subRowMargin = sub.rowHeight - sub.fontSize
    const yTop = getYTop(y, ySgn, totalHeight, mainRowMargin, subRowMargin) //减去文本上下的空隙（半个“行距与字体大小之差”）
    const hasMainLine = mainLines.length > 0
    const hasSubLine = subLines.length > 0

    //调用方（worker）负责解析“本点副值 → 本点主值”的回退链；这里只兜住未传副倍率的情况（副跟随主）
    const sx = resolveTextScale(scaleX)
    const sy = resolveTextScale(scaleY)
    const ssx = resolveTextScale(subScaleX, sx)
    const ssy = resolveTextScale(subScaleY, sy)

    //const mainFontStr = concatFontStr(main.font, main.fontSize)
    //const subFontStr = concatFontStr(sub.font, sub.fontSize)
    const mainMeasures:ActualBaselineResult[] = []
    const subMeasures:ActualBaselineResult[] = []
    const enumerateMainLines = (fn:(text:string, ty:number, idx:number)=>void)=>{
        ctx.font = main
        for(let i=0; i<mainLines.length; i++){
            const text = mainLines[i]
            const yFromTop = (i + 0.5) * main.rowHeight
            if(!mainMeasures[i]){
                const baseline = getTextActualCenterBaseline(ctx, yTop+yFromTop, text)
                mainMeasures[i] = baseline
            }
            const shouldUseY = mainMeasures[i].shouldUseY
            fn(text, shouldUseY, i)
        }
    }
    const enumerateSubLines = (fn:(text:string, ty:number, idx:number)=>void)=>{
        ctx.font = sub
        for(let i=0; i<subLines.length; i++){
            const text = subLines[i]
            const yFromTop = (i + 0.5) * sub.rowHeight + mainHeight
            if(!subMeasures[i]){
                const baseline = getTextActualCenterBaseline(ctx, yTop+yFromTop, text)
                subMeasures[i] = baseline
            }
            const shouldUseY = subMeasures[i].shouldUseY
            fn(text, shouldUseY, i)
        }
    }
    //先测量所有行实际宽度
    enumerateMainLines(()=>{})
    enumerateSubLines(()=>{})

    const mainWidth = Math.max(...mainMeasures.map(x=>x.m.width))
    const subWidth = subMeasures.length ? Math.max(...subMeasures.map(x=>x.m.width)) : 0
    const biggestWidth = Math.max(mainWidth, ...subMeasures.map(x=>x.m.width))
    let xOffset = 0
    if(typeof textAlignOverride === 'number'){
        ctx.textAlign = getTextAlign(textAlignOverride)
        //如果textAlignOverride有值（意味着文本align与矩形align不一致）
        //则计算一个offset，让align不同的文本也刚好在矩形内
        const diff = textAlignOverride - align[0]
        xOffset = diff * biggestWidth/2
    }
    else
        //如果textAlignOverride没值（意味着文本align跟随矩形align）
        ctx.textAlign = getTextAlign(xSgn)
    const useX = x-xOffset

    const needDraw = task === 'draw' || task === 'both'
    const needMeasure = task === 'measure' || task === 'both'

    //未变换的轴对齐矩形（纯计算，绘制与测量共用）
    const rectFull = getRect(x, y, xSgn, ySgn, biggestWidth, totalHeight)
    const rectMain = getMainRectByFullRect(rectFull, xSgn, biggestWidth, mainWidth, totalHeight, mainHeight)
    const rectSub = getSubRectByFullRect(rectFull, xSgn, biggestWidth, subWidth, mainHeight)
    //副行带独立缩放的变换参数（见 getSubScaleTransform，绘制与 rectFull/rectSub 共用同一映射）
    const subTransform = getSubScaleTransform(rectSub, pos, ySgn, rectFull[0][1],
        sx, sy, ssx, ssy)
    const mapSubRect = subTransform.mapRect
    const mapMainRect = subTransform.mapMainRect

    //旋转与缩放都是画布变换，文字仍按“正着”的逻辑坐标绘制。
    //缩放发生在文字自身坐标系内（先缩放、后旋转、平移发生在旋转之前），与测量段的顺序一致。
    //scaleCenter/translate 允许与旋转中心不同：副文本独立缩放时横向绕锚点侧、纵向随整块平移
    const withTransform = (useSx:number, useSy:number, body:()=>void, scaleCenter:Coord = pos, translate:Coord = [0, 0])=>{
        const [translateX, translateY] = translate
        if(!needDraw || (!angle && useSx === 1 && useSy === 1 && !translateX && !translateY)){
            body()
            return
        }
        ctx.save()
        if(angle)
            ctx.rotateAround(pos[0], pos[1], angle)
        //平移发生在缩放之前发出，因此作用在“缩放之后”的输出空间里（画布矩阵是各调用的左乘累积）
        if(translateX || translateY)
            ctx.translateBy(translateX, translateY)
        if(useSx !== 1 || useSy !== 1)
            ctx.scaleAround(scaleCenter[0], scaleCenter[1], useSx, useSy)
        body()
        ctx.restore()
    }
    const paintStroke = (enumerate:(fn:(text:string, ty:number, idx:number)=>void)=>void)=>{
        if(!stroke || !needDraw) return
        const opacityOriginal = ctx.globalAlpha || 1
        ctx.strokeStyle = stroke.color
        ctx.globalAlpha = stroke.opacity
        ctx.lineWidth = stroke.width
        ctx.lineJoin = 'round'
        enumerate((text, ty)=>{
            ctx.strokeText(text, useX, ty)
        })
        ctx.globalAlpha = opacityOriginal
    }
    const paintFill = (enumerate:(fn:(text:string, ty:number, idx:number)=>void)=>void, color:string)=>{
        ctx.fillStyle = color
        enumerate((text, ty)=>{
            if(needDraw)
                ctx.fillText(text, useX, ty)
        })
    }

    if(ssx === sx && ssy === sy){
        //副倍率与主一致（含副未设置、跟随主值的常见情况）：主副共用一个变换块
        withTransform(sx, sy, ()=>{
            paintStroke(enumerateMainLines)
            paintStroke(enumerateSubLines)
            paintFill(enumerateMainLines, main.color)
            paintFill(enumerateSubLines, sub.color)
        })
    }
    else{
        //副倍率独立：主、副各套一个变换块（carpet 描边随各自的块）
        //主块也要跟着整块平移，否则主副行带会在锚点侧被拉开或重叠
        if(hasMainLine)
            withTransform(sx, sy, ()=>{
                paintStroke(enumerateMainLines)
                paintFill(enumerateMainLines, main.color)
            }, pos, [0, subTransform.blockTranslateY])
        if(hasSubLine)
            withTransform(ssx, ssy, ()=>{
                paintStroke(enumerateSubLines)
                paintFill(enumerateSubLines, sub.color)
            }, subTransform.scaleCenter, subTransform.translate)
    }

    if(needMeasure){
        const useAngle = angle ?? 0
        let rectFullScaled:RectCoord
        if(hasMainLine && hasSubLine){
            if(ssx === sx && ssy === sy){
                //副跟随主：主副行带绕同一锚点缩放，整体矩形绕锚点缩放即可
                rectFullScaled = scaleRect(rectFull, pos, sx, sy)
            }
            else{
                //主、副文本行带各自按各自倍率缩放，并随整块一起平移到“锚点侧边缘跟随主倍率”的位置，
                //再取并集的轴对齐包围盒。
                //两侧都只用自己的行带矩形（宽度=该行最大行宽）：rectFull 的宽度来自主副最大行宽，
                //若用它乘副倍率，会把源自主文本的宽度也缩放，主缩副不缩时矩形比文字宽、两侧留白
                rectFullScaled = unionRect(mapMainRect(rectMain), mapSubRect(rectSub))
            }
        }
        else{
            //只有一方有文本，另一方倍率无从生效；无主文本时盒子只能跟着副倍率
            rectFullScaled = hasSubLine
                ? scaleRect(rectFull, pos, ssx, ssy)
                : scaleRect(rectFull, pos, sx, sy)
        }
        if(width){
            //指定宽度是盒子与任何倍率无关的固定下限：文字先各自缩放，缩放后的实际宽度不足 width
            //时向锚点对侧拉长到 width，超出则保持撑大后的宽度
            enlargeRectToWidth(rectFullScaled, xSgn, width)
        }
        return {
            rectFull: rotateRectToQuad(rectFullScaled, pos, useAngle),
            //无主文本行时 rectMain 会退化成含 ±Infinity 的矩形（宽度取 max() 空集为 -Infinity），
            //此时退回整体矩形，避免调用方（糊弄渲染占位、命中并集）拿到异常四边形
            rectMain: hasMainLine
                ? rotateRectToQuad(mapMainRect(rectMain), pos, useAngle)
                : rotateRectToQuad(rectFullScaled, pos, useAngle)
        }
    }
}

const chineseStyleDropCapPattern = /^[0-9a-zA-Z]{1,3}(?=\s?号?环?线$)/
const chineseStyleDropCapLoosePattern = /^[0-9a-zA-Z]{1,10}(?=.*号?环?线$)/
export function drawTextForLineName(
    ctx:CvsContext, pos:Coord, align:SgnCoord, textAlignOverride:SgnNumber,
    main:DrawTextBodyOption, sub:DrawTextBodyOption, stroke?:DrawTextStrokeOption|false,
    task:'draw'|'measure'|'both' = 'both', width?:number, dropCap?:'classic'|'loose'|number, angle?:number):
    {isDropCap:boolean, rect:QuadCoord|undefined}|undefined
{
    const mainText = main.text?.trim() || ''
    const subText = sub.text?.trim() || ''
    if(!mainText && !subText)
        //主、副文本均为空时不产生包围盒（调用方应清除缓存的矩形）
        return undefined
    let useDropCap = false
    let dropCapPart = ''
    if(typeof dropCap == 'string'){
        const dropCapPattern = dropCap == 'loose' ? chineseStyleDropCapLoosePattern : chineseStyleDropCapPattern
        let match = dropCapPattern.exec(mainText)
        if(match && match.length>0){
            dropCapPart = match[0]
        }
        useDropCap = !!(dropCapPart && subText)
    }
    else if(typeof dropCap == 'number'){
        if(dropCap>0 && dropCap<=mainText.length){
            dropCapPart = mainText.substring(0, dropCap)
            useDropCap = true
        }
    }
    if(!useDropCap)
    {
        //如果不是需要dropCap的线路名，则fallback到一般的写法
        const textAlign = textAlignOverride
        return {
            isDropCap:false,
            rect:drawText(ctx, pos, align, textAlign, main, sub, stroke, task, width, angle)?.rectFull
        }
    }
    const needDraw = task === 'draw' || task === 'both'
    const needMeasure = task === 'measure' || task === 'both'
    const totalHeight = main.rowHeight + sub.rowHeight

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left' //如果是dropCap线路名，固定靠左
    const [x, y] = pos
    const [xSgn, ySgn] = align
    const yTop = getYTop(y, ySgn, totalHeight)

    const lineNum = dropCapPart
    const restPart = mainText.substring(lineNum.length).trim()
    const fontPadding = (main.rowHeight - main.fontSize + sub.rowHeight - sub.fontSize)
    const giantFontSize = main.fontSize + sub.fontSize + fontPadding
    const giantTextRowHeight = main.rowHeight + sub.rowHeight
    //const giantFontStr = concatFontStr(main.font, giantFontSize)
    //const mainFontStr = concatFontStr(main.font, main.fontSize)
    //const subFontStr = concatFontStr(sub.font, sub.fontSize)
    const giant = {font:main.font, fontSize:giantFontSize}
    ctx.font = giant
    const giantBaseline = getTextActualCenterBaseline(ctx, yTop+giantTextRowHeight/2, lineNum)
    ctx.font = main
    const mainBaseline = getTextActualCenterBaseline(ctx, yTop+main.rowHeight/2, restPart)
    ctx.font = sub
    const subBaseline = getTextActualCenterBaseline(ctx, yTop+main.rowHeight+sub.rowHeight/2, subText)
    const giantTextWidth = giantBaseline.m.width
    const giantMarginRight = giantFontSize*0.05
    const mainWidthWithMargin = mainBaseline.m.width + giantMarginRight
    const subWidthWithDoubleMargin = subBaseline.m.width + giantMarginRight * 2
    const totalWidth = giantBaseline.m.width + Math.max(mainWidthWithMargin, subWidthWithDoubleMargin)
    let xLeft = x
    if(xSgn == 0)
        xLeft -= totalWidth/2
    else if(xSgn == -1)
        xLeft -= totalWidth
    //旋转时：以 pos 为中心变换画布，文字仍按“正着”的逻辑坐标绘制
    const needRotate = needDraw && !!angle
    if(needRotate){
        ctx.save()
        ctx.rotateAround(x, y, angle)
    }
    if(needDraw){
        ctx.font = giant
        ctx.fillStyle = main.color
        ctx.fillText(lineNum, xLeft, giantBaseline.shouldUseY)
    }

    ctx.font = main
    if(needDraw){
        ctx.font = main
        const mainX = xLeft + giantTextWidth + giantMarginRight
        ctx.fillStyle = main.color
        ctx.fillText(restPart, mainX, mainBaseline.shouldUseY)
    }
    if(needDraw){
        ctx.font = sub
        const subX = xLeft + giantTextWidth + giantMarginRight*2 //额外加一倍margin
        const subY = subBaseline.shouldUseY
        ctx.fillStyle = sub.color
        ctx.fillText(subText, subX, subY)
    }
    if(needRotate){
        ctx.restore()
    }
    if(needMeasure){
        const rect = getRect(x, y, xSgn, ySgn, totalWidth, totalHeight)
        if(width){
            //如果指定了宽度，将矩形的宽度调整为指定宽度（沿文字方向，需在旋转前调整）
            enlargeRectToWidth(rect, xSgn, width)
        }
        return {
            isDropCap: true,
            rect: rotateRectToQuad(rect, pos, angle ?? 0)
        }
    }
}

export function splitLines(main:DrawTextBodyOption, sub:DrawTextBodyOption){
    const mainLines = splitLinesClean(main.text)
    const mainHeight = mainLines.length * main.rowHeight
    const subLines = splitLinesClean(sub.text)
    const subHeight = subLines.length * sub.rowHeight
    return {mainHeight, subHeight, mainLines, subLines}
}

function getTextAlign(xSgn:SgnNumber){
    if(xSgn==-1)
        return 'right'
    else if(xSgn==0)
        return 'center'
    else
        return 'left'
}
function getYTop(y:number, ySgn:SgnNumber, totalHeight:number, mainRowMargin:number=0, subRowMargin:number=0){
    let yTop = y;
    if(ySgn == -1){
        yTop -= totalHeight - subRowMargin/2
    }else if(ySgn == 0){
        yTop -= totalHeight/2
    }else{
        yTop -= mainRowMargin/2
    }
    return yTop
}
function getRect(x:number, y:number, xSgn:SgnNumber, ySgn:number, biggestWidth:number, totalHeight:number){
    let leftMost = Number(x);
    let rightMost = Number(x); // 有些时候（可能是老存档）这里的x是字符串，造成字符串加法计算
    if(Number.isNaN(leftMost))
        leftMost = 0
    if(Number.isNaN(rightMost))
        rightMost = 0
    // 以上的部分会被js引擎优化，开销忽略不计
    if(xSgn == -1){
        leftMost -= biggestWidth
    }
    else if(xSgn == 0){
        leftMost -= biggestWidth/2
        rightMost += biggestWidth/2
    }else{
        rightMost += biggestWidth
    }
    let yTop = y;
    if(ySgn == -1){
        yTop -= totalHeight
    }else if(ySgn == 0){
        yTop -= totalHeight/2
    }
    const leftUpper:Coord = [leftMost, yTop]
    const rightLower:Coord = [rightMost, yTop+totalHeight]
    const rect:RectCoord = [leftUpper, rightLower]
    return rect
}
function getMainRectByFullRect(
    rect:RectCoord, xSgn:SgnNumber,
    fullWidth:number, mainWidth:number, fullHeight:number, mainHeight:number){
    const mainRect:RectCoord = [[...rect[0]], [...rect[1]]]
    const widthDiff = fullWidth - mainWidth
    const heightDiff = fullHeight - mainHeight
    if(xSgn == -1){
        mainRect[0][0] += widthDiff
    }else if(xSgn == 0){
        mainRect[0][0] += widthDiff/2
        mainRect[1][0] -= widthDiff/2
    }else{
        mainRect[1][0] -= widthDiff
    }
    mainRect[1][1] -= heightDiff
    return mainRect
}
function getSubRectByFullRect(
    rect:RectCoord, xSgn:SgnNumber,
    fullWidth:number, subWidth:number, mainHeight:number){
    const subRect:RectCoord = [[...rect[0]], [...rect[1]]]
    const widthDiff = fullWidth - subWidth
    if(xSgn == -1){
        subRect[0][0] += widthDiff
    }else if(xSgn == 0){
        subRect[0][0] += widthDiff/2
        subRect[1][0] -= widthDiff/2
    }else{
        subRect[1][0] -= widthDiff
    }
    //主行带在上方（高度 mainHeight），副行带从其下缘开始
    subRect[0][1] += mainHeight
    return subRect
}
function enlargeRectToWidth(rect:RectCoord, xSgn:SgnNumber, width:number):void{
    //若rect的宽度小于width，则放大rect到指定宽度（以xSgn指定的方向）
    width = Number(width)
    if(isNaN(width)) return
    const widthDiff = width - (rect[1][0] - rect[0][0])
    if(widthDiff <= 0)
        return
    if(xSgn == -1){
        rect[0][0] -= widthDiff 
    }
    else if(xSgn == 0){
        rect[0][0] -= widthDiff/2
        rect[1][0] += widthDiff/2 
    }
    else{
        rect[1][0] += widthDiff 
    }
}

type ActualBaselineResult = {shouldUseY:number, m:TextMetricsSelected}
function getTextActualCenterBaseline(ctx:CvsContext, wantMiddleAtY:number, text:string):ActualBaselineResult{
    const m = ctx.measureText(text)
    ctx.textBaseline = 'middle'
    const fix = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent)/2
    // svgcanvas 的文本垂直定位与原生 canvas 不一致，
    // 对 'middle' baseline 的修正反而会放大偏差，因此 SVG 模式下不做修正。
    const shouldUseY = isSvgCanvasContext(ctx.getUnderlyingCanvas() as any)
        ? wantMiddleAtY
        : wantMiddleAtY + fix
    return {
        shouldUseY,
        m
    }
}