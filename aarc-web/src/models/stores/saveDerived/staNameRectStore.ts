import { RectCoord, Coord, QuadCoord } from "@/models/coord";
import { defineStore } from "pinia";
import { useKvStoreCore } from "./common/kvStoreCore";
import { toQuadCoord } from "@/utils/coordUtils/coordRect";

export const useStaNameRectStore = defineStore('staNameRect', () => {
    const { getItem, setItem, enumerateItems, clearItems } = useKvStoreCore<QuadCoord>()
    function setStaNameRect(key: number, rect: RectCoord | QuadCoord | undefined, center: Coord = [0, 0], angle: number = 0) {
        setItem(key, rect === undefined ? undefined : toQuadCoord(rect, center, angle))
        if (rect === undefined) {
            useStaNameMainRectStore().setStaNameMainRect(key, undefined)
        }
    }
    return {
        getStaNameRect: getItem,
        setStaNameRect,
        enumerateStaNameRects: enumerateItems,
        clearItems
    }
})

export const useStaNameMainRectStore = defineStore('staNameMainRect', () => {
    const { getItem, setItem, enumerateItems, clearItems } = useKvStoreCore<QuadCoord>()
    function setStaNameMainRect(key: number, rect: RectCoord | QuadCoord | undefined, center: Coord = [0, 0], angle: number = 0) {
        setItem(key, rect === undefined ? undefined : toQuadCoord(rect, center, angle))
    }
    return {
        getStaNameMainRect: getItem,
        setStaNameMainRect,
        enumerateStaNameMainRects: enumerateItems,
        clearItems
    }
})
