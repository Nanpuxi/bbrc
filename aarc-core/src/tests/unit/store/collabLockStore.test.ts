import { describe, it, expect, beforeEach } from 'vitest'
import { createTestPinia } from '../../helpers/piniaTestHelper'
import {
  useCollabLockStore,
  collabLockKey,
  collabLockKeyOf,
  parseCollabLockKey
} from 'aarc-core/models/stores/collabLockStore'
import { createPoint, createLine, resetIdCounter } from '../../helpers/saveFactory'
import { ControlPoint, TextTag } from 'aarc-core/models/save'

describe('collabLockStore', () => {
  beforeEach(() => {
    resetIdCounter()
    createTestPinia()
  })

  it('锁键带类型前缀，可解析还原', () => {
    expect(collabLockKey('pt', 5)).toBe('pt:5')
    expect(collabLockKey('line', -3)).toBe('line:-3')
    expect(parseCollabLockKey('pt:5')).toEqual({ type: 'pt', id: 5 })
    expect(parseCollabLockKey('line:-3')).toEqual({ type: 'line', id: -3 })
    expect(parseCollabLockKey('tag:7')).toEqual({ type: 'tag', id: 7 })
    expect(parseCollabLockKey('bad')).toBeUndefined()
    expect(parseCollabLockKey('pt:abc')).toBeUndefined()
  })

  it('collabLockKeyOf 按对象结构判别类型', () => {
    expect(collabLockKeyOf(createPoint(5))).toBe('pt:5')
    expect(collabLockKeyOf(createLine([1, 2], { id: 9 }))).toBe('line:9')
    expect(collabLockKeyOf({ id: 7, pos: [0, 0] } as TextTag)).toBe('tag:7')
  })

  it('乐观加锁与释放，触发传输层挂钩', () => {
    const store = useCollabLockStore()
    const req: string[] = []
    const rel: string[] = []
    store.lockRequestHandler = k => req.push(k)
    store.lockReleaseHandler = k => rel.push(k)

    expect(store.acquireMine('pt:1')).toBe(true)
    expect(store.myLocks.has('pt:1')).toBe(true)
    // 重复加锁不重复通知
    expect(store.acquireMine('pt:1')).toBe(true)
    expect(req).toEqual(['pt:1'])

    store.releaseMine('pt:1')
    expect(store.myLocks.has('pt:1')).toBe(false)
    expect(rel).toEqual(['pt:1'])
    // 释放未持有的锁不通知
    store.releaseMine('pt:1')
    expect(rel).toEqual(['pt:1'])
  })

  it('被他人锁定的对象无法加锁', () => {
    const store = useCollabLockStore()
    store.applyRemoteLock('pt:1', 'userB')
    expect(store.isLockedByOther('pt:1')).toBe(true)
    expect(store.otherLockHolder('pt:1')).toBe('userB')
    expect(store.acquireMine('pt:1')).toBe(false)
    expect(store.myLocks.has('pt:1')).toBe(false)
  })

  it('applyRemoteLock 与我的锁冲突时返回 true（仲裁败方）', () => {
    const store = useCollabLockStore()
    store.acquireMine('pt:1')
    expect(store.applyRemoteLock('pt:1', 'userB')).toBe(true)
    expect(store.applyRemoteLock('pt:2', 'userB')).toBe(false)
  })

  it('releaseMineExcept 释放不在保留集合中的锁', () => {
    const store = useCollabLockStore()
    store.acquireMine('pt:1')
    store.acquireMine('pt:2')
    store.acquireMine('tag:3')
    store.releaseMineExcept(new Set(['pt:2']))
    expect([...store.myLocks]).toEqual(['pt:2'])
  })

  it('applyRemoteUnlock 与 clearLocksOfHolder', () => {
    const store = useCollabLockStore()
    store.applyRemoteLock('pt:1', 'userB')
    store.applyRemoteLock('pt:2', 'userB')
    store.applyRemoteLock('tag:1', 'userC')
    store.applyRemoteUnlock('pt:1')
    expect(store.isLockedByOther('pt:1')).toBe(false)
    store.clearLocksOfHolder('userB')
    expect(store.isLockedByOther('pt:2')).toBe(false)
    expect(store.isLockedByOther('tag:1')).toBe(true)
  })

  it('pruneOtherLocks 清理指向已删除对象的锁', () => {
    const store = useCollabLockStore()
    store.applyRemoteLock('pt:1', 'userB')
    store.applyRemoteLock('pt:2', 'userB')
    store.applyRemoteLock('bad-key', 'userB')
    store.pruneOtherLocks((type, id) => type === 'pt' && id === 1)
    expect(store.isLockedByOther('pt:1')).toBe(true)
    expect(store.isLockedByOther('pt:2')).toBe(false)
    expect(store.isLockedByOther('bad-key')).toBe(false)
  })

  it('clearAllLocks 清空双方锁状态', () => {
    const store = useCollabLockStore()
    store.acquireMine('pt:1')
    store.applyRemoteLock('pt:2', 'userB')
    store.clearAllLocks()
    expect(store.myLocks.size).toBe(0)
    expect(store.hasOtherLocks).toBe(false)
  })

  it('加锁时登记快照（深拷贝），释放时丢弃', () => {
    const store = useCollabLockStore()
    const pt = createPoint(1)
    store.acquireMine('pt:1', pt)
    const snap = store.peekSnapshot('pt:1') as ControlPoint | undefined
    expect(snap).toEqual(pt)
    expect(snap).not.toBe(pt) // 深拷贝，非同一引用
    // 快照登记后原对象的改动不影响快照
    pt.pos = [999, 999]
    expect((store.peekSnapshot('pt:1') as ControlPoint)?.pos).toEqual([10, 10])

    store.releaseMine('pt:1')
    expect(store.peekSnapshot('pt:1')).toBeUndefined()
  })

  it('已持有同键锁的重复加锁不覆盖既有快照', () => {
    const store = useCollabLockStore()
    const pt = createPoint(1)
    store.acquireMine('pt:1', pt)
    pt.pos = [500, 500]
    store.acquireMine('pt:1', pt) // 重复加锁，快照应保持最初登记值
    expect((store.peekSnapshot('pt:1') as ControlPoint)?.pos).toEqual([10, 10])
  })

  it('clearAllLocks 一并清空快照', () => {
    const store = useCollabLockStore()
    store.acquireMine('pt:1', createPoint(1))
    store.clearAllLocks()
    expect(store.peekSnapshot('pt:1')).toBeUndefined()
  })
})
