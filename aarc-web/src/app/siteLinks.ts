/** 站点内链接，由宿主注入（web 用 router.resolve 生成 href）；不注入则对应链接隐藏 */
export interface SiteLinks {
    about?: string
    forkAarc?: string
}

let siteLinks: SiteLinks = {}

export function initSiteLinks(links: SiteLinks) {
    siteLinks = links
}

export function getSiteLinks(): SiteLinks {
    return siteLinks
}
