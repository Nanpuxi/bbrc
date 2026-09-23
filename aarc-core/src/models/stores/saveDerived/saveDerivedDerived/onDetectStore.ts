import { defineStore } from "pinia";
import { useSaveStore } from "../../saveStore";
import { Coord } from "aarc-core/models/coord";
import { coordDistSq, coordDistSqLessThan, coordDistSqWithThrs } from "aarc-core/utils/coordUtils/coordDist";
import { ControlPoint, ControlPointDir, Line, LineType, TextTag } from "aarc-core/models/save";
import { useFormalizedLineStore } from "../formalizedLineStore";
import { useConfigStore } from "../../configStore";
import { coordOnLineOfFormalPts } from "aarc-core/utils/coordUtils/coordOnLine";
import { useStaNameRectStore } from "../staNameRectStore";
import { quadInside } from "aarc-core/utils/coordUtils/coordRect";
import { ExtendBtn, useLineExtendStore } from "./lineExtendStore";
import { useTextTagRectStore } from "../textTagRectStore";
import { useUniqueComponentsStore } from "aarc-core/app/globalStores/uniqueComponents";
import { useEditorLocalConfigStore } from "aarc-core/app/localConfig/editorLocalConfig";

export const useOnDetectStore = defineStore('onDetect', ()=>{
    const cs = useConfigStore()
    const saveStore = useSaveStore()
    const { enumerateFormalizedLines } = useFormalizedLineStore()
    const { enumerateStaNameRects } = useStaNameRectStore()
    const { enumerateLineExtendBtns } = useLineExtendStore()
    const { enumerateTextTagRects } = useTextTagRectStore()
    const { showPop } = useUniqueComponentsStore()
    const editorLocalConfig = useEditorLocalConfigStore()
    function ptLockedByLines(ptId:number){
        const belongLines = saveStore.getLinesByPt(ptId)
        return belongLines.length > 0 && belongLines.every(l=>l.locked)
    }
    function onPt(c:Coord, strictClosest?:boolean){
        if(saveStore.save?.points.length==0)
            return undefined
        if(!strictClosest){
            return saveStore.save?.points.find(p=>{
                if(ptLockedByLines(p.id))
                    return false
                const distSq = coordDistSq(p.pos, c)
                return distSq < cs.clickPtThrsSq
            })
        }
        let closestDistSq = 1e10
        let closestPt:ControlPoint|undefined = undefined
        saveStore.save?.points.map(p=>{
            if(ptLockedByLines(p.id))
                return
            const distSq = coordDistSqWithThrs(p.pos, c, cs.clickPtThrsSq)
            if(typeof distSq == 'number' && distSq < closestDistSq){
                closestDistSq = distSq
                closestPt = p
            }
        })
        if(closestDistSq < cs.clickPtThrsSq)
            return closestPt
    }
    // 记录上一次用户点击命中的锁定线路，连续点击同一条锁定线路时弹出提示
    let lastClickedLockedLineId:number|undefined = undefined
    function onLine(c:Coord, exceptLines:number[] = [], notifyLocked?:boolean){
        const res:{lineId:number, alignedPos:Coord, afterPtIdx:number, dir:ControlPointDir}[] = []
        let hitLockedLine = false
        enumerateFormalizedLines((lineId, formalPts)=>{
            if(exceptLines.includes(lineId))
                return;
            const onLineRes = coordOnLineOfFormalPts(c, formalPts, {
                clickLineThrs: cs.config.clickLineThrs,
                clickLineThrsSq: cs.clickLineThrsSq,
                clickLineThrs_sqrt2_sq: cs.clickLineThrs_sqrt2_sq
            })
            if(onLineRes){
                const line = saveStore.getLineById(lineId)
                if(line?.locked){
                    hitLockedLine = true
                    if(notifyLocked){
                        if(lastClickedLockedLineId === lineId){
                            showPop(`${line.name || '该线'}已锁定\n请前往列表解锁`, 'failed')
                            lastClickedLockedLineId = undefined
                        }else{
                            lastClickedLockedLineId = lineId
                        }
                    }
                    return;
                }
                res.push({
                    lineId: lineId,
                    alignedPos: onLineRes.aligned,
                    afterPtIdx: onLineRes.afterPt,
                    dir: onLineRes.dir
                })
            }
        })
        if(notifyLocked && !hitLockedLine)
            lastClickedLockedLineId = undefined
        //按视觉叠放顺序排列，使 res[0] 为最上层线路：
        //terrain 整体渲染在 common 下方；各自按 linesSortedByZIndex 稳定升序（后渲染者在上），
        //支线（child）跟随其 parent 一同渲染并叠在其上（与 renderAllLines 一致）
        if(res.length > 1){
            const rank = new Map<number, number>()
            let i = 0
            const pushFamily = (l:Line)=>{
                rank.set(l.id, i++)
                saveStore.getLinesByParent(l.id)?.forEach(c=>rank.set(c.id, i++))
            }
            const sorted = saveStore.linesSortedByZIndex
            sorted.filter(l=>!l.parent && l.type===LineType.terrain).forEach(pushFamily)
            sorted.filter(l=>!l.parent && l.type!==LineType.terrain).forEach(pushFamily)
            res.sort((a,b)=>(rank.get(b.lineId)??-1)-(rank.get(a.lineId)??-1))
        }
        return res
    }
    // 记录上一次用户点击命中的锁定站名所属点，连续点击同一锁定站名时弹出提示
    let lastClickedLockedStaNamePtId:number|undefined = undefined
    function onStaName(c:Coord, notifyLocked?:boolean){
        //站名按 save.points 的顺序渲染（下标大者视觉上更靠上），
        //在所有命中的站名中取最上层的一个；若最上层是锁定的，则视为命中锁定站名
        let onPt:ControlPoint|undefined;
        let hitLockedPt:ControlPoint|undefined;
        const pts = saveStore.save?.points
        let topIdx = -1
        let topPt:ControlPoint|undefined
        enumerateStaNameRects((ptId, quad)=>{
            if(!pts || !quadInside(quad, c))
                return
            const idx = pts.findIndex(pt => pt.id == ptId)
            if(idx <= topIdx)
                return
            topIdx = idx
            topPt = pts[idx]
        })
        if(topPt){
            if(ptLockedByLines(topPt.id))
                hitLockedPt = topPt
            else
                onPt = topPt
        }
        if(notifyLocked){
            if(hitLockedPt){
                if(lastClickedLockedStaNamePtId === hitLockedPt.id){
                    const lineName = saveStore.getLinesByPt(hitLockedPt.id)[0]?.name || '该线'
                    showPop(`${lineName}已锁定\n请前往列表解锁`, 'failed')
                    lastClickedLockedStaNamePtId = undefined
                }else{
                    lastClickedLockedStaNamePtId = hitLockedPt.id
                }
            }else{
                lastClickedLockedStaNamePtId = undefined
            }
        }
        return onPt;
    }
    function onLineExtendBtn(c:Coord){
        let onLeb:ExtendBtn|undefined
        enumerateLineExtendBtns(leb=>{
            if(coordDistSqLessThan(leb.btnPos, c, cs.clickPtThrsSq)){
                onLeb = leb
                return true
            }
        })
        return onLeb
    }
    function onTextTag(c:Coord){
        const { textTagClickMode } = editorLocalConfig
        //在所有命中的tag中取最后渲染（视觉上最上层）的一个
        let onTextTag:TextTag|undefined;
        let topSeq = -1;
        enumerateTextTagRects((id, item)=>{
            if(item.seq <= topSeq)
                return;
            const inQuad = textTagClickMode !== 'anchor' && quadInside(item.quad, c)
            const nearAnchor = textTagClickMode !== 'rect' && coordDistSqLessThan(item.anchor, c, cs.clickPtThrsSq)
            if(inQuad || nearAnchor){
                const tag = saveStore.save?.textTags.find(x=>x.id===id)
                if(tag){
                    onTextTag = tag
                    topSeq = item.seq
                }
            }
        })
        return onTextTag;
    }
    return { onPt, onLine, onStaName, onLineExtendBtn, onTextTag }
})