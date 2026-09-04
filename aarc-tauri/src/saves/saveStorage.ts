// 存档存储适配层（设计见 docs/fs-save-manager.md §3.1/§3.2）
// 对外只暴露统一接口：tauri 环境读写 $APPLOCALDATA/saves/，浏览器 dev 降级为 localStorage 多存档。
// 首次使用时自动迁移旧的单存档键 aarc-tauri-save-local。
import { isTauri } from '@tauri-apps/api/core'
import { BaseDirectory } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'

export interface SaveIndexEntry {
    /** 数值字符串（时间戳+两位随机数），与存档文件名一致；取数值是为兼容 core 的 getCurrentSaveIdNum */
    id: string
    name: string
    createdAt: number
    updatedAt: number
}

interface SaveIndex {
    saves: SaveIndexEntry[]
}

export interface SaveStorage {
    /** 全部存档元数据，按 updatedAt 倒序 */
    list(): Promise<SaveIndexEntry[]>
    /** 读取存档原始 JSON（未 normalize）；不存在时抛错 */
    load(id: string): Promise<unknown>
    /** 新建或覆盖存档，并更新清单 */
    store(id: string, name: string, data: unknown): Promise<void>
    rename(id: string, name: string): Promise<void>
    remove(id: string): Promise<void>
}

/** 生成新存档 id：时间戳 + 两位随机数（纯数值字符串） */
export function newSaveId(): string {
    return String(Date.now()) + String(Math.floor(Math.random() * 100)).padStart(2, '0')
}

const legacyStorageKey = 'aarc-tauri-save-local'

// ---------- tauri fs 实现 ----------

const savesDir = 'saves'
const fsBaseDir = BaseDirectory.AppLocalData
const fsIndexPath = `${savesDir}/index.json`
const fsSavePath = (id: string) => `${savesDir}/${id}.json`
const fsOpts = { baseDir: fsBaseDir }

async function fsEnsureDir(): Promise<void> {
    await mkdir(savesDir, { ...fsOpts, recursive: true })
}

async function fsReadIndex(): Promise<SaveIndex> {
    await fsEnsureDir()
    if (!await exists(fsIndexPath, fsOpts))
        return { saves: [] }
    try {
        const idx = JSON.parse(await readTextFile(fsIndexPath, fsOpts))
        if (idx instanceof Object && idx.saves instanceof Array)
            return idx as SaveIndex
    } catch { /* 落入下方重建 */ }
    console.warn('[存档] index.json 缺失或损坏，已按空清单重建')
    return { saves: [] }
}

async function fsWriteIndex(idx: SaveIndex): Promise<void> {
    await fsEnsureDir()
    await writeTextFile(fsIndexPath, JSON.stringify(idx), fsOpts)
}

const tauriFsSaveStorage: SaveStorage = {
    async list() {
        const idx = await fsReadIndex()
        return idx.saves.sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async load(id) {
        const text = await readTextFile(fsSavePath(id), fsOpts)
        return JSON.parse(text)
    },
    async store(id, name, data) {
        await fsEnsureDir()
        await writeTextFile(fsSavePath(id), JSON.stringify(data ?? {}), fsOpts)
        const idx = await fsReadIndex()
        const entry = idx.saves.find(x => x.id === id)
        if (entry) {
            entry.name = name
            entry.updatedAt = Date.now()
        } else {
            idx.saves.push({ id, name, createdAt: Date.now(), updatedAt: Date.now() })
        }
        await fsWriteIndex(idx)
    },
    async rename(id, name) {
        const idx = await fsReadIndex()
        const entry = idx.saves.find(x => x.id === id)
        if (!entry)
            throw new Error(`存档 ${id} 不存在`)
        entry.name = name
        await fsWriteIndex(idx)
    },
    async remove(id) {
        if (await exists(fsSavePath(id), fsOpts))
            await remove(fsSavePath(id), fsOpts)
        const idx = await fsReadIndex()
        idx.saves = idx.saves.filter(x => x.id !== id)
        await fsWriteIndex(idx)
    }
}

// ---------- 浏览器 localStorage 实现 ----------

const lsIndexKey = 'aarc-tauri-saves-index'
const lsSaveKey = (id: string) => `aarc-tauri-save-${id}`

function lsReadIndex(): SaveIndex {
    try {
        const idx = JSON.parse(localStorage.getItem(lsIndexKey) ?? '')
        if (idx instanceof Object && idx.saves instanceof Array)
            return idx as SaveIndex
    } catch { /* 落入下方重建 */ }
    return { saves: [] }
}

function lsWriteIndex(idx: SaveIndex): void {
    localStorage.setItem(lsIndexKey, JSON.stringify(idx))
}

const browserSaveStorage: SaveStorage = {
    async list() {
        return lsReadIndex().saves.sort((a, b) => b.updatedAt - a.updatedAt)
    },
    async load(id) {
        const text = localStorage.getItem(lsSaveKey(id))
        if (text === null)
            throw new Error(`存档 ${id} 不存在`)
        return JSON.parse(text)
    },
    async store(id, name, data) {
        localStorage.setItem(lsSaveKey(id), JSON.stringify(data ?? {}))
        const idx = lsReadIndex()
        const entry = idx.saves.find(x => x.id === id)
        if (entry) {
            entry.name = name
            entry.updatedAt = Date.now()
        } else {
            idx.saves.push({ id, name, createdAt: Date.now(), updatedAt: Date.now() })
        }
        lsWriteIndex(idx)
    },
    async rename(id, name) {
        const idx = lsReadIndex()
        const entry = idx.saves.find(x => x.id === id)
        if (!entry)
            throw new Error(`存档 ${id} 不存在`)
        entry.name = name
        lsWriteIndex(idx)
    },
    async remove(id) {
        localStorage.removeItem(lsSaveKey(id))
        const idx = lsReadIndex()
        idx.saves = idx.saves.filter(x => x.id !== id)
        lsWriteIndex(idx)
    }
}

// ---------- 公共入口：选实现 + 旧键迁移（只迁移一次） ----------

const impl: SaveStorage = isTauri() ? tauriFsSaveStorage : browserSaveStorage

let migrated: Promise<void> | undefined
function ensureMigrated(): Promise<void> {
    migrated ??= (async () => {
        // 旧版单存档（tauri webview 的 localStorage 与浏览器同源同键），导入为"本地存档"
        const legacy = localStorage.getItem(legacyStorageKey)
        if (legacy === null)
            return
        try {
            await impl.store(newSaveId(), '本地存档', JSON.parse(legacy))
        } catch {
            console.warn('[存档] 旧本地存档损坏，放弃迁移')
        }
        localStorage.removeItem(legacyStorageKey)
    })()
    return migrated
}

export const saveStorage: SaveStorage = {
    async list() {
        await ensureMigrated()
        return impl.list()
    },
    async load(id) {
        await ensureMigrated()
        return impl.load(id)
    },
    async store(id, name, data) {
        await ensureMigrated()
        return impl.store(id, name, data)
    },
    async rename(id, name) {
        await ensureMigrated()
        return impl.rename(id, name)
    },
    async remove(id) {
        await ensureMigrated()
        return impl.remove(id)
    }
}
