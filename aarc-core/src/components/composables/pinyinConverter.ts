/**
 * 拼音转换本地实现：移植自后端 AARC.Utils/PinyinConverter.cs。
 * 规格书为 AARC.Utils.Test/PinyinConverterTests.cs（27 个基准用例，
 * 对应 vitest 版 src/tests/unit/pinyinConverter.test.ts）。
 *
 * 词典库（pinyin-pro / to-jyutping）经动态 import 懒加载，避免首屏体积膨胀。
 * 与 EzPinyin 语义对齐：普通话**逐字**取默认读音（非词组感知，"重庆"→zhong qing）；
 * 粤语取无调号 jyutping；ü 记法后处理为 EzPinyin 风格（女→nv、略→lue）。
 */

export enum PinyinCaseType {
    Pascal = 0,
    AllUpper = 1,
    AllLower = 2,
    FirstUpper = 3,
}

export enum PinyinVariantType {
    Mandarin = 0,
    Cantonese = 1,
}

/** "ü"类韵母的写法（以代表性字命名选项：绿=单字ü，略=üe） */
export enum PinyinUStyle {
    /** 绿→lu、略→lue */
    U = 0,
    /** 绿→lü、略→lüe（保留原字母） */
    Umlaut = 1,
    /** 绿→lv、略→lve */
    V = 2,
}

export interface PinyinConvertOptions {
    rules?: { [key: string]: string } | undefined;
    caseType?: PinyinCaseType;
    variantType?: PinyinVariantType;
    spaceBetweenChars?: boolean;
    /** 单字ü的写法；缺省为 V（绿→lv），与旧版 EzPinyin 行为一致 */
    uStyle?: PinyinUStyle;
    /** 韵母üe的写法；缺省为 U（略→lue），与旧版 EzPinyin 行为一致 */
    ueStyle?: PinyinUStyle;
}

/** 与原 Controller 校验一致：超长返回错误标记文本 */
export const PINYIN_CONVERT_MAX_LENGTH = 50

/** 解析配置里的自定义规则文本（每行 "源:目标"） */
export function parsePinyinRules(str?: string): { [key: string]: string } {
    const res: { [key: string]: string } = {}
    for(const line of str?.split('\n') ?? []){
        const kv = line.split(/[:：]/, 2)
        if(kv.length === 2){
            res[kv[0]] = kv[1]
        }
    }
    return res
}

interface PinyinSegment {
    value: string;
    isFromRule: boolean;
    isChinese: boolean;
}

interface PinyinConvertTarget {
    targetRaw: string;
    atHead: boolean;
    atTail: boolean;
    targetText: string;
}

function isChineseChar(c: string): boolean {
    const code = c.charCodeAt(0);
    return (code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF);
}

/** C# ToPascal：首字母大写，其余全部小写 */
function toPascal(s: string): string {
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function buildTargets(rules: { [key: string]: string }): PinyinConvertTarget[] {
    return Object.keys(rules)
        .map(k => k.trim())
        .filter(k => k.length > 0)
        .map(raw => {
            const atHead = raw.startsWith('^');
            const atTail = raw.endsWith('$');
            let text = raw;
            if (atHead) text = text.slice(1);
            if (atTail) text = text.slice(0, -1);
            return { targetRaw: raw, atHead, atTail, targetText: text };
        })
        .sort((a, b) => b.targetRaw.length - a.targetRaw.length);
}

/** 规则切分 + 中文/非中文聚合，逐段移植 SplitToSegments */
function splitToSegments(text: string, rulesRaw: { [key: string]: string } | undefined): PinyinSegment[] {
    const rules: { [key: string]: string } = {};
    if (rulesRaw) {
        for (const [k, v] of Object.entries(rulesRaw)) {
            const key = k.trim();
            if (key.length > 0) rules[key] = v.trim();
        }
    }
    const targets = buildTargets(rules);

    const res: PinyinSegment[] = [];
    const headSegments: PinyinSegment[] = [];
    const tailSegments: PinyinSegment[] = [];

    let cursor = 0;
    let tempRaw = '';
    let tempRawIsChinese = false;
    const flushTempRaw = () => {
        if (tempRaw.length > 0)
            res.push({ value: tempRaw, isFromRule: false, isChinese: tempRawIsChinese });
        tempRaw = '';
    };

    while (cursor < text.length) {
        const sliced = text.slice(cursor);
        let matched: PinyinConvertTarget | undefined;
        for (const tar of targets) {
            // 仅匹配开头的规则，必须 cursor 为 0
            if (tar.atHead && cursor !== 0) continue;
            // 仅匹配结尾的规则，必须剩余部分与目标相同
            if (tar.atTail) {
                if (sliced === tar.targetText) { matched = tar; break; }
            } else {
                if (tar.targetText.length > 0 && sliced.startsWith(tar.targetText)) { matched = tar; break; }
            }
        }
        if (matched) {
            if (tempRaw.length > 0) flushTempRaw();
            let value = rules[matched.targetRaw];
            // 处理值中的 ^ $ 标记：把结果段搬到输出头部/尾部
            const atHead = value.startsWith('^');
            const atTail = value.endsWith('$');
            if (atHead) value = value.slice(1);
            if (atTail) value = value.slice(0, -1);
            const segment: PinyinSegment = { value, isFromRule: true, isChinese: false };
            if (atHead)
                headSegments.push(segment);
            else if (atTail)
                tailSegments.push(segment);
            else
                res.push(segment);
            cursor += matched.targetText.length;
        } else {
            const firstChar = text[cursor];
            const isChn = isChineseChar(firstChar);
            if (isChn !== tempRawIsChinese) {
                flushTempRaw();
                tempRawIsChinese = isChn;
            }
            tempRaw += firstChar;
            cursor++;
        }
    }
    flushTempRaw();
    return [...headSegments, ...res, ...tailSegments];
}

/** "ü"类韵母写法对齐：按 uStyle/ueStyle 设置映射（缺省组合即旧版 EzPinyin 行为：绿→lv、略→lue）。
 *  单次替换同时匹配 üe 与 ü，避免两次 replace 互相污染（如 üe→üe 后又被 ü→v 命中） */
function normalizeMandarinU(s: string, uStyle?: PinyinUStyle, ueStyle?: PinyinUStyle): string {
    const ueMap = ['ue', 'üe', 've'][ueStyle ?? PinyinUStyle.U];
    const uMap = ['u', 'ü', 'v'][uStyle ?? PinyinUStyle.V];
    return s.replace(/üe|ü/g, m => m === 'üe' ? ueMap : uMap);
}

async function convertSegmentToSyllables(seg: string, options: PinyinConvertOptions): Promise<string[]> {
    if (options.variantType === PinyinVariantType.Cantonese) {
        const { getJyutpingList } = await import('to-jyutping');
        return getJyutpingList(seg).map(([, jyut]) => (jyut ?? '').replace(/\d+$/, '')).filter(s => s.length > 0);
    }
    const { pinyin } = await import('pinyin-pro');
    const out: string[] = [];
    // 逐字调用，对齐 EzPinyin 的"单字默认读音"语义（整段调用会词组感知）
    for (const ch of seg) {
        const arr = pinyin(ch, { type: 'array', toneType: 'none' });
        for (const s of arr) {
            if (s) out.push(normalizeMandarinU(s, options.uStyle, options.ueStyle));
        }
    }
    return out;
}

/** 本地拼音转换；text 超长时返回 null（调用方按失败处理） */
export async function convertPinyinLocal(text: string, options: PinyinConvertOptions): Promise<string | null> {
    if (!text || !text.trim()) return '';
    if (text.length > PINYIN_CONVERT_MAX_LENGTH) return null;
    const segs = splitToSegments(text, options.rules);
    const caseType = options.caseType ?? PinyinCaseType.Pascal;
    const segsConverted: string[] = [];
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const isFirstSeg = i === 0;
        if (seg.isFromRule || !seg.isChinese) {
            segsConverted.push(seg.value); //规则段与非中文段 as-is
            continue;
        }
        let arr = await convertSegmentToSyllables(seg.value, options);
        const pascal = caseType === PinyinCaseType.Pascal;
        if (pascal) arr = arr.map(toPascal);
        let segConverted = options.spaceBetweenChars ? arr.join(' ') : arr.join('');
        if (!pascal) {
            switch (caseType) {
                case PinyinCaseType.AllUpper:
                    segConverted = segConverted.toUpperCase();
                    break;
                case PinyinCaseType.AllLower:
                    segConverted = segConverted.toLowerCase();
                    break;
                case PinyinCaseType.FirstUpper:
                    // isFirstSeg 被非中文首段消耗："a中国"→"a zhongguo"
                    segConverted = isFirstSeg ? toPascal(segConverted) : segConverted.toLowerCase();
                    break;
            }
        }
        segsConverted.push(segConverted);
    }
    return segsConverted.join(' ');
}
