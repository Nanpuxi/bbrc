// 生成 public/gitInfo.json（分支/提交/贡献者/构建时间），供 core 的 EtcConfig 底部展示。
// 对齐 aarc-web 的 src/utils/gitInfo/gitInfoGen.ts；dev/build 前自动运行（见 package.json scripts）。
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cwd, exit } from 'node:process'

if (!existsSync(join(cwd(), 'package.json'))) {
    console.error('请在项目根目录运行本脚本')
    exit(1)
}

const resPath = join(cwd(), 'public', 'gitInfo.json')

function getBuiltAt() {
    const d = new Date()
    return `${d.toLocaleDateString('zh-Hans')} ${d.toLocaleTimeString('zh-Hans')}`
}

function git(args) {
    return execFileSync('git', args, { encoding: 'utf-8' }).trim()
}

function writeGitInfo(resObj) {
    console.log(resObj)
    writeFileSync(resPath, JSON.stringify(resObj, undefined, 4))
}

function writeFallbackGitInfo() {
    const resObj = {
        branchName: 'unknown',
        commitId: 'unknown',
        contributors: [],
        builtAt: getBuiltAt()
    }
    console.log('未检测到 Git 环境，使用兜底信息：', resObj)
    writeFileSync(resPath, JSON.stringify(resObj, undefined, 4))
}

try {
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true')
        throw new Error('not a git work tree')

    const branchName = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    // 获取当前HEAD的提交ID（8个16进制字符）
    const commitId = git(['rev-parse', '--short=8', 'HEAD'])
    const authors = git(['log', '--pretty=format:%an']).split('\n')

    const contributingCount = {}
    for (const a of authors) {
        contributingCount[a] ??= 0
        contributingCount[a] += 1
    }
    const contributors = Object.entries(contributingCount)
        .map(([name, count]) => ({ name, count }))
        .sort((x, y) => y.count - x.count)

    writeGitInfo({ branchName, commitId, contributors, builtAt: getBuiltAt() })
} catch (ex) {
    console.error('获取 Git 信息失败：', ex)
    writeFallbackGitInfo()
}
