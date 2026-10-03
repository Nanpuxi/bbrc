import { Coord, QuadCoord, RectCoord, SgnCoord, SgnNumber } from "aarc-core/models/coord";
import { Line, LineType, TextOptions, TextTag } from "aarc-core/models/save";
import { useColorProcStore } from "aarc-core/models/stores/utils/colorProcStore";
import { useConfigStore } from "aarc-core/models/stores/configStore";
import { useTextTagRectStore } from "aarc-core/models/stores/saveDerived/textTagRectStore";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useLineStateStore } from "aarc-core/models/stores/saveDerived/state/lineStateStore";
import { drawText, DrawTextBodyOption, drawTextForLineName, DrawTextStrokeOption, splitLines } from "aarc-core/utils/drawUtils/drawText";
import { defineStore } from "pinia";
import { CvsContext } from "../common/cvsContext";
import { enlargeQuad, quadBoundingRect, toQuadCoord } from "aarc-core/utils/coordUtils/coordRect";
import { TextTagPerTypeGlobalConfig } from "aarc-core/models/config";
import { TextTagIconData, useIconStore } from "aarc-core/models/stores/iconStore";
import { keepOrderSort } from "aarc-core/utils/lang/keepOrderSort";
import { drawQuad, fillQuad } from "aarc-core/utils/drawUtils/drawRect";
import { drawCross } from "aarc-core/utils/drawUtils/drawCross";

export const useTextTagCvsWorker = defineStore('textTagCvsWorker', ()=>{
    const saveStore = useSaveStore()
    const lineStateStore = useLineStateStore()
    const cs = useConfigStore()
    const textTagRectStore = useTextTagRectStore()
    const colorProcStore = useColorProcStore()
    const iconStore = useIconStore()
    function renderAllTextTags(ctx:CvsContext, filter:'sunken'|'notSunken'){
        let allTags = saveStore.save?.textTags
        if(filter == 'sunken'){
            allTags = allTags?.filter(x=>!!x.sunken)
        }
        else{
            allTags = allTags?.filter(x=>!x.sunken)
        }
        //sunken 分组关系不变，zIndex 只决定组内的叠放顺序
        if(allTags)
            keepOrderSort(allTags, (x,y)=>(x.zIndex??0)-(y.zIndex??0))
        allTags?.forEach(t=>{
            renderOneTextTag(ctx, t)
        })
    }
    function renderOneTextTag(ctx:CvsContext, t:TextTag, strokeRect?:boolean){
        const opacityOriginal = ctx.globalAlpha || 1
        ctx.globalAlpha = t.opacity || 1
        if(t?.forId){
            const line = saveStore.getLineById(t.forId)
            if(line){
                if(line.type===LineType.common)
                    renderForCommonLine(ctx, t, line, strokeRect)
                else if(line.type===LineType.terrain){
                    renderForTerrainLine(ctx, t, line, strokeRect)
                }
            }
        }else{
            renderPlain(ctx, t, strokeRect)
        }
        ctx.globalAlpha = opacityOriginal
    }
    function renderForCommonLine(ctx:CvsContext, t:TextTag, lineInfo:Line, strokeRect?:boolean){
        const commonLineBuiltinRatio = 1.2
        const mainRatio = getFontSize(t.textOp, cs.config.textTagForLine.fontSize??1) * commonLineBuiltinRatio
        const subRatio = getFontSize(t.textSOp, cs.config.textTagForLine.subFontSize??1) * commonLineBuiltinRatio
        const color = lineStateStore.getLineTagActualColor(lineInfo)
        const downplayed = lineStateStore.isLineTagDownplayed(lineInfo.id)
        let textColor:string = ''
        if(downplayed)
            textColor = 'white'
        else
            textColor = lineInfo.tagTextColor ?? colorProcStore.colorProcInvBinary.convert(color)
        const mainEmpty = !t.text?.trim()
        const subEmpty = mainEmpty && !t.textS?.trim()
        const optMain:DrawTextBodyOption = {
            color: textColor,
            font: cs.config.textTagFont,
            fontSize: cs.config.textTagFontSizeBase * mainRatio,
            rowHeight: cs.config.textTagRowHeightBase * mainRatio,
            text: !mainEmpty ? t.text?.trim() : (lineInfo.name || '未命名线路')
        }
        const optSub:DrawTextBodyOption = {
            color: textColor,
            font: cs.config.textTagSubFont,
            fontSize: cs.config.textTagSubFontSizeBase * subRatio,
            rowHeight: cs.config.textTagSubRowHeightBase * subRatio,
            text: !subEmpty ? t.textS?.trim() : lineInfo.nameSub
        }
        const { anchor, textAlign, width } = getParams(cs.config.textTagForLine, t)
        const dropCapSwitch = t.dropCap ?? cs.config.textTagForLineDropCap
        let dropCap:'classic'|'loose'|number|undefined = undefined
        if(dropCapSwitch){
            dropCap = cs.config.textTagForLineDropCapDetect || 'classic' // 如果启用了，则使用指定检测模式
        }
        if(dropCapSwitch && typeof t.dropCapLength == 'number'){
            dropCap = t.dropCapLength // 如果启用了且设置了长度，则使用指定长度而不是自动检测
        }
        const paddingLineWidth = cs.config.lineWidth * getPadding(t, cs.config.textTagForLine.padding??1)
        const paddingValue = paddingLineWidth/2
        const needJustifyPos = cs.config.textTagForLine.edgeAnchorOutsidePadding ?? false
        const justifiedPos = needJustifyPos 
            ? justifyPosByAnchorAndPadding(t.pos, anchor, paddingValue) 
            : t.pos
        const angle = t.angle ?? 0
        const drawLineNameRes = drawTextForLineName(
            ctx, justifiedPos, anchor, textAlign, optMain, optSub, false, 'measure', width, dropCap, angle)
        if(drawLineNameRes?.rect){
            const quad = drawLineNameRes.rect
            fillQuad(ctx, quad, color)
            ctx.lineJoin = 'round'
            if(paddingValue>0){
                drawQuad(ctx, quad, color, paddingLineWidth)
            }
            drawTextForLineName(ctx, justifiedPos, anchor, textAlign, optMain, optSub, false, 'draw', width, dropCap, angle)
            const quadEnlarged = enlargeQuad(quad, paddingValue)
            textTagRectStore.setTextTagRect(t.id, quadEnlarged, t.pos)
            if(strokeRect){
                drawRectAndAnchor(ctx, t.pos, quadEnlarged)
            }
        }
    }
    function renderForTerrainLine(ctx:CvsContext, t:TextTag, lineInfo:Line, strokeRect?:boolean){
        const terrainLineBuiltinRatio = 1.2
        const mainRatio = getFontSize(t.textOp, cs.config.textTagForTerrain.fontSize??1) * terrainLineBuiltinRatio
        const subRatio = getFontSize(t.textSOp, cs.config.textTagForTerrain.subFontSize??1) * terrainLineBuiltinRatio
        const terrainColor = lineStateStore.getLineTagActualColor(lineInfo)
        const textColor = colorProcStore.colorProcTerrainTag.convert(terrainColor)
        const mainEmpty = !t.text?.trim()
        const subEmpty = mainEmpty && !t.textS?.trim()
        const optMain:DrawTextBodyOption = {
            color: textColor,
            font: cs.config.textTagFont,
            fontSize: cs.config.textTagFontSizeBase * mainRatio,
            rowHeight: cs.config.textTagRowHeightBase * mainRatio,
            text: !mainEmpty ? t.text?.trim() : (lineInfo.name || '未命名地形')
        }
        const optSub:DrawTextBodyOption = {
            color: textColor,
            font: cs.config.textTagSubFont,
            fontSize: cs.config.textTagSubFontSizeBase * subRatio,
            rowHeight: cs.config.textTagSubRowHeightBase * subRatio,
            text: !subEmpty ? t.textS?.trim() : lineInfo.nameSub
        }
        const { anchor, textAlign } = getParams(cs.config.textTagForTerrain, t)
        const drawLineNameRes = drawTextForLineName(ctx, t.pos, anchor, textAlign, optMain, optSub, {
            width: cs.config.textTagFontSizeBase * mainRatio/4,
            color: terrainColor,
            opacity: t.opacity || 1
        }, 'both', undefined, undefined, t.angle ?? 0)
        if(drawLineNameRes?.rect){
            const quad = drawLineNameRes.rect
            textTagRectStore.setTextTagRect(t.id, quad, t.pos)
            if(strokeRect){
                drawRectAndAnchor(ctx, t.pos, quad)
            }
        }
    }
    function renderPlain(ctx:CvsContext, t:TextTag, strokeRect?:boolean){
        const mo = t.textOp
        const so = t.textSOp
        const mainEmpty = !t.text?.trim()
        const subEmpty = mainEmpty && !t.textS?.trim()
        const mainRatio = getFontSize(mo, cs.config.textTagPlain.fontSize??1)
        const subRatio = getFontSize(so, cs.config.textTagPlain.subFontSize??1)
        const { anchor, textAlign } = getParams(cs.config.textTagPlain, t)
        const textDrawPos:Coord = [...t.pos]

        const onlyIcon = mainEmpty
        const iconId = t.icon
        const icon = saveStore.save?.textTagIcons?.find(x=>x.id==iconId)
        let idata:TextTagIconData|undefined = undefined
        let iconWidth = 0, iconHeight = 0
        let getIconPosX:((tposX:number, tw:number)=>number) = (x)=>x;//怎么通过t.pos和文本部分的宽高确定icon中心位置
        let getIconPosY:((tposY:number, th:number)=>number) = (y)=>y;
        const g = onlyIcon ? 0 : mainRatio*7 // gap（icon和文字之间的像素数，确定为mainRatio的固定倍率）
        //无文字时gap设为0，否则图标会偏上

        const optMain:DrawTextBodyOption = {
            color: mo?.color || cs.config.textTagFontColorHex,
            font: mo?.font || cs.config.textTagFont,
            weight: mo?.weight ?? cs.config.textTagFontWeight,
            style: mo?.style ?? cs.config.textTagFontStyle,
            fontSize: cs.config.textTagFontSizeBase * mainRatio,
            rowHeight: cs.config.textTagRowHeightBase * mainRatio,
            text: !mainEmpty ? t.text?.trim() : '空文本标签'
        }
        const optSub:DrawTextBodyOption = {
            color: so?.color || cs.config.textTagSubFontColorHex,
            font: so?.font || cs.config.textTagSubFont,
            weight: so?.weight ?? cs.config.textTagSubFontWeight,
            style: so?.style ?? cs.config.textTagSubFontStyle,
            fontSize: cs.config.textTagSubFontSizeBase * subRatio,
            rowHeight: cs.config.textTagSubRowHeightBase * subRatio,
            text: !subEmpty ? t.textS?.trim(): 'Empty TextTag'
        }

        let iconValid = false
        if(icon){
            idata = iconStore.getDataByIconId(icon.id)
            if(idata?.status==='loaded' && idata?.naturalWidth && idata.naturalHeight){
                iconValid = true
                let iw = icon.width ?? 50
                if(iw < 10)
                    iw = 10
                const iwhr = idata.naturalWidth / idata.naturalHeight
                const ih = iw / iwhr
                iconWidth = iw; iconHeight = ih;
                if(textAlign===0){
                    //文本居中时，icon放在顶部，可能会把text往下挤
                    if(anchor[1]===-1){
                        //y锚点在底部时，text不动
                        getIconPosY = (posY, th)=>posY-(th+ih/2) -g
                    }else if(anchor[1]===0){
                        textDrawPos[1]+=ih/2 +g/2
                        getIconPosY = (posY, th)=>posY-th/2 -g/2
                    }else{
                        textDrawPos[1]+=ih +g
                        getIconPosY = (posY)=>posY+ih/2
                    }
                    if(anchor[0] !== 0){
                        //当发生“文本居中，但x锚点不居中而是在左侧，而且icon比文本宽”的情况，
                        //就需要将整体右移半个宽度差，才能确保锚点在左边缘
                        //（否则锚点位置完全由文本左边缘决定，即使icon已经把边缘撑大）
                        //所以此处不得不measure一次
                        const textRect = drawText(ctx, t.pos, [0, 0], 0, optMain, optSub, false, 'measure')
                        const rect = textRect ? quadBoundingRect(textRect.rectFull) : undefined
                        let tw = 0
                        if(rect)
                            tw = rect[1][0] - rect[0][0]
                        const fix = iconWidth>tw ? (iconWidth-tw)/2 : 0
                        if(anchor[0]===-1){
                            textDrawPos[0]-=fix
                            getIconPosX = (posX, tw)=>posX-tw/2 -fix
                        }else if(anchor[0]===1){
                            textDrawPos[0]+=fix
                            getIconPosX = (posX, tw)=>posX+tw/2 +fix
                        }
                    }
                }else{
                    if(textAlign===-1){
                        //文本靠右时，icon放在右侧，可能会把text往左挤
                        if(anchor[0]===1){
                            //x锚点在左侧时，text不动
                            getIconPosX = (posX, tw)=>posX+tw+iw/2 +g
                        }else if(anchor[0]===0){
                            textDrawPos[0]+= -iw/2 -g/2
                            getIconPosX = (posX, tw)=>posX+tw/2 +g/2
                        }else{
                            textDrawPos[0]+= -iw -g
                            getIconPosX = (posX)=>posX-=iw/2
                        }
                    }else{
                        //文本靠左时，icon放在左侧，可能会把text往右挤
                        if(anchor[0]===-1){
                            //x锚点在右侧时，text不动
                            getIconPosX = (posX, tw)=>posX-(tw+iw/2) -g
                        }else if(anchor[0]===0){
                            textDrawPos[0]+=iw/2 +g/2
                            getIconPosX = (posX, tw)=>posX-tw/2 -g/2
                        }else{
                            textDrawPos[0]+=iw +g
                            getIconPosX = (posX)=>posX+iw/2
                        }
                    }
                    if(anchor[1]!==0){
                        //当发生“文本不居中，但y锚点不居中而是在顶部，而且icon比文本高”的情况，
                        //就需要将整体下移半个高度差，才能确保锚点在上边缘
                        //（否则锚点位置完全由文本上边缘决定，即使icon已经把边缘撑大）
                        //所以此处不得不计算文本高度
                        const { mainHeight:tmh, subHeight:tsh } = splitLines(optMain, optSub)
                        const th = tmh+tsh
                        const fix = iconHeight>th ? (iconHeight-th)/2 : 0
                        if(anchor[1]===-1){
                            textDrawPos[1] -= fix
                            getIconPosY = (posY, th)=> posY-th/2 - fix
                        }else{
                            textDrawPos[1] += fix
                            getIconPosY = (posY, th)=>posY+th/2 + fix
                        }
                    }
                }
            }
        }

        let textCarpetOpts:false|DrawTextStrokeOption|undefined={
            width: cs.config.textTagFontSizeBase * mainRatio/4 * cs.config.textTagCarpetWidth,
            color: cs.config.bgColor,
            opacity: (t.opacity || 1) * (cs.config.textTagCarpetOpacity ?? 1)
        }
        if (!(t.carpet ?? cs.config.textTagCarpet))
            textCarpetOpts=false
        const angle = t.angle ?? 0
        const noTextToDraw = iconValid && onlyIcon
        let rectFull:RectCoord|undefined //不包括icon，只包括文字的rect（未旋转的轴对齐矩形）
        if(noTextToDraw){
            rectFull = undefined
        }
        else{
            //布局（icon 位置、宽度撑开等）基于未旋转的轴对齐矩形计算
            const measured = drawText(ctx, textDrawPos, anchor, textAlign, optMain, optSub, false, 'measure')
            rectFull = measured ? quadBoundingRect(measured.rectFull) : undefined
        }
        //文字与 icon 的组合整体绕 t.pos 旋转绘制
        if(angle){
            ctx.save()
            ctx.rotateAround(t.pos[0], t.pos[1], angle)
        }
        if(!noTextToDraw){
            drawText(ctx, textDrawPos, anchor, textAlign, optMain, optSub, textCarpetOpts, 'draw')
        }

        let iconRect:RectCoord|undefined
        if(icon && idata?.img && iconValid && getIconPosY && getIconPosX){
            let tw = 0, th = 0;
            if(rectFull){
                tw = rectFull[1][0] - rectFull[0][0]
                th = rectFull[1][1] - rectFull[0][1]
            }
            const ipx = getIconPosX(t.pos[0], tw)
            const ipy = getIconPosY(t.pos[1], th)
            const iconPos:Coord = [ipx, ipy]
            iconPos[0]-=iconWidth/2; iconPos[1]-=iconHeight/2
            const iconRightBottomPos:Coord = [...iconPos]
            iconRightBottomPos[0]+=iconWidth
            iconRightBottomPos[1]+=iconHeight
            iconRect = [[...iconPos], [...iconRightBottomPos]]
            ctx.drawImage(idata.img, ...iconPos, iconWidth, iconHeight)
        }
        if(angle){
            ctx.restore()
        }
        if(!rectFull && iconRect){
            rectFull = iconRect
        }
        else if(rectFull && iconWidth && iconHeight){
            enlargeRectByIcon(rectFull, iconWidth, iconHeight, g, textAlign)
        }
        //rectFull变为包括icon的rect，存储时绕 t.pos 旋转为四边形
        textTagRectStore.setTextTagRect(t.id, rectFull, t.pos, angle)
        if(strokeRect){
            drawRectAndAnchor(ctx, t.pos, rectFull ? toQuadCoord(rectFull, t.pos, angle) : undefined)
        }
    }
    function getFontSize(textOptions:TextOptions|undefined, fallback:number):number{
        //坑爹的input会把值设为string
        let val:number|string|undefined = textOptions?.size
        if(val===undefined)
            val = 0
        else
            val = Number(val)
        if(val < 0)
            val = 0
        if(val > 16)
            val = 16
        return val || fallback
    }
    function getPadding(textTag:TextTag, fallback:number):number{
        //坑爹的input会把值设为string
        let val:number|string|undefined = textTag.padding
        if(val===undefined)
            val = 0
        else
            val = Number(val)
        if(val < 0)
            val = 0
        if(val > 16)
            val = 16
        return val || fallback
    }
    function getParams(config:TextTagPerTypeGlobalConfig, options:TextTag){
        const anchorX = options.anchorX ?? config.anchorX ?? 0
        const anchorY = options.anchorY ?? config.anchorY ?? 0
        const anchor:SgnCoord = [anchorX, anchorY]

        const width = Number(options.width) || Number(config.width) || 0
        
        //textAlign全局设置为undefined其实指的是默认值null(跟随anchorX)
        const globalTextAlignMean = config.textAlign ?? null 

        //仅在options为undefined时使用全局设置，null也是个有效值(跟随anchorX)
        let textAlign = options.textAlign===undefined ? globalTextAlignMean : options.textAlign
        
        if(textAlign === null)
            textAlign = anchorX //textAlign为null指的是跟随anchorX
        return{
            anchor,
            textAlign,
            width
        }
    }
    function justifyPosByAnchorAndPadding(originalPos:Coord, anchor:SgnCoord, paddingValue:number):Coord{
        let [ x, y ] = originalPos
        if(anchor[0]===-1)
            x -= paddingValue
        else if(anchor[0]===1)
            x += paddingValue
        if(anchor[1]===-1)
            y -= paddingValue
        else if(anchor[1]===1)
            y += paddingValue
        return [ x, y ]
    }
    function drawRectAndAnchor(ctx:CvsContext, anchorPos:Coord, quad?:QuadCoord){
        const opacityOriginal = ctx.globalAlpha || 1
        ctx.globalAlpha = 1
        if(quad)
            drawQuad(ctx, quad, 'black', 1.5)
        drawCross(ctx, {
            pos: anchorPos,
            dir: "vertical",
            armLength: 6,
            repetitions: [{
                armWidth: 7,
                color: 'white'
            },{
                armWidth: 2,
                color: 'black'
            }]
        })
        ctx.globalAlpha = opacityOriginal
    }
    function enlargeRectByIcon(rect:RectCoord, iconW:number, iconH:number, gap:number, pos:SgnNumber){
        if(pos == 0){
            const width = rect[1][0] - rect[0][0]
            if(iconW > width){
                rect[0][0] -= (iconW - width)/2
                rect[1][0] += (iconW - width)/2
            }
            rect[0][1] -= (gap + iconH)
        }
        else{
            const height = rect[1][1] - rect[0][1]
            if(iconH > height){
                rect[0][1] -= (iconH - height)/2
                rect[1][1] += (iconH - height)/2
            }
            if(pos == 1){
                rect[0][0] -= (gap + iconW)
            }
            else if(pos == -1){
                rect[1][0] += (gap + iconW)
            }
        }
    }
    return { renderAllTextTags, renderOneTextTag }
})