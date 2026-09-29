import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { createEmptySave, createLine } from '../../helpers/saveFactory'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useSelectionStore } from 'aarc-core/models/stores/selectionStore'
import { useCvsFrameStore } from 'aarc-core/models/stores/cvsFrameStore'
import { useEditorLocalConfigStore } from 'aarc-core/app/localConfig/editorLocalConfig'
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

describe('selectionStore brush 线路锁定状态处理', () => {
    beforeEach(() => {
        createTestPinia()
        // brush 半径依赖视口尺寸，node 环境下用假 DOM 提供
        useCvsFrameStore().initDoms(
            { clientWidth: 1000, clientHeight: 1000 } as unknown as HTMLDivElement,
            { clientWidth: 1000, clientHeight: 1000 } as unknown as HTMLDivElement,
        )
        const saveStore = useSaveStore()
        saveStore.save = createEmptySave({
            points: [pt(1), pt(2), pt(3), pt(4)],
            lines: [
                createLine([2, 4], { locked: true }),
                createLine([3, 4]),
            ],
        })
    })

    function brushAddAt(c: [number, number]){
        const selectionStore = useSelectionStore()
        selectionStore.mode = 'add'
        selectionStore.setBrushStatus('down')
        selectionStore.brush(c)
    }

    function selectedIds(){
        return [...useSelectionStore().selected].map(s => s.id).sort((a, b) => a - b)
    }

    it('默认“不添加到选区”：锁定线路上的点不被加选，部分锁定的点仍会被加选', () => {
        brushAddAt([25, 25])
        // pt2 仅在锁定线路上（跳过），pt4 所属线路部分锁定（不跳过）
        expect(selectedIds()).toEqual([1, 3, 4])
    })

    it('“可添加到选区”：锁定线路上的点也可被加选', () => {
        useEditorLocalConfigStore().selectionLockedBehavior = 'include'
        brushAddAt([25, 25])
        expect(selectedIds()).toEqual([1, 2, 3, 4])
    })

    it('减选不受锁定过滤影响：锁定点可被刷出选区', () => {
        const saveStore = useSaveStore()
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(2)!)
        selectionStore.mode = 'sub'
        selectionStore.setBrushStatus('down')
        selectionStore.brush([25, 25])
        expect(selectedIds()).toEqual([])
    })
})
