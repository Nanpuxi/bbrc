import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { createEmptySave } from '../../helpers/saveFactory'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useSelectionStore } from 'aarc-core/models/stores/selectionStore'
import { ControlPoint, ControlPointSta, SelectionGroup } from 'aarc-core/models/save'

function pt(id: number): ControlPoint {
    return { id, pos: [id * 10, id * 10], dir: 0, sta: ControlPointSta.sta } as ControlPoint
}

// selectionStore 初始化时会 document.addEventListener，node 环境下需要最小桩
beforeAll(() => {
    if(!(globalThis as Record<string, any>).document)
        (globalThis as Record<string, any>).document = {
            addEventListener: () => {},
            removeEventListener: () => {},
        }
})

describe('selectionStore matchedSelectionGroup', () => {
    beforeEach(() => {
        createTestPinia()
    })

    it('组内含死 id 与重复 id（脏数据）时，点击成员整组选中后仍能匹配到该组', async () => {
        const saveStore = useSaveStore()
        const group: SelectionGroup = { id: 100, ptIds: [10, 99, 20, 10], tagIds: [] }
        saveStore.save = createEmptySave({
            points: [pt(10), pt(20), pt(30)],
            selectionGroups: [group],
        })
        const selectionStore = useSelectionStore()

        selectionStore.applyGroups([group])
        // 死 id 99 被跳过，重复 id 10 在 selected 中天然去重
        expect([...selectionStore.selected].map(s => s.id).sort((a, b) => a - b)).toEqual([10, 20])
        expect(selectionStore.matchedSelectionGroup?.id).toBe(100)
    })

    it('selected 中存在组外元素时不应匹配', () => {
        const saveStore = useSaveStore()
        const group: SelectionGroup = { id: 100, ptIds: [10, 20], tagIds: [] }
        saveStore.save = createEmptySave({
            points: [pt(10), pt(20), pt(30)],
            selectionGroups: [group],
        })
        const selectionStore = useSelectionStore()

        selectionStore.applyGroups([group])
        const pt30 = saveStore.getPtById(30)!
        selectionStore.selected.add(pt30)
        expect(selectionStore.matchedSelectionGroup).toBeUndefined()
    })

    it('未选中任何元素时不应匹配', () => {
        const saveStore = useSaveStore()
        const group: SelectionGroup = { id: 100, ptIds: [10], tagIds: [] }
        saveStore.save = createEmptySave({
            points: [pt(10)],
            selectionGroups: [group],
        })
        const selectionStore = useSelectionStore()

        expect(selectionStore.matchedSelectionGroup).toBeUndefined()
        selectionStore.applyGroups([group])
        expect(selectionStore.matchedSelectionGroup?.id).toBe(100)
        selectionStore.clear()
        expect(selectionStore.matchedSelectionGroup).toBeUndefined()
    })

    it('组内含死 tag id 时应与解析后的存活成员匹配', () => {
        const saveStore = useSaveStore()
        const group: SelectionGroup = { id: 100, ptIds: [10], tagIds: [555] }
        saveStore.save = createEmptySave({
            points: [pt(10)],
            selectionGroups: [group],
        })
        const selectionStore = useSelectionStore()

        selectionStore.applyGroups([group])
        expect(selectionStore.matchedSelectionGroup?.id).toBe(100)
    })
})
