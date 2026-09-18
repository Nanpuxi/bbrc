import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import { useRemoteRenderScheduler } from 'aarc-core/models/collab/remoteRenderScheduler'

/**
 * 远程 op 驱动的渲染调度测试：
 * 空闲立即渲染 / 活跃期抑制并合并为一次补渲染 / 持续交互不渲染 /
 * renderNow 无视抑制 / 渲染时间戳使持续 op 流天然节流。
 *
 * node 环境无 window，桩出 setTimeout/clearTimeout（与 domStub 同思路）。
 */

const IDLE = 60 // 测试用 idleMs（生产默认 2000）
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

const g = globalThis as Record<string, unknown>

beforeEach(() => {
    createTestPinia()
    g.window = { setTimeout, clearTimeout }
    useRemoteRenderScheduler().timing.idleMs = IDLE
})

afterEach(async () => {
    // 等 pending 定时器收尾，防泄漏到后续用例
    useRemoteRenderScheduler().renderNow()
    await wait(IDLE * 2)
    useRemoteRenderScheduler().timing.idleMs = 2000
    g.window = undefined
})

/** 注入假渲染函数（模拟 dispatcher 注入：渲染后上报时间戳） */
function initFakeRender(reportTimestamp = true) {
    const scheduler = useRemoteRenderScheduler()
    const fn = vi.fn(() => {
        if (reportTimestamp)
            scheduler.notifyMainCvsRenderedNow()
    })
    scheduler.initRemoteRenderScheduler(fn)
    return fn
}

describe('remoteRenderScheduler', () => {
    it('空闲时请求立即渲染', () => {
        const fn = initFakeRender()
        useRemoteRenderScheduler().requestRemoteRender()
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('未注入渲染函数时静默跳过', () => {
        const scheduler = useRemoteRenderScheduler()
        expect(() => {
            scheduler.requestRemoteRender()
            scheduler.renderNow()
        }).not.toThrow()
    })

    it('刚渲染过时抑制请求，合并为一次补渲染', async () => {
        const fn = initFakeRender()
        const scheduler = useRemoteRenderScheduler()
        scheduler.notifyMainCvsRenderedNow()
        scheduler.requestRemoteRender()
        await wait(IDLE / 2)
        scheduler.requestRemoteRender() // 期间重复请求应合并
        expect(fn).not.toHaveBeenCalled()
        await wait(IDLE * 2)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('画布交互中不渲染，静止 idleMs 后补渲染一次', async () => {
        const fn = initFakeRender()
        const scheduler = useRemoteRenderScheduler()
        scheduler.notifyCanvasInteraction()
        scheduler.requestRemoteRender()
        expect(fn).not.toHaveBeenCalled()
        // 交互期结束（不再上报新交互）后，到点补渲染
        await wait(IDLE * 2.5)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('持续交互期间一直不渲染', async () => {
        const fn = initFakeRender()
        const scheduler = useRemoteRenderScheduler()
        for (let i = 0; i < 4; i++) {
            scheduler.notifyCanvasInteraction() // 按住拖动中持续上报
            scheduler.requestRemoteRender()
            await wait(IDLE / 2)
            expect(fn).not.toHaveBeenCalled()
        }
        // 松手静止后补渲染
        await wait(IDLE * 2.5)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('renderNow 无视活跃期抑制立即渲染', async () => {
        const fn = initFakeRender()
        const scheduler = useRemoteRenderScheduler()
        scheduler.notifyCanvasInteraction()
        scheduler.requestRemoteRender()
        expect(fn).not.toHaveBeenCalled()
        scheduler.renderNow()
        expect(fn).toHaveBeenCalledTimes(1)
        // renderNow 已清掉 pending 补渲染定时器，之后不再多渲染
        await wait(IDLE * 2)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('远程渲染刷新时间戳：持续 op 流节流到每 idleMs 一帧', async () => {
        const scheduler = useRemoteRenderScheduler()
        const renderTimes: number[] = []
        scheduler.initRemoteRenderScheduler(() => {
            renderTimes.push(Date.now())
            scheduler.notifyMainCvsRenderedNow()
        })
        const opCount = 7
        scheduler.requestRemoteRender()
        expect(renderTimes.length).toBe(1) // 第一帧立即
        // 对方持续操作：每个 idleMs 内来多条 op，都应被合并
        for (let round = 0; round < 3; round++) {
            scheduler.requestRemoteRender()
            await wait(IDLE / 2)
            scheduler.requestRemoteRender()
            await wait(IDLE)
        }
        await wait(IDLE * 2) // 收尾：最后的补渲染
        // 节流效果：渲染次数远少于 op 条数，且相邻渲染间隔不短于 idleMs
        expect(renderTimes.length).toBeGreaterThanOrEqual(2)
        expect(renderTimes.length).toBeLessThan(opCount)
        for (let i = 1; i < renderTimes.length; i++) {
            expect(renderTimes[i] - renderTimes[i - 1]).toBeGreaterThanOrEqual(IDLE * 0.8)
        }
    })
})
