import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabStore, collabIdCounterCap, collabIdPrefixMax } from 'aarc-core/models/stores/collabStore'
import { Save } from 'aarc-core/models/save'

function createSave(idIncre = 100): Save {
    return {
        idIncre,
        points: [],
        lines: [],
        textTags: [],
        cvsSize: [1000, 1000],
        config: {},
        meta: {},
    } as Save
}

describe('collabStore 会话前缀 id 分配', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('未设置前缀时 getNewId 回退到 idIncre 自增', () => {
        const saveStore = useSaveStore()
        saveStore.save = createSave(100)
        expect(saveStore.getNewId()).toBe(100)
        expect(saveStore.getNewId()).toBe(101)
        expect(saveStore.save.idIncre).toBe(102)
    })

    it('设置前缀后 getNewId 返回负数分区 id，且不触碰 idIncre', () => {
        const saveStore = useSaveStore()
        const collabStore = useCollabStore()
        saveStore.save = createSave(100)
        collabStore.setIdPrefix(3)
        const id1 = saveStore.getNewId()
        const id2 = saveStore.getNewId()
        expect(id1).toBe(-(3 * collabIdCounterCap))
        expect(id2).toBe(-(3 * collabIdCounterCap + 1))
        expect(saveStore.save.idIncre).toBe(100)
    })

    it('不同前缀的 id 区间互不重叠', () => {
        const saveStore = useSaveStore()
        const collabStore = useCollabStore()
        saveStore.save = createSave()
        collabStore.setIdPrefix(1)
        const a1 = saveStore.getNewId()
        const a2 = saveStore.getNewId()
        collabStore.setIdPrefix(2)
        const b1 = saveStore.getNewId()
        expect(new Set([a1, a2, b1]).size).toBe(3)
        expect(Math.min(a1, a2)).toBeLessThanOrEqual(-collabIdCounterCap)
        expect(Math.max(a1, a2)).toBeGreaterThan(-2 * collabIdCounterCap)
        expect(b1).toBeLessThanOrEqual(-2 * collabIdCounterCap)
        expect(b1).toBeGreaterThan(-3 * collabIdCounterCap)
    })

    it('最大前缀与最大计数仍在 int32 范围内，且永不为 0', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(collabIdPrefixMax)
        const first = collabStore.nextCollabId()
        expect(first).toBeGreaterThanOrEqual(-(2 ** 31 - 1))
        expect(first).not.toBe(0)
        expect(Number.isInteger(first!)).toBe(true)
    })

    it('更换前缀后计数器重置', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(1)
        collabStore.nextCollabId()
        collabStore.nextCollabId()
        collabStore.setIdPrefix(5)
        expect(collabStore.nextCollabId()).toBe(-(5 * collabIdCounterCap))
    })

    it('清除前缀后回退到 idIncre 自增', () => {
        const saveStore = useSaveStore()
        const collabStore = useCollabStore()
        saveStore.save = createSave(7)
        collabStore.setIdPrefix(1)
        saveStore.getNewId()
        collabStore.clearIdPrefix()
        expect(saveStore.getNewId()).toBe(7)
    })

    it('非法前缀抛错', () => {
        const collabStore = useCollabStore()
        expect(() => collabStore.setIdPrefix(0)).toThrow()
        expect(() => collabStore.setIdPrefix(-1)).toThrow()
        expect(() => collabStore.setIdPrefix(collabIdPrefixMax + 1)).toThrow()
        expect(() => collabStore.setIdPrefix(1.5)).toThrow()
    })

    it('计数耗尽后抛错', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(1)
        for (let i = 0; i < collabIdCounterCap; i++) {
            collabStore.nextCollabId()
        }
        expect(() => collabStore.nextCollabId()).toThrow()
    })
})
