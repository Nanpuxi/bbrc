import { defineStore } from "pinia";
import { useKvStoreCore } from "./common/kvStoreCore";
import { Coord, QuadCoord, RectCoord } from "@/models/coord";
import { rotateRectToQuad } from "@/utils/coordUtils/coordRect";

export const useTextTagRectStore = defineStore('textTagRect', () => {
    const { setItem, enumerateItems, clearItems } = useKvStoreCore<QuadCoord>()
    function setTextTagRect(id: number, rect: RectCoord | undefined, center: Coord = [0, 0], angle: number = 0) {
        setItem(id, rect === undefined ? undefined : rotateRectToQuad(rect, center, angle))
    }
    return {
        setTextTagRect,
        enumerateTextTagRects: enumerateItems,
        clearItems
    }
})
