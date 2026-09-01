import { ColorProcInvBinary } from "aarc-core/utils/colorUtils/colorProc/colorProcInvBinary";
import { ColorProcLineExtend } from "aarc-core/utils/colorUtils/colorProc/colorProcLineExtend";
import { ColorProcTerrainTag } from "aarc-core/utils/colorUtils/colorProc/colorProcTerrainTag";
import { ColorProcDownplay } from "aarc-core/utils/colorUtils/colorProc/colorProcDownplay";
import { defineStore } from "pinia";

export const useColorProcStore = defineStore('colorProc', ()=>{
    const colorProcLineExtend = new ColorProcLineExtend()
    const colorProcInvBinary = new ColorProcInvBinary()
    const colorProcTerrainTag = new ColorProcTerrainTag()
    const colorProcDownplay = new ColorProcDownplay()
    return { colorProcLineExtend, colorProcInvBinary, colorProcTerrainTag, colorProcDownplay }
})