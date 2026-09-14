import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { Save, Line, TimeSlice, ControlPoint } from 'aarc-core/models/save'
import { useConfigStore } from 'aarc-core/models/stores/configStore'
import { nextTick } from 'vue'

function createSave(lines: Line[], timeSlices: TimeSlice[] = []): Save {
    return {
        idIncre: 1,
        points: [],
        lines,
        textTags: [],
        cvsSize: [1000, 1000],
        config: {},
        meta: {},
        timeSlices,
    } as Save
}

describe('saveStore linePtsChanged watch', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('修改线路 pts 应触发 linePtsChanged 回调', async () => {
        const saveStore = useSaveStore()
        const line: Line = { id: 1, pts: [10, 20, 30], name: '', nameSub: '', color: '', type: 0 } as Line
        saveStore.save = createSave([line])

        // 等待 watch 初次触发，记录快照
        await nextTick()

        const changedLineIds: number[][] = []
        saveStore.linePtsChanged = (ids: number[]) => {
            changedLineIds.push(ids)
        }

        // 修改 pts（需要触发 save 的响应式更新）
        saveStore.save.lines[0].pts.push(40)
        await nextTick()

        expect(changedLineIds).toHaveLength(1)
        expect(changedLineIds[0]).toEqual([1])
    })

    it('未修改 pts 不应触发回调', async () => {
        const saveStore = useSaveStore()
        const line: Line = { id: 1, pts: [10, 20, 30], name: '', nameSub: '', color: '', type: 0 } as Line
        saveStore.save = createSave([line])

        await nextTick()

        const changedLineIds: number[][] = []
        saveStore.linePtsChanged = (ids: number[]) => {
            changedLineIds.push(ids)
        }

        // 不修改任何东西
        await nextTick()

        expect(changedLineIds).toHaveLength(0)
    })

    it('修改线路其他属性（如 name）不应触发回调', async () => {
        const saveStore = useSaveStore()
        const line: Line = { id: 1, pts: [10, 20, 30], name: '', nameSub: '', color: '', type: 0 } as Line
        saveStore.save = createSave([line])

        await nextTick()

        const changedLineIds: number[][] = []
        saveStore.linePtsChanged = (ids: number[]) => {
            changedLineIds.push(ids)
        }

        line.name = '新名称'
        await nextTick()

        expect(changedLineIds).toHaveLength(0)
    })

    it('新增线路不应触发回调', async () => {
        const saveStore = useSaveStore()
        const line1: Line = { id: 1, pts: [10, 20], name: '', nameSub: '', color: '', type: 0 } as Line
        saveStore.save = createSave([line1])

        await nextTick()

        const changedLineIds: number[][] = []
        saveStore.linePtsChanged = (ids: number[]) => {
            changedLineIds.push(ids)
        }

        const line2: Line = { id: 2, pts: [30, 40], name: '', nameSub: '', color: '', type: 0 } as Line
        saveStore.save.lines.push(line2)
        await nextTick()

        expect(changedLineIds).toHaveLength(0)
    })

    it('删除线路不应触发回调', async () => {
        const saveStore = useSaveStore()
        const line1: Line = { id: 1, pts: [10, 20], name: '', nameSub: '', color: '', type: 0 } as Line
        const line2: Line = { id: 2, pts: [30, 40], name: '', nameSub: '', color: '', type: 0 } as Line
        saveStore.save = createSave([line1, line2])

        await nextTick()

        const changedLineIds: number[][] = []
        saveStore.linePtsChanged = (ids: number[]) => {
            changedLineIds.push(ids)
        }

        saveStore.save.lines.splice(1, 1)
        await nextTick()

        expect(changedLineIds).toHaveLength(0)
    })
})

describe('saveStore getLinesDecidedPtNameSSize', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    function createPt(id: number): ControlPoint {
        return { id, pos: [0, 0], dir: 0, sta: 1 } as ControlPoint
    }

    it('线路 ptNameSSize > 0 时优先于线宽映射', () => {
        const saveStore = useSaveStore()
        const configStore = useConfigStore()
        configStore.config.lineWidthMapped = { '2': { staNameSSize: 0.8 } }
        saveStore.save = createSave([
            { id: 1, pts: [10], name: '', nameSub: '', color: '', type: 0, width: 2, ptNameSSize: 0.5 } as Line
        ])
        saveStore.save.points = [createPt(10)]

        expect(saveStore.getLinesDecidedPtNameSSize(10)).toBe(0.5)
    })

    it('线路未设置时回退到 lineWidthMapped[width].staNameSSize', () => {
        const saveStore = useSaveStore()
        const configStore = useConfigStore()
        configStore.config.lineWidthMapped = { '2': { staNameSSize: 0.8 } }
        saveStore.save = createSave([
            { id: 1, pts: [10], name: '', nameSub: '', color: '', type: 0, width: 2 } as Line
        ])
        saveStore.save.points = [createPt(10)]

        expect(saveStore.getLinesDecidedPtNameSSize(10)).toBe(0.8)
    })

    it('各级来源均未设置时返回 0（不做 width/默认值兜底）', () => {
        const saveStore = useSaveStore()
        saveStore.save = createSave([
            { id: 1, pts: [10], name: '', nameSub: '', color: '', type: 0, width: 2, ptNameSize: 3 } as Line
        ])
        saveStore.save.points = [createPt(10)]

        expect(saveStore.getLinesDecidedPtNameSSize(10)).toBe(0)
    })

    it('多条线路取最大值，未设置的线路按 0 参与', () => {
        const saveStore = useSaveStore()
        saveStore.save = createSave([
            { id: 1, pts: [10], name: '', nameSub: '', color: '', type: 0, ptNameSSize: 0.6 } as Line,
            { id: 2, pts: [10], name: '', nameSub: '', color: '', type: 0, width: 5 } as Line
        ])
        saveStore.save.points = [createPt(10)]

        expect(saveStore.getLinesDecidedPtNameSSize(10)).toBe(0.6)
    })

    it('无线路的点返回 0', () => {
        const saveStore = useSaveStore()
        saveStore.save = createSave([])
        saveStore.save.points = [createPt(10)]

        expect(saveStore.getLinesDecidedPtNameSSize(10)).toBe(0)
    })
})
