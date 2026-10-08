import { LineStyle } from "aarc-core/models/save"
import { CvsContext, isSvgCanvasContext } from "./cvsContext"
import { usePatternStore } from "aarc-core/models/stores/patternStore"
import { Coord } from "aarc-core/models/coord"
import { buildLineGradient, LineGradientResolution } from "aarc-core/utils/lineUtils/lineGradient"

function isCvsContext(ctx: CanvasRenderingContext2D | CvsContext): ctx is CvsContext {
    return 'getUnderlyingCanvas' in ctx
}

export type LineStrokeTarget = 'base'|'style'|'both'

export function strokeStyledLine(
    ctx: CanvasRenderingContext2D|CvsContext,
    options: {
        target?: LineStrokeTarget,
        scale?:number,
        offset?:Coord,
        lineStyle?:LineStyle,
        lineWidthBase:number,
        baseCap:CanvasLineCap
        /** 线路本体色；支线渐变色时传入解析结果（pattern 层仍优先覆盖） */
        dynaColor:string | LineGradientResolution,
        /** colorMode==='bg' 时的颜色来源，缺省按白色处理 */
        bgColor?:string,
        fixedColorConverter:(c:string)=>string,
        pathBuilder?:()=>void
    }){
    const { target, scale, offset, lineWidthBase, lineStyle, baseCap, dynaColor, bgColor, fixedColorConverter, pathBuilder } = options
    const needRebuildPath = pathBuilder && isCvsContext(ctx) && isSvgCanvasContext(ctx.getUnderlyingCanvas() as any)
    const dynaStroke = typeof dynaColor === 'string' ? dynaColor : buildLineGradient(ctx, dynaColor, lineWidthBase)
    if(target != 'style' && !lineStyle?.noBase){
        // target 为 base 或 both 时，渲染线路本体
        if(needRebuildPath) pathBuilder()
        ctx.lineWidth = lineWidthBase
        ctx.globalAlpha = 1
        ctx.strokeStyle = dynaStroke
        ctx.setLineDash([])
        ctx.lineCap = baseCap
        ctx.stroke()
    }
    if(target == 'base' || !lineStyle)
        return // 如果接下来无需渲染样式，直接退出
    for(let i = lineStyle.layers.length - 1; i >= 0; i--){
        const layer = lineStyle.layers[i]
        //被input设置的width和opacity是字符串形式的数字，此处应该使用双等号判断是否为0，三等号判断将始终为false
        if(!layer.width || layer.width==0){
            continue
        }
        if(!layer.opacity || layer.opacity==0){
            continue
        }
        if(needRebuildPath) pathBuilder()
        ctx.lineWidth = lineWidthBase * layer.width
        ctx.globalAlpha = layer.opacity
        let color
        if(layer.colorMode === 'line')
            color = dynaStroke
        else if(layer.colorMode === 'bg')
            // bgColor 未经上游淡化处理，须走 converter 使淡化对背景色层生效
            color = fixedColorConverter(bgColor ?? 'white')
        else {
            if(layer.color){
                color = fixedColorConverter(layer.color)
            } else {
                color = 'white'
            }
        }

        ctx.strokeStyle = color
        ctx.lineCap = layer.cap || 'butt'

        if(layer.dash){
            const dashNums = parseDash(layer.dash)
            for(let i=0;i<dashNums.length;i++){
                dashNums[i] = dashNums[i]*lineWidthBase
            }
            ctx.setLineDash(dashNums)
        }
        else {
            ctx.setLineDash([])
            if(layer.pattern || layer.patternEmbedded){
                let offsetForPattern = offset ?? [0, 0]
                const patternStore = usePatternStore()
                // pattern 优先于渐变色（见决策）；渐变作为 tint 时回退其主色
                const tintColor = typeof color === 'string' ? color
                    : (typeof dynaColor === 'string' ? 'white' : dynaColor.fromColor)
                const patternBase = layer.patternEmbedded
                    ? patternStore.getRenderedOf(layer.patternEmbedded, scale ?? 1, offsetForPattern, tintColor, 1)
                    : patternStore.getRendered(layer.pattern!, scale ?? 1, offsetForPattern, tintColor, 1)
                if(patternBase){
                    const pattern = ctx.createPattern(patternBase, null)
                    if(pattern){
                        ctx.strokeStyle = pattern
                    }
                }
            }
        }

        ctx.stroke()
    }
    //容易忘记初始化的属性必须复位
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    ctx.lineCap = 'butt'
}
function parseDash(dashStr?:string):number[]{
    const res:number[] = []
    if(!dashStr)
        return res
    const parts = dashStr.split(' ')
    for(const p of parts){
        const pNum = parseFloat(p)
        if(!isNaN(pNum))
            res.push(pNum)
    }
    return res
}