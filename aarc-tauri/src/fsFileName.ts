// 文件名片段清洗：存档名等用户输入直接进文件名时，Windows/安卓都会拒绝部分字符，
// 而系统对话框的构建失败在 JS 侧不可见（见 fileSaver.ts 的说明），故在宿主边界统一清洗。
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g
// Windows 不接受以点或空格结尾的名字
const TRAILING_DOTS_SPACES = /[ .]+$/
// Windows 保留设备名，带扩展名也非法（如 CON.png）
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.[^.]*)?$/i
// 超出长度后拼接扩展名容易顶到 MAX_PATH，留足余量
const MAX_LEN = 100

/**
 * 把任意名字清洗为单个合法文件名片段（不含路径）：非法字符→下划线、去结尾点/空格、限长。
 * 结果为空或撞保留名时退回 fallback。
 */
export function safeFileNamePart(name: string, fallback: string): string {
    const safe = name.replace(ILLEGAL_CHARS, '_').slice(0, MAX_LEN).replace(TRAILING_DOTS_SPACES, '')
    return safe && !RESERVED_NAME.test(safe) ? safe : fallback
}
