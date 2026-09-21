import { UserFileType } from '@/app/com/apiGenerated';
import { useApiStore } from '@/app/com/apiStore';
import { useOverwriteConfirmStore } from '@/app/globalStores/overwriteConfirmStore';

/** 上传结果：ok 成功；canceled 用户在覆盖确认中取消；failed 失败 */
export type GuardedUserFileUploadResult = 'ok' | 'canceled' | 'failed';

/**
 * 带"同名覆盖"预检的 UserFile 上传（各资源类型通用）：
 * 1. preflight 查当前用户下同类型、同名的资源（api.userFile.findExisting）
 * 2. 若存在，经 OverwriteConfirmPrompt 弹窗展示名称+预览图，等待用户确认
 * 3. 确认则以 overwriteId 覆盖（后端不增删实体，仅替换文件内容）；取消则不发起上传
 */
export async function uploadUserFileGuarded(req: {
    file: Blob;
    fileName: string;
    thumb?: Blob;
    displayName: string;
    intro?: string;
    type: UserFileType;
}): Promise<GuardedUserFileUploadResult> {
    const api = useApiStore();
    let overwriteId: number | undefined;
    try {
        const existing = await api.userFile.findExisting(req.displayName, req.type);
        if (existing) {
            const newThumbUrl = req.thumb ? URL.createObjectURL(req.thumb) : undefined;
            try {
                const ok = await useOverwriteConfirmStore().request([{
                    name: existing.displayName ?? req.displayName,
                    existingThumbUrl: existing.urlThumb ?? undefined,
                    newThumbUrl
                }]);
                if (!ok)
                    return 'canceled';
                overwriteId = existing.id;
            } finally {
                if (newThumbUrl)
                    URL.revokeObjectURL(newThumbUrl);
            }
        }
    } catch (e) {
        console.error('同名资源预检失败', e);
        return 'failed';
    }
    try {
        const res = await api.userFile.upload(
            { data: req.file, fileName: req.fileName },
            req.thumb ? { data: req.thumb, fileName: 'thumb.webp' } : undefined,
            req.displayName,
            req.intro,
            req.type,
            overwriteId
        );
        return res === true ? 'ok' : 'failed';
    } catch (e) {
        console.error('上传失败', e);
        return 'failed';
    }
}
