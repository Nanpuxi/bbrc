import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * 协作会话 id 分区：id = -(prefix × 2^20 + counter)
 * 低 20 位为会话内计数器（每个前缀可分配约 100 万个 id），高 11 位为会话前缀（1..2047，由服务器在加入房间时分配）
 * 负数空间与存量正整数 id（idIncre 自增序列）零交集，且不会取到哨兵值 0
 * 详见 docs/multiplayer/id-allocation.md 方案 C
 */
export const collabIdCounterBits = 20
export const collabIdCounterCap = 2 ** collabIdCounterBits
export const collabIdPrefixMax = 2 ** (31 - collabIdCounterBits) - 1

export const useCollabStore = defineStore('collab', () => {
    /** 当前会话的 id 前缀，null 表示不在协作会话中（getNewId 回退到 idIncre 自增） */
    const idPrefix = ref<number|null>(null)
    const idCounter = ref(0)
    function setIdPrefix(prefix:number){
        if(!Number.isInteger(prefix) || prefix < 1 || prefix > collabIdPrefixMax)
            throw Error('非法的协作id前缀：' + prefix)
        idPrefix.value = prefix
        idCounter.value = 0
    }
    function clearIdPrefix(){
        idPrefix.value = null
        idCounter.value = 0
    }
    /** 取下一个协作 id；未设置前缀时返回 null；计数耗尽抛错（需重新加入房间换取新前缀） */
    function nextCollabId():number|null{
        const p = idPrefix.value
        if(p === null)
            return null
        if(idCounter.value >= collabIdCounterCap)
            throw Error('协作id计数耗尽，需要重新加入房间获取新前缀')
        return -(p * collabIdCounterCap + idCounter.value++)
    }
    return { idPrefix, setIdPrefix, clearIdPrefix, nextCollabId }
})
