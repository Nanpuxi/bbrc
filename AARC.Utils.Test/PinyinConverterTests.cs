namespace AARC.Utils.Test;

public class PinyinConverterTests
{
    #region MandarinConvert / CantoneseConvert 基础转换

    [Fact]
    public void MandarinConvert_ReturnsBasePinyinWithoutTones()
    {
        Assert.Equal(new[] { "zhong", "guo" }, PinyinConverter.MandarinConvert("中国"));
    }

    [Fact]
    public void MandarinConvert_Polyphonic_UsesLibraryDefault()
    {
        // 重庆 在无上下文词典下按单字默认读音转换
        Assert.Equal(new[] { "zhong", "qing" }, PinyinConverter.MandarinConvert("重庆"));
    }

    [Fact]
    public void CantoneseConvert_ReturnsJyutping()
    {
        Assert.Equal(new[] { "zung", "gwok" }, PinyinConverter.CantoneseConvert("中国"));
    }

    #endregion

    #region CaseType 行为

    [Theory]
    [InlineData(PinyinCaseType.Pascal, "ZhongGuo")]      // 默认：每个字首字母大写后拼接
    [InlineData(PinyinCaseType.AllUpper, "ZHONGGUO")]
    [InlineData(PinyinCaseType.AllLower, "zhongguo")]
    [InlineData(PinyinCaseType.FirstUpper, "Zhongguo")]   // 仅第一段整体 Pascal
    public void Convert_CaseTypes(PinyinCaseType caseType, string expected)
    {
        var options = new PinyinConvertOptions { CaseType = caseType };
        Assert.Equal(expected, PinyinConverter.Convert("中国", options));
    }

    #endregion

    #region SpaceBetweenChars 行为

    [Theory]
    [InlineData(PinyinCaseType.Pascal, "Zhong Guo")]
    [InlineData(PinyinCaseType.AllLower, "zhong guo")]
    public void Convert_SpaceBetweenChars_JoinsPinyinPerChar(PinyinCaseType caseType, string expected)
    {
        var options = new PinyinConvertOptions { CaseType = caseType, SpaceBetweenChars = true };
        Assert.Equal(expected, PinyinConverter.Convert("中国", options));
    }

    #endregion

    #region VariantType 行为

    [Fact]
    public void Convert_Cantonese_Pascal()
    {
        var options = new PinyinConvertOptions { VariantType = PinyinVariantType.Cantonese };
        Assert.Equal("ZungGwok", PinyinConverter.Convert("中国", options));
    }

    [Fact]
    public void Convert_Cantonese_AllLower_Space()
    {
        var options = new PinyinConvertOptions
        {
            VariantType = PinyinVariantType.Cantonese,
            CaseType = PinyinCaseType.AllLower,
            SpaceBetweenChars = true
        };
        Assert.Equal("nei hou", PinyinConverter.Convert("你好", options));
    }

    #endregion

    #region 中英文分段（非中文段 as-is，段间以空格连接）

    [Fact]
    public void Convert_MixedChineseAscii_KeepsNonChineseAsIs()
    {
        var options = new PinyinConvertOptions(); // Pascal
        Assert.Equal("Wo love Ni", PinyinConverter.Convert("我love你", options));
    }

    [Fact]
    public void Convert_AsciiOnly_KeptAsIs()
    {
        Assert.Equal("hello123", PinyinConverter.Convert("hello123", new()));
    }

    [Fact]
    public void Convert_Empty_ReturnsEmpty()
    {
        Assert.Equal("", PinyinConverter.Convert("", new()));
    }

    [Fact]
    public void Convert_FirstUpper_OnlyFirstSegmentCapitalized()
    {
        // 中国(第一段,Pascal) a(非中文,as-is) 人(其后段,lower)
        var options = new PinyinConvertOptions { CaseType = PinyinCaseType.FirstUpper };
        Assert.Equal("Zhongguo a ren", PinyinConverter.Convert("中国a人", options));
    }

    [Fact]
    public void Convert_FirstUpper_NonChineseLeadingSegment_ConsumesFirstSeg()
    {
        // isFirstSeg 在第一个段（含非中文 as-is 段）后即置 false：
        // 首个中文段不再视为第一段，整体小写
        var options = new PinyinConvertOptions { CaseType = PinyinCaseType.FirstUpper };
        Assert.Equal("a zhongguo", PinyinConverter.Convert("a中国", options));
    }

    #endregion

    #region 规则匹配（整词替换，值 as-is）

    [Fact]
    public void Convert_RuleWholePhrase_ReplacedAsIs()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["中国"] = "Middle" } };
        // 我的 中文段转换，中国 命中规则保留原值
        Assert.Equal("WoDe Middle", PinyinConverter.Convert("我的中国", options));
    }

    [Fact]
    public void Convert_RulePerChar_ValuesKeptAsIs()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["中"] = "ZHONG", ["国"] = "GUO2" } };
        Assert.Equal("ZHONG GUO2", PinyinConverter.Convert("中国", options));
    }

    [Fact]
    public void Convert_RuleLongestMatchWins()
    {
        // 长Long 优先于单字，剩余 文 走转换
        var options = new PinyinConvertOptions { Rules = new() { ["长Long"] = "C" } };
        Assert.Equal("C Wen", PinyinConverter.Convert("长Long文", options));
    }

    [Fact]
    public void Convert_RulePlusMandarinRest()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["重"] = "chong" } };
        Assert.Equal("chong Qing", PinyinConverter.Convert("重庆", options));
    }

    #endregion

    #region 规则 Key 的 ^ $ 锚定

    [Fact]
    public void Convert_KeyHeadTail_AtaHeadOnlyMatchesStart()
    {
        // ^老 仅在 cursor==0 命中；大$ 仅在结尾整段相等时命中
        var options = new PinyinConvertOptions { Rules = new() { ["^老"] = "Lao", ["大$"] = "Da" } };
        // 老 命中头部规则；后面 大的人 未在大结尾出现，作为中文段整体转换
        Assert.Equal("Lao DaDeRen", PinyinConverter.Convert("老大的人", options));
    }

    [Fact]
    public void Convert_TailKey_MatchesOnlyAtEnd()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["大$"] = "Da", ["^老"] = "Lao" } };
        Assert.Equal("Ren Da", PinyinConverter.Convert("人大", options));
    }

    [Fact]
    public void Convert_KeyHeadAndTail_RequiresExactWholeText()
    {
        // ^老$ 需同时在头部且整段相等：单字 老 命中，老人 不命中（回退到中文转换）
        var options = new PinyinConvertOptions { Rules = new() { ["^老$"] = "Lao" } };
        Assert.Equal("Lao", PinyinConverter.Convert("老", options));
        Assert.Equal("LaoRen", PinyinConverter.Convert("老人", options));
    }

    #endregion

    #region 规则 Value 的 ^ $ 定位（头/尾段）

    [Fact]
    public void Convert_ValueHeadTailMarkers_RelocateSegments()
    {
        // 中->^Pre 置于头部；国->Post$ 置于尾部
        var options = new PinyinConvertOptions { Rules = new() { ["中"] = "^Pre", ["国"] = "Post$" } };
        // 华 夏 为中文段转换，Pre 前移、Post 后移
        Assert.Equal("Pre Hua Xia Post", PinyinConverter.Convert("华中国夏", options));
    }

    [Fact]
    public void Convert_MultipleHeadValues_AppendInMatchOrder()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["中"] = "^A", ["国"] = "^B" } };
        Assert.Equal("A B", PinyinConverter.Convert("中国", options));
    }

    [Fact]
    public void Convert_ValueMarker_WithSpaceBetweenChars()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["好"] = "x" }, SpaceBetweenChars = true };
        Assert.Equal("Ni x", PinyinConverter.Convert("你好", options));
    }

    #endregion

    #region 规则 Key 边界：空/纯空白键被剔除（防死循环）

    [Fact]
    public void Convert_EmptyOrWhitespaceKeys_Excluded()
    {
        var options = new PinyinConvertOptions { Rules = new() { ["  "] = "SP", [""] = "EMPTY" } };
        // 无有效目标，中国 转换、"  x" 非中文段 as-is，段间空格连接
        Assert.Equal("ZhongGuo   x", PinyinConverter.Convert("中国  x", options));
    }

    #endregion
}
