import { defineStore } from "pinia";
import { useSaveStore } from "../../saveStore";
import { Coord } from "aarc-core/models/coord";
import { coordDistSq, coordDistSqLessThan, coordDistSqWithThrs } from "aarc-core/utils/coordUtils/coordDist";
import { ControlPoint, ControlPointDir, TextTag } from "aarc-core/models/save";
import { useFormalizedLineStore } from "../formalizedLineStore";
import { useConfigStore } from "../../configStore";
import { coordOnLineOfFormalPts } from "aarc-core/utils/coordUtils/coordOnLine";
import { useStaNameRectStore } from "../staNameRectStore";
import { quadInside } from "aarc-core/utils/coordUtils/coordRect";
import { ExtendBtn, useLineExtendStore } from "./lineExtendStore";
import { useTextTagRectStore } from "../textTagRectStore";
import { useUniqueComponentsStore } from "aarc-core/app/globalStores/uniqueComponents";

export const useOnDetectStore = defineStore('onDetect', ()=>{
    const cs = useConfigStore()
    const saveStore = useSaveStore()
    const { enumerateFormalizedLines } = useFormalizedLineStore()
    const { enumerateStaNameRects } = useStaNameRectStore()
    const { enumerateLineExtendBtns } = useLineExtendStore()
    const { enumerateTextTagRects } = useTextTagRectStore()
    const { showPop } = useUniqueComponentsStore()
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
        return res
    }
    // 记录上一次用户点击命中的锁定站名所属点，连续点击同一锁定站名时弹出提示
    let lastClickedLockedStaNamePtId:number|undefined = undefined
    function onStaName(c:Coord, notifyLocked?:boolean){
        let onPt:ControlPoint|undefined;
        let hitLockedPt:ControlPoint|undefined;
        enumerateStaNameRects((ptId, quad)=>{
            if(quadInside(quad, c)){
                const pt = saveStore.save?.points.find(pt => pt.id == ptId)
                if(pt && ptLockedByLines(pt.id)){
                    hitLockedPt = pt
                    return true;
                }
                onPt = pt;
                return true;
            }
        })
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
        let onTextTag:TextTag|undefined;
        enumerateTextTagRects((id, item)=>{
            if(quadInside(item.quad, c) || coordDistSqLessThan(item.anchor, c, cs.clickPtThrsSq)){
                onTextTag = saveStore.save?.textTags.find(x=>x.id===id)
                return true;
            }
        })
        return onTextTag;
    }
    return { onPt, onLine, onStaName, onLineExtendBtn, onTextTag }
})