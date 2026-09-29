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

export interface PinyinConvertOptions {
    rules?: { [key: string]: string } | undefined;
    caseType?: PinyinCaseType;
    variantType?: PinyinVariantType;
    spaceBetweenChars?: boolean;
}

/** 与原 Controller 校验一致：超长返回错误标记文本 */
export const PINYIN_CONVERT_MAX_LENGTH = 50

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

/** EzPinyin 记法对齐：üe→ue、ü→v */
function normalizeMandarinU(s: string): string {
    return s.replace(/ü(?=e)/g, 'u').replace(/ü/g, 'v');
}

async function convertSegmentToSyllables(seg: string, variant: PinyinVariantType): Promise<string[]> {
    if (variant === PinyinVariantType.Cantonese) {
        const { getJyutpingList } = await import('to-jyutping');
        return getJyutpingList(seg).map(([, jyut]) => (jyut ?? '').replace(/\d+$/, '')).filter(s => s.length > 0);
    }
    const { pinyin } = await import('pinyin-pro');
    const out: string[] = [];
    // 逐字调用，对齐 EzPinyin 的"单字默认读音"语义（整段调用会词组感知）
    for (const ch of seg) {
        const arr = pinyin(ch, { type: 'array', toneType: 'none' });
        for (const s of arr) {
            if (s) out.push(normalizeMandarinU(s));
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
    const variantType = options.variantType ?? PinyinVariantType.Mandarin;
    const segsConverted: string[] = [];
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const isFirstSeg = i === 0;
        if (seg.isFromRule || !seg.isChinese) {
            segsConverted.push(seg.value); //规则段与非中文段 as-is
            continue;
        }
        let arr = await convertSegmentToSyllables(seg.value, variantType);
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
