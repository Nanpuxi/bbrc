/**
 * 编辑器路由存档 id 编解码（仅展示混淆，不是安全措施，知道算法即可反解）。
 *
 * 编码：code = base36((A + id × K) mod 36^10)，左侧补 '0' 至固定 10 位（字符集 0-9A-Z）。
 * 只要 K 与 36^10 互质（奇数且不被 3 整除），该映射在 [0, 36^10) 上为双射，
 * 解码用 K 的模逆元 Ki 还原：id = Ki × (base36(code) − A) mod 36^10。
 *
 * 旧版 URL 兼容：路由参数为不超过 9 位的纯数字时视为数据库自增 id 直接使用；
 * 新版编码固定 10 位，二者不会冲突（若未来自增 id 达到 10 位数，即 ≥ 1,000,000,000，
 * 旧 URL 将无法再被识别为数字 id，届时需调整本规则）。
 */

const MODULUS = 3656158440062976n // 36^10
const MULTIPLIER = 987654321098765n // K，与 36^10 互质（奇数且不被3整除）
const OFFSET = 2345678901234567n // A，落在编码空间中后段，使小 id 的高位也呈现散乱
const MULTIPLIER_INVERSE = 447110357221061n // Ki = K 在模 36^10 下的逆元
const MAX_SAVE_ID = 2147483647 // 数据库 int 主键上限
export const ENCODED_SAVE_ID_LENGTH = 10

const legacyNumericPattern = /^\d{1,9}$/
const encodedPattern = /^[0-9A-Z]{10}$/i

/** 使用新版编码URL的最低存档id（env 配置，未配置时默认为1即全部编码） */
const encodeMinId = Number(import.meta.env.VITE_SaveIdEncodeMinId) || 1

/** 该存档id是否应使用新版编码URL（低于阈值时维持旧数字URL） */
export function shouldEncodeSaveId(id: number): boolean {
    return id >= encodeMinId
}

/** 将数据库自增 id 编码为定长 10 位的路由字符串（0-9A-Z） */
export function encodeSaveId(id: number): string {
    if (!Number.isInteger(id) || id < 1 || id > MAX_SAVE_ID)
        throw new Error(`无法编码的存档id: ${id}`)
    const value = (OFFSET + BigInt(id) * MULTIPLIER) % MODULUS
    return value.toString(36).toUpperCase().padStart(ENCODED_SAVE_ID_LENGTH, '0')
}

/**
 * 将路由参数解码为数据库自增 id。
 * 旧版纯数字（≤9位）原样返回；新版 10 位编码做仿射解码；
 * 无法识别或解码结果超出合法 id 范围时返回 undefined。
 */
export function decodeSaveId(param: string): number | undefined {
    if (legacyNumericPattern.test(param))
        return parseInt(param)
    if (!encodedPattern.test(param))
        return undefined
    const value = BigInt(parseInt(param, 36))
    const id = Number(((MULTIPLIER_INVERSE * ((value - OFFSET) % MODULUS)) % MODULUS + MODULUS) % MODULUS)
    if (id < 1 || id > MAX_SAVE_ID)
        return undefined
    return id
}
