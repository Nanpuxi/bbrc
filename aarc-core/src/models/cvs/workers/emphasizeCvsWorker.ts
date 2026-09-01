import { Coord } from "aarc-core/models/coord";
import { Line } from "aarc-core/models/save";
import { useConfigStore } from "aarc-core/models/stores/configStore";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { isRing } from "aarc-core/utils/lineUtils/isRing";
import { defineStore } from "pinia";
import { CvsContext } from "../common/cvsContext";
import { useLineStateStore } from "aarc-core/models/stores/saveDerived/state/lineStateStore";

export const useEmphasizeCvsWorker = defineStore('emphasizeCvsWorker', ()=>{
    const saveStore = useSaveStore()
    const lineStateStore = useLineStateStore()
    const cs = useConfigStore()
    function renderEmphasizesForRingLines(ctx:CvsContext, range:Line[]){
        const targets:{color:string, pos:Coord}[] = []
        saveStore.save?.lines.forEach(line=>{
            if(!range.some(r=>r.id===line.id))
                return
            if(isRing(line)){
                const pt = saveStore.getPtById(line.pts[0])
                if(pt)
                    targets.push({pos:pt.pos, color:lineStateStore.getLineActualColor(line)})
            }
        })
        const radius = cs.config.ptStaSize*2
        targets.forEach(t=>{
            renderEmphasizeSingle(ctx, t.pos, t.color, radius)
        })
    }
    function renderEmphasizeSingle(ctx:CvsContext, coord:Coord, color:string, radius:number){
        ctx.beginPath()
        ctx.arc(...coord, radius, 0, 2*Math.PI)
        ctx.strokeStyle = cs.config.bgColor
        ctx.lineWidth = 10
        ctx.stroke()
        ctx.strokeStyle = color
        ctx.lineWidth = 5
        ctx.stroke()
    }
    return { renderEmphasizesForRingLines }
})