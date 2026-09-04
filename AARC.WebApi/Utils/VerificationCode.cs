namespace AARC.WebApi.Utils
{
    public static class VerificationCode
    {
        /// <summary>
        /// 生成指定长度的验证码：取GUID的无连字符形式（0-9A-F）的前若干位
        /// </summary>
        public static string Generate(int length)
        {
            if (length < 1 || length > 32)
                throw new ArgumentOutOfRangeException(nameof(length), "验证码长度必须在1-32之间");
            return Guid.NewGuid().ToString("N")[..length].ToUpperInvariant();
        }
    }
}
