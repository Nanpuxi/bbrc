import { Ref } from "vue";
import { Coord } from "aarc-core/models/coord";
import { ColorPreset, ControlPoint, ControlPointDir, ControlPointSta, Line, LineType } from "aarc-core/models/save";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useCvsFrameStore } from "aarc-core/models/stores/cvsFrameStore";
import { useSnapStore } from "aarc-core/models/stores/snapStore";
import { useOnDetectStore } from "aarc-core/models/stores/saveDerived/saveDerivedDerived/onDetectStore";
import { coordAvg } from "aarc-core/utils/coordUtils/coordMath";

export interface LineCreationDeps {
    rerender: Ref<(changedLines?:number[], staNameMoved?:number[])=>void>
    activeLine: Ref<Line|undefined>
    cursorPos: Ref<Coord|undefined>
    ensureCoordInCanvas: (coord:Coord, margin?:number)=>void
    ensureChildrenOptionsSame: (parentLineId:number)=>Line[]
}

//新线路/新地形的创建逻辑（从 envStore 分离）
export function useLineCreation(deps: LineCreationDeps){
    const saveStore = useSaveStore()
    const { getViewCenterOffset, translateFromOffset } = useCvsFrameStore()
    const { snapGrid } = useSnapStore()
    const { onPt, onLine, onStaName } = useOnDetectStore()
    const { rerender, activeLine, cursorPos, ensureCoordInCanvas, ensureChildrenOptionsSame } = deps

    //获取视野中心对应的画布坐标（限制在画布范围内）
    function getViewCenterCoord(){
        const viewCenter = getViewCenterOffset()
        let viewCenterCoord:Coord|undefined = [viewCenter.x, viewCenter.y]
        viewCenterCoord = translateFromOffset(viewCenterCoord)
        if(!viewCenterCoord)
            return
        ensureCoordInCanvas(viewCenterCoord)
        return viewCenterCoord
    }
    //确保新点位置不压在现有点/站名/线上（垂直方向逐步错开）
    function ensureSpaceForNewPt(coord:Coord){
        const original:Coord = [...coord]
        let safty = 16
        let ok = false
        let offset = 20;
        let offsetSgn = 1
        while(!ok){
            ok = !onPt(coord)
            if(ok)
                ok = !onStaName(coord)
            if(ok)
                ok = onLine(coord).length == 0
            if(!ok){
                coord[1] = original[1] + offset*offsetSgn
                offsetSgn *= -1
                if(offsetSgn > 0)
                    offset += 40
            }
            safty--;
            if(safty<=0)
                break;
        }
    }
    function createLine(type:LineType, group:number|undefined, parentLineId:number|undefined){
        if(!saveStore.save)
            return
        const viewCenterCoord = getViewCenterCoord()
        if(!viewCenterCoord)
            return
        const pt1Pos:Coord = [...viewCenterCoord]
        const pt2Pos:Coord = [...viewCenterCoord]
        pt1Pos[0] -= 75
        pt2Pos[0] += 75
        ensureSpaceForNewPt(pt1Pos)
        ensureSpaceForNewPt(pt2Pos)
        const pt1:ControlPoint = {
            id: saveStore.getNewId(),
            pos: snapGrid(pt1Pos, undefined, undefined, true) ?? pt1Pos,
            dir: ControlPointDir.vertical,
            sta: ControlPointSta.sta
        }
        const pt2:ControlPoint = {
            id: saveStore.getNewId(),
            pos: snapGrid(pt2Pos, undefined, undefined, true) ?? pt2Pos,
            dir: ControlPointDir.vertical,
            sta: ControlPointSta.sta
        }
        saveStore.save.points.push(pt1, pt2)
        let newLine:Line|undefined = undefined
        let parent = parentLineId
        if(type==LineType.common){
            newLine = {
                id: saveStore.getNewId(),
                pts: [pt1.id, pt2.id],
                name: '',
                nameSub: '',
                color: "#ff0000",
                type: LineType.common,
                group,
                parent
            }
        }else if(type==LineType.terrain){
            newLine = {
                id: saveStore.getNewId(),
                pts: [pt1.id, pt2.id],
                name: '',
                nameSub: '',
                color: "#000000",
                type: LineType.terrain,
                colorPre: ColorPreset.water,
                group
            }
        }
        if(newLine){
            saveStore.createNewLine(newLine)
            if(parent){
                ensureChildrenOptionsSame(parent)
                newLine.style = -1 // 新创建的线路：style设为-1（表示跟随主线）
            }
            rerender.value([newLine.id], [pt1.id, pt2.id])
            activeLine.value = newLine
            cursorPos.value = coordAvg(pt1.pos, pt2.pos)
        }
    }
    function createClosedTerrainLine(group:number|undefined){
        if(!saveStore.save)
            return
        const viewCenterCoord = getViewCenterCoord()
        if(!viewCenterCoord)
            return
        //以视野中心为中心的矩形四角
        const cornerPoses:Coord[] = [
            [viewCenterCoord[0]-75, viewCenterCoord[1]-75],
            [viewCenterCoord[0]+75, viewCenterCoord[1]-75],
            [viewCenterCoord[0]+75, viewCenterCoord[1]+75],
            [viewCenterCoord[0]-75, viewCenterCoord[1]+75]
        ]
        const pts:ControlPoint[] = []
        for(const cornerPos of cornerPoses){
            ensureSpaceForNewPt(cornerPos)
            const pt:ControlPoint = {
                id: saveStore.getNewId(),
                pos: snapGrid(cornerPos, undefined, undefined, true) ?? cornerPos,
                dir: ControlPointDir.vertical,
                sta: ControlPointSta.plain
            }
            saveStore.save.points.push(pt)
            pts.push(pt)
        }
        const newLine:Line = {
            id: saveStore.getNewId(),
            pts: [...pts.map(p=>p.id), pts[0].id], //环线：头尾相同
            name: '',
            nameSub: '',
            color: "#000000",
            type: LineType.terrain,
            colorPre: ColorPreset.water,
            isFilled: true,
            group
        }
        saveStore.createNewLine(newLine)
        rerender.value([newLine.id], pts.map(p=>p.id))
        activeLine.value = newLine
        cursorPos.value = [...viewCenterCoord]
    }

    return { createLine, createClosedTerrainLine }
}
