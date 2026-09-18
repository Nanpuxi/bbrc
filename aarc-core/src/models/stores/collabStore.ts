import { defineStore } from "pinia";
import { ref } from "vue";
import type { Save } from "aarc-core/models/save";

/**
 * 协作会话 id 分区：id = -(prefix × 2^20 + counter)
 * 低 20 位为会话内计数器（每个前缀可分配约 100 万个 id），高 11 位为会话前缀（1..2047，由服务器在加入房间时分配）
 * 负数空间与存量正整数 id（idIncre 自增序列）零交集，且不会取到哨兵值 0
 * 前缀为租约制（在房期间唯一、离房回收），历史 id 撞号由进房时扫存档设种子兜底
 * 详见 docs/multiplayer/id-allocation.md 方案 C 与 §7.1
 */
export const collabIdCounterBits = 20
export const collabIdCounterCap = 2 ** collabIdCounterBits
export const collabIdPrefixMax = 2 ** (31 - collabIdCounterBits) - 1

/**
 * 扫描存档中落在指定前缀区间内的已用负 id，返回计数器种子（已用最大值 + 1，无则 0）。
 * 区间恰好填满时返回 collabIdCounterCap（此时 setIdPrefix 后 nextCollabId 立即抛耗尽，需换前缀）。
 * 进房时必须在快照同步完成后调用（同步完成前的存档可能缺他人刚创建的元素）。
 */
export function scanCollabIdSeed(save: Save, prefix: number): number {
    const base = prefix * collabIdCounterCap
    let max = -1
    // 带主键 id 的顶层数组（pointLinks 无 id）；save.ts 新增实体数组时需补充
    const arrays: ({ id: number }[] | undefined)[] = [
        save.points, save.lines, save.textTags,
        save.lineStyles, save.lineGroups, save.styleSlices, save.timeSlices,
        save.textTagIcons, save.patterns, save.dataSources, save.selectionGroups,
    ]
    for (const arr of arrays) {
        for (const item of arr ?? []) {
            const id = item.id
            if (id >= 0)
                continue
            const counter = -id - base
            if (counter >= 0 && counter < collabIdCounterCap && counter > max)
                max = counter
        }
    }
    return max + 1
}

export const useCollabStore = defineStore('collab', () => {
    /** 当前会话的 id 前缀，null 表示不在协作会话中（getNewId 回退到 idIncre 自增） */
    const idPrefix = ref<number|null>(null)
    const idCounter = ref(0)
    /** 设置前缀；seed 为计数器初值（进房时用 scanCollabIdSeed 扫存档得出，默认 0） */
    function setIdPrefix(prefix:number, seed = 0){
        if(!Number.isInteger(prefix) || prefix < 1 || prefix > collabIdPrefixMax)
            throw Error('非法的协作id前缀：' + prefix)
        if(!Number.isInteger(seed) || seed < 0 || seed > collabIdCounterCap)
            throw Error('非法的协作id计数种子：' + seed)
        idPrefix.value = prefix
        idCounter.value = seed
    }
    function clearIdPrefix(){
        idPrefix.value = null
        idCounter.value = 0
    }
    /** 取下一个协作 id；未设置前缀时返回 null；计数耗尽抛错（需向服务器申请新前缀） */
    function nextCollabId():number|null{
        const p = idPrefix.value
        if(p === null)
            return null
        if(idCounter.value >= collabIdCounterCap)
            throw Error('协作id计数耗尽，需要向服务器申请新前缀')
        return -(p * collabIdCounterCap + idCounter.value++)
    }
    return { idPrefix, setIdPrefix, clearIdPrefix, nextCollabId }
})
