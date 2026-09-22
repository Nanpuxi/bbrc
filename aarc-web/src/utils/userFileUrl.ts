/**
 * 生成用户资源的绝对 Content URL（按 uniqueName 解析）。<br/>
 * VITE_ApiUrlBase 缺省时用当前源（同源部署）。<br/>
 * 与 /userfile 静态路径等价，但覆盖上传后仍指向最新内容，适合作为长期分享链接。
 */
export function buildUserFileContentUrl(uniqueName: string): string {
    const base = import.meta.env.VITE_ApiUrlBase || window.location.origin
    return `${base}/api/UserFile/Content?uniqueName=${encodeURIComponent(uniqueName)}`
}
