import { describe, it, expect, beforeEach } from 'vitest'
import { reactive, ref, nextTick } from 'vue'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { createEmptySave } from '../../helpers/saveFactory'
import { ensureDomStub } from '../../helpers/domStub'
import { useSaveStore } from 'aarc-core/models/stores/saveStore'
import { useSelectionStore } from 'aarc-core/models/stores/selectionStore'
import { useEditorLocalConfigStore } from 'aarc-core/app/localConfig/editorLocalConfig'
import { useSelectionPropSync, suspendSelectionPropSync } from 'aarc-core/models/stores/utils/selectionPropSync'
import { ControlPoint, ControlPointSta, Save, SelectionGroup, TextTag } from 'aarc-core/models/save'

function pt(id: number, extra?: Partial<ControlPoint>): ControlPoint {
    return { id, pos: [id * 10, id * 10], dir: 0, sta: ControlPointSta.sta, ...extra } as ControlPoint
}
function tag(id: number, extra?: Partial<TextTag>): TextTag {
    return { id, pos: [id * 10, id * 10], text: `t${id}`, textS: '', ...extra } as TextTag
}

ensureDomStub()

describe('useSelectionPropSync', () => {
    beforeEach(() => {
        createTestPinia()
    })

    function setup(points: ControlPoint[], textTags: TextTag[] = [], selectionGroups?: SelectionGroup[]) {
        const saveStore = useSaveStore()
        saveStore.save = reactive(createEmptySave({ points, textTags, selectionGroups })) as Save
        return saveStore
    }
    /** 模拟锚点激活：建组合式函数、把目标设为锚点（引用变化分支只重置快照） */
    function beginEditing<T extends ControlPoint | TextTag>(saveStore: ReturnType<typeof useSaveStore>, id: number) {
        const anchor = ref<ControlPoint | TextTag | undefined>()
        useSelectionPropSync(anchor)
        const target = saveStore.getPtById(id) ?? saveStore.getTextTagById(id)
        anchor.value = target
        return anchor as ReturnType<typeof ref<T | undefined>>
    }
    const flush = () => nextTick()

    it('scope=never 时不同步', async () => {
        const saveStore = setup([pt(1), pt(2, { nameSize: 1 }), pt(3, { nameSize: 1 })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        selectionStore.selected.add(saveStore.getPtById(3)!)
        useEditorLocalConfigStore().multiEditSyncScope = 'never'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.nameSize = 2
        await flush()

        expect(saveStore.getPtById(2)!.nameSize).toBe(1)
        expect(saveStore.getPtById(3)!.nameSize).toBe(1)
    })

    it('scope=always + 全部同步：同属性写给所有同类选中元素，异类不受影响', async () => {
        const saveStore = setup(
            [pt(1), pt(2), pt(3)],
            [tag(11)])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        selectionStore.selected.add(saveStore.getPtById(3)!)
        selectionStore.selected.add(saveStore.getTextTagById(11)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.nameSize = 1.5
        await flush()

        expect(saveStore.getPtById(2)!.nameSize).toBe(1.5)
        expect(saveStore.getPtById(3)!.nameSize).toBe(1.5)
        expect(saveStore.getTextTagById(11)!.angle).toBeUndefined()
    })

    it('仅值相同时同步：值不同的同伴不被写入', async () => {
        const saveStore = setup([pt(1), pt(2, { nameSize: 1 }), pt(3, { nameSize: 5 })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        selectionStore.selected.add(saveStore.getPtById(3)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'sameValueOnly'
        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.nameSize = 1 // 旧值 undefined：无人相等，全不写
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBe(1)
        expect(saveStore.getPtById(3)!.nameSize).toBe(5)

        editing.value!.nameSize = 2 // 旧值 1：仅 pt2 被写
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBe(2)
        expect(saveStore.getPtById(3)!.nameSize).toBe(5)
    })

    it('scope=notGroupOnly：选区恰为选区组时不同步，组外混入元素后可同步', async () => {
        const saveStore = setup(
            [pt(1), pt(2), pt(3)],
            [],
            [{ id: 100, ptIds: [1, 2], tagIds: [] }])
        const selectionStore = useSelectionStore()
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'notGroupOnly'
        lc.multiEditSyncValue = 'always'

        selectionStore.applyGroups(saveStore.save!.selectionGroups!)
        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.nameSize = 2
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBeUndefined()

        selectionStore.selected.add(saveStore.getPtById(3)!) // 组外混入，选区不再匹配组
        editing.value!.nameSize = 3
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBe(3)
    })

    it('scope=groupOnly：选区恰为选区组时可同步，组外混入元素后不再同步', async () => {
        const saveStore = setup(
            [pt(1), pt(2), pt(3)],
            [],
            [{ id: 100, ptIds: [1, 2], tagIds: [] }])
        const selectionStore = useSelectionStore()
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'groupOnly'
        lc.multiEditSyncValue = 'always'

        selectionStore.applyGroups(saveStore.save!.selectionGroups!)
        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.nameSize = 2
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBe(2)

        selectionStore.selected.add(saveStore.getPtById(3)!) // 组外混入，选区不再匹配组
        editing.value!.nameSize = 3
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBe(2)
    })

    it('pos 不做属性级同步；nameP 由属性组控制（组默认关闭）', async () => {
        const saveStore = setup([pt(1, { nameP: [1, 1] }), pt(2, { nameP: [2, 2] })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.pos = [99, 99]
        editing.value!.nameP = [99, 99]
        await flush()

        expect(saveStore.getPtById(2)!.pos).toEqual([20, 20])
        expect(saveStore.getPtById(2)!.nameP).toEqual([2, 2]) // 组默认关闭
    })

    it('属性组 pt:namePos：成员默认关闭不同步，全部开启后 anchorX/nameP 联动', async () => {
        const saveStore = setup([pt(1, { nameP: [1, 1] }), pt(2, { nameP: [2, 2] })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.anchorX = -1
        await flush()
        expect(saveStore.getPtById(2)!.anchorX).toBeUndefined() // 成员默认关闭

        lc.multiEditSyncKeys['pt:anchorX'] = true
        lc.multiEditSyncKeys['pt:nameP'] = true
        editing.value!.anchorX = 0
        editing.value!.nameP = [7, 7] // 面板手输坐标
        await flush()
        expect(saveStore.getPtById(2)!.anchorX).toBe(0)
        expect(saveStore.getPtById(2)!.nameP).toEqual([7, 7])
    })

    it('站名拖动：nameP 绝对值同步给选区同伴（包括原本无 nameP 的），最终全部一致', async () => {
        const saveStore = setup([
            pt(1, { nameP: [1, 1] }),
            pt(2, { nameP: [2, 2] }),
            pt(3), // 无 nameP（自动定位）
        ])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        selectionStore.selected.add(saveStore.getPtById(3)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'
        lc.multiEditSyncKeys['pt:nameP'] = true

        // 模拟 envStore 站名拖动：连续改 nameP（无挂起），每帧绝对值广播
        const anchor = ref<ControlPoint | TextTag | undefined>()
        useSelectionPropSync(anchor)
        const target = saveStore.getPtById(1)!
        anchor.value = target
        await flush()
        target.nameP = [10, 10]
        target.nameP = [12, 12]
        await flush()

        expect(saveStore.getPtById(2)!.nameP).toEqual([12, 12])
        expect(saveStore.getPtById(3)!.nameP).toEqual([12, 12]) // 原本无 nameP 的也被设为一致
    })

    it('站名拖动的绝对值同步受配置门槛约束（键关闭/scope=never 不同步）', async () => {
        const saveStore = setup([pt(1, { nameP: [1, 1] }), pt(2, { nameP: [2, 2] })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const anchor = ref<ControlPoint | TextTag | undefined>()
        useSelectionPropSync(anchor)
        const target = saveStore.getPtById(1)!
        anchor.value = target
        await flush()

        // pt:nameP 默认关闭：拖动不同步
        target.nameP = [9, 9]
        await flush()
        expect(saveStore.getPtById(2)!.nameP).toEqual([2, 2])

        lc.multiEditSyncKeys['pt:nameP'] = true
        lc.multiEditSyncScope = 'never'
        target.nameP = [8, 8]
        await flush()
        expect(saveStore.getPtById(2)!.nameP).toEqual([2, 2])

        lc.multiEditSyncScope = 'always'
        target.nameP = [7, 7]
        await flush()
        expect(saveStore.getPtById(2)!.nameP).toEqual([7, 7])
    })

    it('被编辑者不在选区内时不同步', async () => {
        const saveStore = setup([pt(1), pt(2)])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.anchorX = -1
        await flush()

        expect(saveStore.getPtById(2)!.anchorX).toBeUndefined()
    })

    it('startEditing 补默认值（挂起期间）不触发同步', async () => {
        const saveStore = setup([pt(1), pt(2)])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        // 模拟 ControlPointOptions.startEditing：锚点激活后同步补默认值，需挂起同步
        const anchor = ref<ControlPoint | TextTag | undefined>()
        useSelectionPropSync(anchor)
        const target = saveStore.getPtById(1)!
        anchor.value = target
        const resumeSync = suspendSelectionPropSync()
        try{
            target.nameSize = 0
            target.nameP = [5, 5]
        }
        finally{
            resumeSync()
        }
        await flush()

        expect(saveStore.getPtById(2)!.nameSize).toBeUndefined()
        expect(saveStore.getPtById(2)!.nameP).toBeUndefined()
    })

    it('同一手势内先激活后修改（如点击站点同时切换 sta）也会同步', async () => {
        const saveStore = setup([pt(1, { sta: ControlPointSta.sta }), pt(2, { sta: ControlPointSta.sta })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'
        lc.multiEditSyncKeys['pt:sta'] = true

        // 模拟 pureClickHandler：先设激活（锚点引用变化取基线），同一代码块内切换 sta
        const anchor = ref<ControlPoint | TextTag | undefined>()
        useSelectionPropSync(anchor)
        const target = saveStore.getPtById(1)!
        anchor.value = target
        target.sta = ControlPointSta.plain
        await flush()

        expect(saveStore.getPtById(2)!.sta).toBe(ControlPointSta.plain)
    })

    it('TextTag 字体仅同步给 forId 一致的同伴，且写入为深拷贝', async () => {
        const saveStore = setup(
            [],
            [
                tag(1, { forId: 7, textOp: { size: 1, color: '#111111' } }),
                tag(2, { forId: 7, textOp: { size: 1, color: '#111111' } }),
                tag(3, { forId: 8, textOp: { size: 1, color: '#111111' } }),
                tag(4, { textOp: { size: 1, color: '#111111' } }),
            ])
        const selectionStore = useSelectionStore()
        for (const id of [1, 2, 3, 4])
            selectionStore.selected.add(saveStore.getTextTagById(id)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<TextTag>(saveStore, 1)
        await flush()
        editing.value!.textOp!.size = 3
        await flush()

        expect(saveStore.getTextTagById(2)!.textOp!.size).toBe(3)   // 同 forId
        expect(saveStore.getTextTagById(3)!.textOp!.size).toBe(1)   // forId 不同
        expect(saveStore.getTextTagById(4)!.textOp!.size).toBe(1)   // 独立标签

        // 深拷贝：写入的 textOp 与编辑者不是同一引用，之后各自修改互不影响
        expect(saveStore.getTextTagById(2)!.textOp).not.toBe(saveStore.getTextTagById(1)!.textOp)
        editing.value!.textOp!.color = '#999999'
        await flush()
        expect(saveStore.getTextTagById(2)!.textOp!.color).toBe('#999999') // 联动但非共享引用
        saveStore.getTextTagById(2)!.textOp!.color = '#000000'
        expect(saveStore.getTextTagById(1)!.textOp!.color).toBe('#999999')
    })

    it('独立标签（forId 均为 undefined）之间字体可互相同步', async () => {
        const saveStore = setup(
            [],
            [
                tag(1, { textOp: { size: 1, color: '#111111' } }),
                tag(2, { textOp: { size: 1, color: '#111111' } }),
            ])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getTextTagById(1)!)
        selectionStore.selected.add(saveStore.getTextTagById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<TextTag>(saveStore, 1)
        await flush()
        editing.value!.textSOp = { size: 2, color: '#222222' }
        await flush()

        expect(saveStore.getTextTagById(2)!.textSOp).toEqual({ size: 2, color: '#222222' })
        // 非共享引用
        expect(saveStore.getTextTagById(2)!.textSOp).not.toBe(saveStore.getTextTagById(1)!.textSOp)
    })

    it('pinyinConvertPreset 纳入同步', async () => {
        const saveStore = setup([pt(1), pt(2)])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.pinyinConvertPreset = 'presetA'
        await flush()

        expect(saveStore.getPtById(2)!.pinyinConvertPreset).toBe('presetA')
    })

    it('逐键开关：dir 默认不同步，显式开启后同步', async () => {
        const saveStore = setup([pt(1, { dir: 0 }), pt(2, { dir: 0 })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.dir = 1 as ControlPoint['dir']
        await flush()
        expect(saveStore.getPtById(2)!.dir).toBe(0) // 默认关闭

        lc.multiEditSyncKeys['pt:dir'] = true
        editing.value!.dir = 2 as ControlPoint['dir']
        await flush()
        expect(saveStore.getPtById(2)!.dir).toBe(2)
    })

    it('逐键开关：站名默认不同步（覆盖类操作）', async () => {
        const saveStore = setup([pt(1, { name: 'A', nameS: 'a' }), pt(2, { name: 'B', nameS: 'b' })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.name = 'C'
        editing.value!.nameS = 'c'
        await flush()

        expect(saveStore.getPtById(2)!.name).toBe('B')
        expect(saveStore.getPtById(2)!.nameS).toBe('b')

        lc.multiEditSyncKeys['pt:nameS'] = true // 副站名可单独开启
        editing.value!.nameS = 'd'
        await flush()
        expect(saveStore.getPtById(2)!.nameS).toBe('d')
        expect(saveStore.getPtById(2)!.name).toBe('B')
    })

    it('逐键开关：标签文字默认不同步，显式开启后同步', async () => {
        const saveStore = setup([], [tag(1, { text: '一' }), tag(2, { text: '二' })])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getTextTagById(1)!)
        selectionStore.selected.add(saveStore.getTextTagById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<TextTag>(saveStore, 1)
        await flush()
        editing.value!.text = '三'
        await flush()
        expect(saveStore.getTextTagById(2)!.text).toBe('二')

        lc.multiEditSyncKeys['tag:text'] = true
        editing.value!.text = '四'
        await flush()
        expect(saveStore.getTextTagById(2)!.text).toBe('四')
    })

    it('sameValueOnly：0 与 undefined 均表示默认的键（站名尺寸）视为等价', async () => {
        const saveStore = setup([pt(1), pt(2)]) // 两点 nameSize 均为 undefined
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'sameValueOnly'

        // 模拟 startEditing：打开面板的点被补默认值 0（挂起），同伴保持 undefined
        const anchor = ref<ControlPoint | TextTag | undefined>()
        useSelectionPropSync(anchor)
        const target = saveStore.getPtById(1)!
        anchor.value = target
        const resumeSync = suspendSelectionPropSync()
        try{
            target.nameSize = 0
        }
        finally{
            resumeSync()
        }
        await flush()

        target.nameSize = 1.5 // 用户调整尺寸
        await flush()
        expect(saveStore.getPtById(2)!.nameSize).toBe(1.5) // undefined ≡ 0，应同步
    })

    it('sameValueOnly：同伴从未设置 textOp（跟随全局）且旧值 size 为默认时视为等价', async () => {
        const saveStore = setup(
            [],
            [
                tag(1, { textOp: { size: 0, color: '#111111' } }), // 面板打开时补的默认值
                tag(2),                                            // 从未设置 textOp
            ])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getTextTagById(1)!)
        selectionStore.selected.add(saveStore.getTextTagById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'sameValueOnly'

        const editing = beginEditing<TextTag>(saveStore, 1)
        await flush()
        editing.value!.textOp!.size = 2
        await flush()

        // 逐字段同步：只写字号，不替同伴决定颜色
        expect(saveStore.getTextTagById(2)!.textOp).toEqual({ size: 2 })
    })

    it('嵌套对象逐字段同步：只调字号时，同伴颜色不被改写', async () => {
        const saveStore = setup(
            [],
            [
                tag(1, { textOp: { size: 1, color: '#111111' } }),
                tag(2, { textOp: { size: 1, color: '#222222' } }),
                tag(3, { textOp: { size: 5, color: '#222222' } }),
            ])
        const selectionStore = useSelectionStore()
        for (const id of [1, 2, 3])
            selectionStore.selected.add(saveStore.getTextTagById(id)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<TextTag>(saveStore, 1)
        await flush()
        editing.value!.textOp!.size = 3
        await flush()

        // always：无条件写字号；颜色字段未变化，一律不动
        expect(saveStore.getTextTagById(2)!.textOp).toEqual({ size: 3, color: '#222222' })
        expect(saveStore.getTextTagById(3)!.textOp).toEqual({ size: 3, color: '#222222' })

        editing.value!.textOp!.color = '#999999'
        await flush()
        // 颜色字段变化也只同步颜色
        expect(saveStore.getTextTagById(2)!.textOp!.color).toBe('#999999')
        expect(saveStore.getTextTagById(3)!.textOp!.color).toBe('#999999')

        // sameValueOnly：按字段比较——size 相同的被写，不同的不写
        lc.multiEditSyncValue = 'sameValueOnly'
        saveStore.getTextTagById(3)!.textOp!.size = 5 // 同伴号错位（改同伴不触发锚点）
        editing.value!.textOp!.size = 4
        await flush()
        expect(saveStore.getTextTagById(2)!.textOp!.size).toBe(4)   // 旧 size 3 与编辑前一致
        expect(saveStore.getTextTagById(3)!.textOp!.size).toBe(5)   // size 不同，不写
        expect(saveStore.getTextTagById(3)!.textOp!.color).toBe('#999999')
    })

    it('nameCarpet 逐字段同步：只调宽度时，同伴颜色/不透明度不被改写', async () => {
        const saveStore = setup(
            [
                pt(1, { nameCarpet: { width: 1, color: '#aaaaaa', opacity: 0.8 } }),
                pt(2, { nameCarpet: { width: 1, color: '#bbbbbb', opacity: 0.5 } }),
            ])
        const selectionStore = useSelectionStore()
        selectionStore.selected.add(saveStore.getPtById(1)!)
        selectionStore.selected.add(saveStore.getPtById(2)!)
        const lc = useEditorLocalConfigStore()
        lc.multiEditSyncScope = 'always'
        lc.multiEditSyncValue = 'always'

        const editing = beginEditing<ControlPoint>(saveStore, 1)
        await flush()
        editing.value!.nameCarpet!.width = 2
        await flush()
        expect(saveStore.getPtById(2)!.nameCarpet).toEqual({ width: 2, color: '#bbbbbb', opacity: 0.5 })

        editing.value!.nameCarpet!.opacity = 0.9
        await flush()
        expect(saveStore.getPtById(2)!.nameCarpet!.opacity).toBe(0.9)
        expect(saveStore.getPtById(2)!.nameCarpet!.color).toBe('#bbbbbb')
    })
})
