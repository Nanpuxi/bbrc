import { computed } from "vue";
import { defineStore } from "pinia";
import { useSaveStore } from "../saveStore";
import { ControlPoint } from "@/models/save";
import { Coord } from "@/models/coord";
import {
    AdjacentSeg as PtAdjacentSeg,
    computePtDirectionInfo,
    mergePtDirectionInfos,
    PtDirectionInfo
} from "@/utils/ptUtils/ptDirection";

export type { PtDirectionInfo } from "@/utils/ptUtils/ptDirection";

export interface AdjacentSeg {
    prev?: ControlPoint
    next?: ControlPoint
}

export const useFreePtDirectionStore = defineStore('freePtDirection', () => {
    const saveStore = useSaveStore()

    // 点可能出现在多条线路中（或同一条线路的多个位置），每次出现都有独立的
    // prev/next；全部保留，供吸附候选按每次出现分别生成后合并（十字形候选等）
    const adjacentSegsMap = computed<Record<number, AdjacentSeg[] | undefined>>(() => {
        const save = saveStore.save
        if (!save) return {}
        const res: Record<number, AdjacentSeg[] | undefined> = {}
        for (const pt of save.points) {
            if (!pt.free) continue
            const segs = saveStore.adjacentSegs(pt.id)
            for (const seg of segs) {
                const idx = seg.pts.findIndex(p => p.id === pt.id)
                if (idx === -1) continue
                const list = res[pt.id] ?? []
                list.push({
                    prev: seg.pts[idx - 1],
                    next: seg.pts[idx + 1]
                })
                res[pt.id] = list
            }
        }
        return res
    })

    const directionInfosMap = computed<Record<number, PtDirectionInfo[] | undefined>>(() => {
        const segs = adjacentSegsMap.value
        const res: Record<number, PtDirectionInfo[] | undefined> = {}
        for (const [ptIdStr, segList] of Object.entries(segs)) {
            const ptId = Number(ptIdStr)
            const pt = saveStore.getPtById(ptId)
            if (!pt || !segList) continue
            res[ptId] = segList.map(seg => {
                const adjSeg: PtAdjacentSeg = {
                    prev: seg.prev ? { pos: seg.prev.pos } : undefined,
                    next: seg.next ? { pos: seg.next.pos } : undefined
                }
                return computePtDirectionInfo(pt.pos, adjSeg)
            })
        }
        return res
    })

    /** 第一次出现的相邻段 */
    function getAdjacentSeg(ptId: number): AdjacentSeg | undefined {
        return adjacentSegsMap.value[ptId]?.[0]
    }

    /** 每次出现（每条线路）各自的方向信息，供吸附候选生成使用 */
    function getPtDirectionInfos(ptId: number): PtDirectionInfo[] | undefined {
        return directionInfosMap.value[ptId]
    }

    /** 合并视图：prev/next 取第一次出现，all 为各次出现方向的并集（供渲染方向选择使用） */
    function getPtDirectionInfo(ptId: number): PtDirectionInfo | undefined {
        const infos = directionInfosMap.value[ptId]
        if (!infos || infos.length === 0) return undefined
        return mergePtDirectionInfos(infos)
    }

    function getPtDirections(ptId: number): Coord[] {
        return getPtDirectionInfo(ptId)?.all ?? []
    }

    return {
        adjacentSegsMap,
        directionInfosMap,
        getAdjacentSeg,
        getPtDirectionInfos,
        getPtDirectionInfo,
        getPtDirections
    }
})
