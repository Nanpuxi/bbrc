/**
 * 编辑器路由存档 id 编解码（仅展示混淆，不是安全措施，知道算法即可反解）。
 *
 * 支持两种编码模式（env VITE_SaveIdCodeLength 配置，取值 4 或 10，默认 10）：
 * - 10 位：code = base36((A + id × K) mod 36^10)，定长 10 位
 * - 4 位：code = 'a' + base36((A4 + id × K4) mod 36^4)，编码空间约 167 万，
 *   开头固定小写字母 a，整体定长 5 位
 * 只要 K 与模数互质（奇数且不被 3 整除），该映射在 [0, 模数) 上为双射，
 * 解码用 K 的模逆元 Ki 还原：id = Ki × (base36(code) − A) mod 模数。
 *
 * 4 位模式的 a 前缀保证编码结果必含字母，不会与旧版纯数字 URL 混淆；
 * 仅当 id ≥ 36^4（1,679,616）超出编码空间时，编码自动回退 10 位编码
 * （解码端两种格式都识别，解码 4 位模式时 strip 掉开头的 a 再计算）。
 *
 * 旧版 URL 兼容：路由参数为不超过 9 位的纯数字时视为数据库自增 id 直接使用；
 * 新版编码为 a 开头的 5 位或定长 10 位，与旧版不会冲突（若未来自增 id 达到 10 位数，
 * 即 ≥ 1,000,000,000，旧 URL 将无法再被识别为数字 id，届时需调整本规则）。
 */

const MAX_SAVE_ID = 2147483647 // 数据库 int 主键上限

// 10 位模式
const MODULUS_10 = 3656158440062976n // 36^10
const MULTIPLIER_10 = 987654321098765n // K，与 36^10 互质（奇数且不被3整除）
const OFFSET_10 = 2345678901234567n // A，落在编码空间中后段，使小 id 的高位也呈现散乱
const MULTIPLIER_INVERSE_10 = 447110357221061n // Ki = K 在模 36^10 下的逆元

// 4 位模式（编码空间 36^4 = 1,679,616，编码结果加小写 a 前缀，整体定长 5 位）
const MODULUS_4 = 1679616n // 36^4
const MULTIPLIER_4 = 987653n // K4，与 36^4 互质（奇数且不被3整除）
const OFFSET_4 = 234567n // A4，落在编码空间中后段
const MULTIPLIER_INVERSE_4 = 1026509n // Ki4 = K4 在模 36^4 下的逆元
const PREFIX_4 = 'a'

/** 编码长度模式（env VITE_SaveIdCodeLength，仅 4 或 10 有效，默认 10） */
const codeLength = import.meta.env.VITE_SaveIdCodeLength === '4' ? 4 : 10
export const ENCODED_SAVE_ID_LENGTH = codeLength === 4 ? 5 : 10

const legacyNumericPattern = /^\d{1,9}$/
const encodedPattern4 = /^a[0-9a-z]{4}$/i
const encodedPattern10 = /^[0-9A-Z]{10}$/i

/** 使用新版编码URL的最低存档id（env 配置，未配置时默认为1即全部编码） */
const encodeMinId = Number(import.meta.env.VITE_SaveIdEncodeMinId) || 1

/** 该存档id是否应使用新版编码URL（低于阈值时维持旧数字URL） */
export function shouldEncodeSaveId(id: number): boolean {
    return id >= encodeMinId
}

function encodeWith(id: number, modulus: bigint, multiplier: bigint, offset: bigint, length: number): string {
    const value = (offset + BigInt(id) * multiplier) % modulus
    return value.toString(36).toUpperCase().padStart(length, '0')
}

function decodeWith(param: string, modulus: bigint, inverse: bigint, offset: bigint): number {
    const value = BigInt(parseInt(param, 36))
    return Number(((inverse * ((value - offset) % modulus)) % modulus + modulus) % modulus)
}

/**
 * 将数据库自增 id 编码为定长的路由字符串。
 * 4 位模式下输出 'a' + 4 位 base36（整体 5 位），id 超出 36^4 时回退 10 位编码。
 */
export function encodeSaveId(id: number): string {
    if (!Number.isInteger(id) || id < 1 || id > MAX_SAVE_ID)
        throw new Error(`无法编码的存档id: ${id}`)
    if (codeLength === 4 && id < Number(MODULUS_4))
        return PREFIX_4 + encodeWith(id, MODULUS_4, MULTIPLIER_4, OFFSET_4, 4)
    return encodeWith(id, MODULUS_10, MULTIPLIER_10, OFFSET_10, 10)
}

/**
 * 将路由参数解码为数据库自增 id。
 * 旧版纯数字（≤9位）原样返回；a 开头的 5 位（4 位模式）与 10 位编码均可识别
 * （无论当前配置哪种模式）；无法识别或解码结果超出合法 id 范围时返回 undefined。
 */
export function decodeSaveId(param: string): number | undefined {
    if (legacyNumericPattern.test(param))
        return parseInt(param)
    let id: number
    if (encodedPattern4.test(param))
        id = decodeWith(param.slice(1), MODULUS_4, MULTIPLIER_INVERSE_4, OFFSET_4)
    else if (encodedPattern10.test(param))
        id = decodeWith(param, MODULUS_10, MULTIPLIER_INVERSE_10, OFFSET_10)
    else
        return undefined
    if (id < 1 || id > MAX_SAVE_ID)
        return undefined
    return id
}
