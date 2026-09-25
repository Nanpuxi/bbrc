import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(fileURLToPath(import.meta.url))
const licenseSrc = join(packageDir, '..', 'LICENSE.txt')
const publicDir = join(packageDir, 'public')

if (!existsSync(licenseSrc)) {
    console.error(`[prebuild] 未找到 LICENSE.txt：${licenseSrc}`)
    process.exit(1)
}
mkdirSync(publicDir, { recursive: true })
copyFileSync(licenseSrc, join(publicDir, 'LICENSE.txt'))
