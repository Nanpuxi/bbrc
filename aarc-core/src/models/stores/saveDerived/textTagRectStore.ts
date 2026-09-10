import { defineStore } from "pinia";
import { useKvStoreCore } from "./common/kvStoreCore";
import { Coord, QuadCoord, RectCoord } from "aarc-core/models/coord";
import { toQuadCoord } from "aarc-core/utils/coordUtils/coordRect";

export const useTextTagRectStore = defineStore('textTagRect', () => {
    const { setItem, enumerateItems, clearItems } = useKvStoreCore<{ quad: QuadCoord, anchor: Coord }>()
    function setTextTagRect(id: number, rect: RectCoord | QuadCoord | undefined, center: Coord = [0, 0], angle: number = 0) {
        setItem(id, rect === undefined ? undefined : { quad: toQuadCoord(rect, center, angle), anchor: [...center] })
    }
    return {
        setTextTagRect,
        enumerateTextTagRects: enumerateItems,
        clearItems
    }
})
