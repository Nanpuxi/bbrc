/**
 * 移植自 AARC.Utils.Test/PinyinConverterTests.cs（后端实现保留作参照）。
 * 预期值基于本地库实测：pinyin-pro 逐字读音、to-jyutping 去调号，
 * 与 EzPinyin/Jyutping 语义对齐（无声调、非词组感知、ü→v/üe→ue）。
 */
import { describe, expect, it } from 'vitest';
import {
    convertPinyinLocal,
    PinyinCaseType,
    PinyinVariantType,
    PINYIN_CONVERT_MAX_LENGTH,
} from 'aarc-core/components/composables/pinyinConverter';

const mandarinConvert = async (s: string) =>
    (await convertPinyinLocal(s, { caseType: PinyinCaseType.AllLower, spaceBetweenChars: true }))!.split(' ');
const cantoneseConvert = async (s: string) =>
    (await convertPinyinLocal(s, {
        variantType: PinyinVariantType.Cantonese,
        caseType: PinyinCaseType.AllLower,
        spaceBetweenChars: true,
    }))!.split(' ');

describe('基础转换', () => {
    it('逐字无声调', async () => {
        expect(await mandarinConvert('中国')).toEqual(['zhong', 'guo']);
    });
    it('多音字取单字默认读音（非词组感知）', async () => {
        expect(await mandarinConvert('重庆')).toEqual(['zhong', 'qing']);
    });
    it('粤语返回无调号 jyutping', async () => {
        expect(await cantoneseConvert('中国')).toEqual(['zung', 'gwok']);
    });
    it('ü 记法对齐 EzPinyin（女→nv、略→lue、虐→nue）', async () => {
        expect(await mandarinConvert('女略虐')).toEqual(['nv', 'lue', 'nue']);
    });
});

describe('CaseType 行为', () => {
    it.each([
        [PinyinCaseType.Pascal, 'ZhongGuo'],
        [PinyinCaseType.AllUpper, 'ZHONGGUO'],
        [PinyinCaseType.AllLower, 'zhongguo'],
        [PinyinCaseType.FirstUpper, 'Zhongguo'],
    ])('中国 → %s', async (caseType, expected) => {
        expect(await convertPinyinLocal('中国', { caseType })).toBe(expected);
    });
});

describe('SpaceBetweenChars 行为', () => {
    it('Pascal + 字间空格', async () => {
        expect(await convertPinyinLocal('中国', { caseType: PinyinCaseType.Pascal, spaceBetweenChars: true })).toBe('Zhong Guo');
    });
    it('AllLower + 字间空格', async () => {
        expect(await convertPinyinLocal('中国', { caseType: PinyinCaseType.AllLower, spaceBetweenChars: true })).toBe('zhong guo');
    });
});

describe('VariantType 行为', () => {
    it('粤语默认 Pascal', async () => {
        expect(await convertPinyinLocal('中国', { variantType: PinyinVariantType.Cantonese })).toBe('ZungGwok');
    });
    it('粤语 AllLower + 字间空格', async () => {
        expect(await convertPinyinLocal('你好', {
            variantType: PinyinVariantType.Cantonese,
            caseType: PinyinCaseType.AllLower,
            spaceBetweenChars: true,
        })).toBe('nei hou');
    });
});

describe('中英文分段', () => {
    it('非中文段 as-is，段间空格连接', async () => {
        expect(await convertPinyinLocal('我love你', {})).toBe('Wo love Ni');
    });
    it('纯 ASCII as-is', async () => {
        expect(await convertPinyinLocal('hello123', {})).toBe('hello123');
    });
    it('空串返回空串', async () => {
        expect(await convertPinyinLocal('', {})).toBe('');
    });
    it('FirstUpper 仅第一段大写', async () => {
        // 中国(第一段,Pascal) a(非中文,as-is) 人(其后段,lower)
        expect(await convertPinyinLocal('中国a人', { caseType: PinyinCaseType.FirstUpper })).toBe('Zhongguo a ren');
    });
    it('FirstUpper 非中文首段消耗 isFirstSeg', async () => {
        // "a中国" 首个中文段不再视为第一段，整体小写
        expect(await convertPinyinLocal('a中国', { caseType: PinyinCaseType.FirstUpper })).toBe('a zhongguo');
    });
});

describe('规则匹配', () => {
    it('整词命中 as-is', async () => {
        expect(await convertPinyinLocal('我的中国', { rules: { '中国': 'Middle' } })).toBe('WoDe Middle');
    });
    it('逐字规则值 as-is', async () => {
        expect(await convertPinyinLocal('中国', { rules: { '中': 'ZHONG', '国': 'GUO2' } })).toBe('ZHONG GUO2');
    });
    it('最长匹配优先', async () => {
        expect(await convertPinyinLocal('长Long文', { rules: { '长Long': 'C' } })).toBe('C Wen');
    });
    it('规则 + 其余中文转换', async () => {
        expect(await convertPinyinLocal('重庆', { rules: { '重': 'chong' } })).toBe('chong Qing');
    });
});

describe('规则 Key 的 ^ $ 锚定', () => {
    it('^ 仅开头、$ 仅结尾整段相等', async () => {
        // 老 命中头部规则；大的人 未在结尾整体匹配 大$，作为中文段整体转换
        expect(await convertPinyinLocal('老大的人', { rules: { '^老': 'Lao', '大$': 'Da' } })).toBe('Lao DaDeRen');
    });
    it('$ 仅在结尾命中', async () => {
        expect(await convertPinyinLocal('人大', { rules: { '大$': 'Da', '^老': 'Lao' } })).toBe('Ren Da');
    });
    it('^x$ 需全串相等', async () => {
        expect(await convertPinyinLocal('老', { rules: { '^老$': 'Lao' } })).toBe('Lao');
        expect(await convertPinyinLocal('老人', { rules: { '^老$': 'Lao' } })).toBe('LaoRen');
    });
});

describe('规则 Value 的 ^ $ 定位', () => {
    it('头/尾段搬移', async () => {
        expect(await convertPinyinLocal('华中国夏', { rules: { '中': '^Pre', '国': 'Post$' } })).toBe('Pre Hua Xia Post');
    });
    it('多个头部值按命中顺序排列', async () => {
        expect(await convertPinyinLocal('中国', { rules: { '中': '^A', '国': '^B' } })).toBe('A B');
    });
    it('规则段与字间空格共存', async () => {
        expect(await convertPinyinLocal('你好', { rules: { '好': 'x' }, spaceBetweenChars: true })).toBe('Ni x');
    });
});

describe('规则 Key 边界', () => {
    it('空/纯空白键被剔除（防死循环）', async () => {
        // 无有效目标，中国 转换、"  x" 非中文段 as-is，段间空格连接
        expect(await convertPinyinLocal('中国  x', { rules: { '  ': 'SP', '': 'EMPTY' } })).toBe('ZhongGuo   x');
    });
});

describe('长度校验（原 Controller 侧）', () => {
    it('超长返回 null', async () => {
        const long = '中'.repeat(PINYIN_CONVERT_MAX_LENGTH + 1);
        expect(await convertPinyinLocal(long, {})).toBeNull();
    });
    it('恰好 50 字不超长', async () => {
        expect(await convertPinyinLocal('中'.repeat(PINYIN_CONVERT_MAX_LENGTH), {})).not.toBeNull();
    });
});
