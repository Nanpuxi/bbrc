import { describe, it, expect } from 'vitest'
import { summarizeSaveDiff } from 'aarc-core/models/collab/opSummary'
import { SaveDiff } from 'aarc-core/models/save/saveDiff'
import { Save } from 'aarc-core/models/save'

function mkSave(partial: Partial<Save> = {}): Save {
    return {
        idIncre: 100,
        points: [],
        lines: [],
        textTags: [],
        cvsSize: [1000, 1000],
        config: {},
        meta: {},
        ...partial,
    } as Save
}

const pt = (id: number, sta: number, name?: string) => ({ id, pos: [0, 0], dir: 0, sta, name })

describe('summarizeSaveDiff 协作 op 概括', () => {
    it('$add：单个带名元素引用名称，多个用数量', () => {
        expect(summarizeSaveDiff({ points: { $add: [pt(1, 1, '新宿')] } } as SaveDiff, mkSave()))
            .toBe('新增了车站「新宿」')
        expect(summarizeSaveDiff({ points: { $add: [pt(1, 0), pt(2, 0), pt(3, 0)] } } as SaveDiff, mkSave()))
            .toBe('新增了 3 个控制点')
    })

    it('points 按 sta 细分车站/控制点', () => {
        expect(summarizeSaveDiff({ points: { $add: [pt(1, 1), pt(2, 0)] } } as SaveDiff, mkSave()))
            .toBe('新增了 1 个车站、新增了 1 个控制点')
    })

    it('$rm/$upd 的名称在应用前查（旧名），查不到则用数量', () => {
        const save = mkSave({
            lines: [
                { id: 1, name: '山手线', nameSub: '', pts: [], color: '#f00', type: 0 },
                { id: 2, name: '中央线', pts: [], color: '#00f', type: 0 },
            ],
        } as Partial<Save>)
        expect(summarizeSaveDiff({ lines: { $rm: [1] } } as SaveDiff, save)).toBe('删除了线路「山手线」')
        expect(summarizeSaveDiff({ lines: { $rm: [1, 2] } } as SaveDiff, save)).toBe('删除了 2 个线路')
        // 改名：引用应用前的旧名
        expect(summarizeSaveDiff({ lines: { $upd: [{ id: 1, name: '新名' }] } } as SaveDiff, save))
            .toBe('修改了线路「山手线」')
        // 目标已不存在（他人先删）/ save 未知：退化为数量
        expect(summarizeSaveDiff({ lines: { $upd: [{ id: 99, name: 'x' }] } } as SaveDiff, save)).toBe('修改了 1 个线路')
        expect(summarizeSaveDiff({ lines: { $rm: [1] } } as SaveDiff, null)).toBe('删除了 1 个线路')
    })

    it('$seq 仅纯重排时概括为调整顺序；与增删改同时出现则不重复描述', () => {
        expect(summarizeSaveDiff({ lines: { $seq: [2, 1] } } as SaveDiff, mkSave())).toBe('调整了线路的顺序')
        expect(summarizeSaveDiff({ points: { $seq: [1] } } as SaveDiff, mkSave())).toBe('调整了点的顺序')
        expect(summarizeSaveDiff({ lines: { $add: [{ id: 3, name: '新线' }], $seq: [3, 1] } } as SaveDiff, mkSave()))
            .toBe('新增了线路「新线」')
    })

    it('textTags 无 name，用 text 截断展示', () => {
        expect(summarizeSaveDiff({ textTags: { $add: [{ id: 7, pos: [0, 0], text: '短注' }] } } as SaveDiff, mkSave()))
            .toBe('新增了文本标签「短注」')
        expect(summarizeSaveDiff({ textTags: { $add: [{ id: 7, pos: [0, 0], text: '这是一段很长的文本标签内容啊' }] } } as SaveDiff, mkSave()))
            .toBe('新增了文本标签「这是一段很长的文本标签内…」')
        expect(summarizeSaveDiff({ textTags: { $add: [{ id: 7, pos: [0, 0] }] } } as SaveDiff, mkSave()))
            .toBe('新增了 1 个文本标签')
    })

    it('整组 $set 与递归对象各有专名', () => {
        expect(summarizeSaveDiff({ pointLinks: { $set: [] } } as SaveDiff, mkSave())).toBe('修改了点间连线')
        expect(summarizeSaveDiff({ cvsSize: { $set: [800, 600] } } as SaveDiff, mkSave())).toBe('调整了画布尺寸')
        expect(summarizeSaveDiff({ config: { title: { $set: 'x' } } } as SaveDiff, mkSave())).toBe('修改了全局配置')
        expect(summarizeSaveDiff({ meta: { collabEnabled: { $set: false } } } as SaveDiff, mkSave())).toBe('修改了存档设置')
    })

    it('忽略 idIncre；只剩它时兜底', () => {
        expect(summarizeSaveDiff({ idIncre: { $set: 101 } } as SaveDiff, mkSave())).toBe('进行了编辑')
        expect(summarizeSaveDiff({ idIncre: { $set: 101 }, lines: { $add: [{ id: 9, name: '丸之内线' }] } } as SaveDiff, mkSave()))
            .toBe('新增了线路「丸之内线」')
    })

    it('无法识别的 key 兜底且只出现一次', () => {
        expect(summarizeSaveDiff({ weird: { $set: 1 }, other: { a: { $set: 2 } }, unknownArr: { $rm: [1] } } as SaveDiff, mkSave()))
            .toBe('进行了编辑')
    })

    it('多个顶层 key 的片段用「、」拼接', () => {
        const save = mkSave({ lines: [{ id: 1, name: '山手线', nameSub: '', pts: [], color: '#f00', type: 0 }] } as Partial<Save>)
        const diff: SaveDiff = {
            points: { $add: [pt(1, 1, '新宿')] },
            lines: { $rm: [1] },
            idIncre: { $set: 102 },
        }
        expect(summarizeSaveDiff(diff, save)).toBe('新增了车站「新宿」、删除了线路「山手线」')
    })
})
