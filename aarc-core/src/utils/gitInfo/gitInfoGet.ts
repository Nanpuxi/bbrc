import { GitInfo } from "./gitInfo";

// 缓存变量，用于存储第一次获取的数据
let cachedGitInfo: GitInfo | null = null;

/**
 * 获取git信息的函数（实现懒加载功能）
 * @returns Promise<GitInfo | undefined> git信息对象；宿主未提供 gitInfo.json 时返回 undefined
 * @description 该函数会在第一次调用时从/gitInfo.json获取数据并缓存（由宿主在 dev/build 前生成到 public 下），
 * 后续调用直接返回缓存数据，避免重复请求；获取失败时返回 undefined，调用方应隐藏对应 UI
 */
export const getGitInfo = async (): Promise<GitInfo | undefined> => {
  if (cachedGitInfo) {
    return cachedGitInfo;
  }

  try {
    const response = await fetch('/gitInfo.json', {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const gitInfo: GitInfo = await response.json();
    cachedGitInfo = gitInfo;
    return gitInfo;
  } catch {
    return undefined;
  }
};
