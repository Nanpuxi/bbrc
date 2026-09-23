import { defineStore } from "pinia";
import { useKvStoreCore } from "./common/kvStoreCore";
import { Coord, QuadCoord, RectCoord } from "aarc-core/models/coord";
import { toQuadCoord } from "aarc-core/utils/coordUtils/coordRect";

export const useTextTagRectStore = defineStore('textTagRect', () => {
    const { setItem, enumerateItems, clearItems } = useKvStoreCore<{ quad: QuadCoord, anchor: Coord, seq: number }>()
    //每次登记递增，记录渲染先后（后渲染=视觉上更上层），供点击检测取最上层命中
    let seq = 0
    function setTextTagRect(id: number, rect: RectCoord | QuadCoord | undefined, center: Coord = [0, 0], angle: number = 0) {
        setItem(id, rect === undefined ? undefined : { quad: toQuadCoord(rect, center, angle), anchor: [...center], seq: ++seq })
    }
    return {
        setTextTagRect,
        enumerateTextTagRects: enumerateItems,
        clearItems
    }
})
