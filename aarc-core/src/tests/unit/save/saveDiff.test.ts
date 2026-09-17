import { describe, it, expect } from 'vitest'
import { diffSave, applySaveDiff, KeyedArrDiff, DiffSet } from 'aarc-core/models/save/saveDiff'
import { Save, ControlPoint, ControlPointDir, ControlPointSta, Line } from 'aarc-core/models/save'
import { createEmptySave } from '../../helpers/saveFactory'
import rfdc from 'rfdc'

const clone = rfdc()

function makePt(id: number, x = id * 10, name?: string): ControlPoint {
    return { id, pos: [x, x], dir: ControlPointDir.vertical, sta: ControlPointSta.sta, name }
}

function makeLine(id: number, pts: number[]): Line {
    return { id, pts, name: `线${id}`, nameSub: '', color: '#f00', type: 0 } as Line
}

/** diff → JSON 序列化往返 → apply，模拟网络传输路径 */
function roundTrip(save: object, diff: object) {
    applySaveDiff(save, JSON.parse(JSON.stringify(diff)))
}

describe('diffSave 生成', () => {
    it('无变化时返回 null', () => {
        const a = createEmptySave()
        const b = clone(a)
        expect(diffSave(a, b)).toBeNull()
    })

    it('标量属性变化产生 $set', () => {
        const a = createEmptySave()
        const b = clone(a)
        b.idIncre = 1001
        const diff = diffSave(a, b)
        expect(diff).toEqual({ idIncre: { $set: 1001 } })
    })

    it('属性被删除产生 $del', () => {
        const a = createEmptySave({ pointLinks: [{ pts: [1, 2], type: 0 }] })
        const b = createEmptySave()
        const diff = diffSave(a, b)
        expect(diff).toEqual({ pointLinks: { $del: true } })
    })

    it('新增属性产生 $set', () => {
        const a = createEmptySave()
        const b = createEmptySave({ pointLinks: [{ pts: [1, 2], type: 0 }] })
        const diff = diffSave(a, b)
        expect(diff).toEqual({ pointLinks: { $set: [{ pts: [1, 2], type: 0 }] } })
    })

    it('keyed 数组：新增元素进 $add（完整元素）', () => {
        const a = createEmptySave({ points: [makePt(1)] })
        const b = createEmptySave({ points: [makePt(1), makePt(2, 20, '新站')] })
        const diff = diffSave(a, b)
        const points = diff!.points as KeyedArrDiff
        expect(points.$add).toEqual([makePt(2, 20, '新站')])
        expect(points.$rm).toBeUndefined()
        expect(points.$upd).toBeUndefined()
        expect(points.$seq).toBeUndefined() // 纯尾部追加不产生 $seq
    })

    it('keyed 数组：删除元素进 $rm（仅 id）', () => {
        const a = createEmptySave({ points: [makePt(1), makePt(2)] })
        const b = createEmptySave({ points: [makePt(2)] })
        const diff = diffSave(a, b)
        const points = diff!.points as KeyedArrDiff
        expect(points.$rm).toEqual([1])
        expect(points.$seq).toBeUndefined()
    })

    it('keyed 数组：元素属性变化进 $upd，且仅含变化的属性', () => {
        const a = createEmptySave({ points: [makePt(1, 10, '甲'), makePt(2)] })
        const b = createEmptySave({ points: [makePt(1, 10, '甲'), makePt(2)] })
        b.points[1].pos = [99, 98]
        const diff = diffSave(a, b)
        const points = diff!.points as KeyedArrDiff
        expect(points.$upd).toEqual([{ id: 2, pos: [99, 98] }])
    })

    it('keyed 数组：元素属性被删除时 $upd 带 $del（站名 disposal 场景）', () => {
        const a = createEmptySave({ points: [makePt(1, 10, '甲')] })
        a.points[0].nameS = 'A'
        const b = clone(a)
        delete b.points[0].name
        delete b.points[0].nameS
        const diff = diffSave(a, b)
        const points = diff!.points as KeyedArrDiff
        expect(points.$upd).toEqual([{ id: 1, $del: ['name', 'nameS'] }])
    })

    it('keyed 数组：顺序变化产生 $seq（新完整 id 顺序）', () => {
        const a = createEmptySave({ lines: [makeLine(1, []), makeLine(2, []), makeLine(3, [])] })
        const b = createEmptySave({ lines: [makeLine(3, []), makeLine(1, []), makeLine(2, [])] })
        const diff = diffSave(a, b)
        const lines = diff!.lines as KeyedArrDiff
        expect(lines.$seq).toEqual([3, 1, 2])
        expect(lines.$upd).toBeUndefined()
    })

    it('keyed 数组：中部插入同时产生 $add 和 $seq', () => {
        const a = createEmptySave({ lines: [makeLine(1, []), makeLine(2, [])] })
        const b = createEmptySave({ lines: [makeLine(1, []), makeLine(9, []), makeLine(2, [])] })
        const diff = diffSave(a, b)
        const lines = diff!.lines as KeyedArrDiff
        expect(lines.$add).toEqual([makeLine(9, [])])
        expect(lines.$seq).toEqual([1, 9, 2])
    })

    it('无 id 数组（pointLinks）原子 $set 整体替换', () => {
        const a = createEmptySave({ pointLinks: [{ pts: [1, 2], type: 0 }] })
        const b = createEmptySave({ pointLinks: [{ pts: [1, 2], type: 0 }, { pts: [3, 4], type: 0 }] })
        const diff = diffSave(a, b)
        expect(diff).toEqual({ pointLinks: { $set: [{ pts: [1, 2], type: 0 }, { pts: [3, 4], type: 0 }] } })
    })

    it('空数组与非空数组之间回退为原子 $set', () => {
        const a = createEmptySave()
        const b = createEmptySave({ points: [makePt(1)] })
        const diff = diffSave(a, b)
        expect(diff).toEqual({ points: { $set: [makePt(1)] } })
    })

    it('嵌套普通对象递归 diff，只含变化的键', () => {
        const a = createEmptySave()
        a.config = { bgColor: '#000' } as Save['config']
        const b = clone(a)
        ;(b.config as Record<string, unknown>).bgColor = '#fff'
        const diff = diffSave(a, b)
        expect(diff).toEqual({ config: { bgColor: { $set: '#fff' } } })
    })

    it('id 重复的数组回退为原子 $set（防御）', () => {
        const a = createEmptySave({ points: [makePt(1), makePt(1)] })
        const b = createEmptySave({ points: [makePt(1), makePt(1, 99)] })
        const diff = diffSave(a, b)
        expect((diff!.points as DiffSet).$set).toBeDefined()
    })
})

describe('applySaveDiff 应用', () => {
    it('round-trip：apply(a, diff(a,b)) 深等于 b（综合场景）', () => {
        const a = createEmptySave({
            points: [makePt(1, 10, '甲'), makePt(2), makePt(3)],
            lines: [makeLine(11, [1, 2]), makeLine(12, [2, 3])],
            textTags: [{ id: 21, pos: [0, 0], text: '标签' }],
            pointLinks: [{ pts: [1, 2], type: 0 }],
        })
        a.config = { bgColor: '#000' } as Save['config']
        const b = clone(a)
        // 点：改位置、删站名、删一个点、加一个点
        b.points[0].pos = [15, 16]
        delete b.points[1].name
        b.points.splice(2, 1)
        b.points.push(makePt(4, 40, '新'))
        // 线：重排 + 改属性
        b.lines.reverse()
        b.lines[1].color = '#0f0'
        // 标签：移动
        b.textTags[0].pos = [5, 5]
        // pointLinks：整体变化
        b.pointLinks = []
        // 嵌套配置
        ;(b.config as Record<string, unknown>).bgColor = '#fff'
        b.idIncre = 2000

        const applied = clone(a)
        roundTrip(applied, diffSave(a, b)!)
        expect(applied).toEqual(b)
    })

    it('应用时保持已有元素的对象引用（activePt/selected 不失效）', () => {
        const a = createEmptySave({ points: [makePt(1), makePt(2)] })
        const target = clone(a)
        const ptRef = target.points[0]
        const b = clone(a)
        b.points[0].pos = [99, 99]
        b.points.push(makePt(3))
        applySaveDiff(target, diffSave(a, b)!)
        expect(target.points[0]).toBe(ptRef)
        expect(ptRef.pos).toEqual([99, 99])
        expect(target.points.map(p => p.id)).toEqual([1, 2, 3])
    })

    it('幂等：重复应用同一 diff 结果一致', () => {
        const a = createEmptySave({ points: [makePt(1)], lines: [makeLine(11, [1])] })
        const b = clone(a)
        b.points.push(makePt(2))
        b.lines[0].name = '改名'
        const diff = diffSave(a, b)!
        const target = clone(a)
        applySaveDiff(target, diff)
        applySaveDiff(target, clone(diff))
        expect(target).toEqual(b)
    })

    it('$seq 重排在应用侧生效', () => {
        const a = createEmptySave({ lines: [makeLine(1, []), makeLine(2, []), makeLine(3, [])] })
        const target = clone(a)
        applySaveDiff(target, { lines: { $seq: [3, 1, 2] } })
        expect(target.lines.map(l => l.id)).toEqual([3, 1, 2])
        expect(target.lines[0].name).toBe('线3') // 元素本体未被替换
    })

    it('$seq 序列外的元素保持相对顺序置于末尾（乱序/基线不一致的防御）', () => {
        const target = createEmptySave({ lines: [makeLine(1, []), makeLine(2, []), makeLine(9, [])] })
        applySaveDiff(target, { lines: { $seq: [2, 1] } })
        expect(target.lines.map(l => l.id)).toEqual([2, 1, 9])
    })

    it('$upd 目标元素已不存在时跳过不报错（LWW 容忍）', () => {
        const target = createEmptySave({ points: [makePt(1)] })
        applySaveDiff(target, { points: { $upd: [{ id: 99, pos: [1, 1] }] } })
        expect(target.points).toHaveLength(1)
    })

    it('$add 目标 id 已存在时跳过（重复投递防御）', () => {
        const target = createEmptySave({ points: [makePt(1, 10, '旧')] })
        applySaveDiff(target, { points: { $add: [makePt(1, 99, '新')] } })
        expect(target.points).toHaveLength(1)
        expect(target.points[0].name).toBe('旧')
    })

    it('$del 删除顶层属性', () => {
        const target = createEmptySave({ pointLinks: [{ pts: [1, 2], type: 0 }] })
        applySaveDiff(target, { pointLinks: { $del: true } })
        expect('pointLinks' in target).toBe(false)
    })

    it('目标属性不是数组时先重建为空数组再应用（防御）', () => {
        const target = createEmptySave()
        delete (target as unknown as Record<string, unknown>).points
        applySaveDiff(target, { points: { $add: [makePt(1)] } })
        expect(target.points.map(p => p.id)).toEqual([1])
    })

    it('diff 经 JSON 序列化往返后 apply 结果不变（含 $del 属性删除）', () => {
        const a = createEmptySave({ points: [makePt(1, 10, '甲')] })
        const b = clone(a)
        delete b.points[0].name
        const diff = diffSave(a, b)!
        const target = clone(a)
        roundTrip(target, diff)
        expect(target).toEqual(b)
        expect('name' in target.points[0]).toBe(false)
    })
})
