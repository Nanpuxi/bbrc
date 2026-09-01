/**
 * 当前编辑器存档的 id，由宿主（web 的 Editor.vue）从路由参数设置；
 * core 不直接读取 route。
 */

let currentSaveIdRaw: string | undefined

export function setCurrentSaveIdRaw(id: string) {
    currentSaveIdRaw = id
}

/** 当前存档 id 的原始字符串（demo 模式等非数值场景为原样字符串） */
export function getCurrentSaveIdRaw(): string | undefined {
    return currentSaveIdRaw
}

/** 当前存档的数值 id；非数值（如 demo 模式）或未设置时返回 undefined */
export function getCurrentSaveIdNum(): number | undefined {
    const n = parseInt(currentSaveIdRaw ?? '')
    return isNaN(n) ? undefined : n
}
