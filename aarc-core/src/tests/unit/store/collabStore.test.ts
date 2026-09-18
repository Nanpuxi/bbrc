import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useCollabStore, collabIdCounterCap, collabIdPrefixMax, scanCollabIdSeed } from 'aarc-core/models/stores/collabStore'
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

    it('种子参数使计数器从指定值开始', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(3, 5)
        expect(collabStore.nextCollabId()).toBe(-(3 * collabIdCounterCap + 5))
        expect(collabStore.nextCollabId()).toBe(-(3 * collabIdCounterCap + 6))
    })

    it('种子缺省为 0，更换前缀时未传种子也会归零', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(1, 100)
        collabStore.setIdPrefix(2)
        expect(collabStore.nextCollabId()).toBe(-(2 * collabIdCounterCap))
    })

    it('非法种子抛错', () => {
        const collabStore = useCollabStore()
        expect(() => collabStore.setIdPrefix(1, -1)).toThrow()
        expect(() => collabStore.setIdPrefix(1, 1.5)).toThrow()
        expect(() => collabStore.setIdPrefix(1, collabIdCounterCap + 1)).toThrow()
    })

    it('reseedIdCounter 只增不减（重连场景防复用已删除元素的 id）', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(1, 10)
        collabStore.reseedIdCounter(5)   // 小于当前计数：不回退
        expect(collabStore.nextCollabId()).toBe(-(collabIdCounterCap + 10))
        collabStore.reseedIdCounter(20)  // 大于当前计数：前进
        expect(collabStore.nextCollabId()).toBe(-(collabIdCounterCap + 20))
    })

    it('reseedIdCounter 未设前缀或非法种子时抛错', () => {
        const collabStore = useCollabStore()
        expect(() => collabStore.reseedIdCounter(1)).toThrow()
        collabStore.setIdPrefix(1)
        expect(() => collabStore.reseedIdCounter(-1)).toThrow()
        expect(() => collabStore.reseedIdCounter(collabIdCounterCap + 1)).toThrow()
    })

    it('种子等于区间容量时立即耗尽（前缀区间已满，需换前缀）', () => {
        const collabStore = useCollabStore()
        collabStore.setIdPrefix(1, collabIdCounterCap)
        expect(() => collabStore.nextCollabId()).toThrow()
    })
})

describe('scanCollabIdSeed 存档扫描设种子', () => {
    const pid = (prefix: number, counter: number) => -(prefix * collabIdCounterCap + counter)

    it('空存档返回 0', () => {
        expect(scanCollabIdSeed(createSave(), 3)).toBe(0)
    })

    it('命中前缀区间时返回已用最大值 + 1', () => {
        const save = createSave()
        save.points = [
            { id: pid(3, 0) },
            { id: pid(3, 41) },
            { id: pid(3, 7) },
        ] as Save['points']
        expect(scanCollabIdSeed(save, 3)).toBe(42)
    })

    it('扫描覆盖全部带 id 的实体数组', () => {
        const save = createSave()
        save.lines = [{ id: pid(2, 10) }] as Save['lines']
        save.textTags = [{ id: pid(2, 20) }] as Save['textTags']
        save.selectionGroups = [{ id: pid(2, 30) }] as Save['selectionGroups']
        expect(scanCollabIdSeed(save, 2)).toBe(31)
    })

    it('忽略正数 id、其他前缀区间与落在所有区间之外的负 id', () => {
        const save = createSave()
        save.points = [
            { id: 5 },                  // 存量正 id
            { id: pid(4, 99) },         // 其他前缀区间
            { id: -5 },                 // 不在任何合法前缀区间（-5 < collabIdCounterCap）
        ] as Save['points']
        expect(scanCollabIdSeed(save, 3)).toBe(0)
    })

    it('区间填满时返回区间容量', () => {
        const save = createSave()
        save.points = [{ id: pid(1, collabIdCounterCap - 1) }] as Save['points']
        expect(scanCollabIdSeed(save, 1)).toBe(collabIdCounterCap)
    })

    it('扫描结果作为种子可避免与存档残留 id 撞号', () => {
        const saveStore = useSaveStore()
        const collabStore = useCollabStore()
        const save = createSave()
        save.points = [{ id: pid(3, 41) }] as Save['points']
        saveStore.save = save
        collabStore.setIdPrefix(3, scanCollabIdSeed(save, 3))
        expect(saveStore.getNewId()).toBe(pid(3, 42))
    })
})
