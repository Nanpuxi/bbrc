import { defineStore } from "pinia";
import { timestampMS } from "aarc-core/utils/timeUtils/timestamp";

/**
 * 协作远程 op 驱动的渲染调度（4.6）。
 *
 * 背景：主画布渲染在大存档下可达 100ms+ 且在主线程；远程 op 若每条都立即
 * 触发整帧渲染，本地用户拖动/连续操作时会被反复打断（拖动期间主画布本不渲染，
 * 拖动反馈由 activeCvs 覆盖层承担，此时插入整帧渲染纯属额外开销）。
 *
 * 策略（数据应用是即时的，只有渲染被调度）：
 * - 画布按住交互中（拖点/涂抹/平移，由 envStore 上报）不主动渲染
 * - 距上次主画布渲染不足 idleMs 不主动渲染——用户操作引起的渲染会自然带出远程更新
 * - 否则立即渲染；被抑制的请求合并为一次"静止后补渲染"，到点重判（期间可能有新活跃）
 * - 远程渲染同样刷新渲染时间戳：对方持续操作时渲染天然节流到每 idleMs 一帧
 *
 * 渲染函数由 mainCvsDispatcher 注入（宿主无关）；未注入（单测等）时静默跳过。
 */
export const useRemoteRenderScheduler = defineStore('remoteRenderScheduler', () => {
    /** 静止判定阈值：距上次渲染/交互超过该时长才允许同步驱动渲染（单测可调小） */
    const timing = { idleMs: 2000 }

    let renderFn: (() => void) | undefined
    let lastRenderAt = 0       // 最近一次主画布渲染（任何来源，dispatcher 上报）
    let interactingUntil = 0   // 画布按住交互活跃期截止（envStore 上报，随按住移动延展）
    let timer = 0

    function initRemoteRenderScheduler(fn: () => void): void {
        renderFn = fn
    }

    /** 主画布完成一次整帧渲染（dispatcher 在 renderMainCvs 主画布分支调用） */
    function notifyMainCvsRenderedNow(): void {
        lastRenderAt = timestampMS()
    }

    /** 画布按住交互（mousedown/touchstart 及按住期间的移动）：延展活跃期 */
    function notifyCanvasInteraction(): void {
        interactingUntil = timestampMS() + timing.idleMs
    }

    /** 远程 op 已应用到存档，请求一次同步驱动渲染（可能被抑制/合并） */
    function requestRemoteRender(): void {
        if (!renderFn)
            return
        const now = timestampMS()
        const interacting = now < interactingUntil
        const sinceRender = now - lastRenderAt
        if (!interacting && sinceRender >= timing.idleMs) {
            timer && window.clearTimeout(timer)
            timer = 0
            renderFn()
            return
        }
        // 用户活跃中：顺延到静止后补渲染（重复请求合并重置同一个定时器）
        const wait = Math.max(
            interacting ? interactingUntil - now : 0,
            timing.idleMs - sinceRender,
            50)
        if (timer)
            window.clearTimeout(timer)
        timer = window.setTimeout(() => {
            timer = 0
            requestRemoteRender()  // 到点重判
        }, wait)
    }

    /** 立即渲染（快照整档重建等必须马上呈现的场景，无视活跃期抑制） */
    function renderNow(): void {
        timer && window.clearTimeout(timer)
        timer = 0
        renderFn?.()
    }

    return {
        timing,
        initRemoteRenderScheduler,
        notifyMainCvsRenderedNow,
        notifyCanvasInteraction,
        requestRemoteRender,
        renderNow,
    }
})
