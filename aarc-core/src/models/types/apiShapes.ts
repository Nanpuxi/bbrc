/**
 * core 自有的宿主 API 形状声明。
 * 仅保留 core 实际需要读写的字段，是 web 侧 apiGenerated.ts（NSwag 生成）
 * 同名类型的字段子集（投影）；兼容性由 TS 结构化类型在注入/接线点静态验证：
 * - interface：生成类型字段更多，可赋给此处的窄形状；若 core 用到的字段
 *   在后端 DTO 中被删改，App.vue 等注入点会编译报错
 * - 数值 enum：TS 允许 number 与数值 enum 互赋，两份同成员声明天然兼容
 */

/** SaveDto 投影：core 仅在导出文件名中取存档名 */
export interface SaveDto {
    name?: string | undefined;
}

/** UserFileDto 投影：core 仅在收藏取用时取 id、显示名与原图地址（固定链接 url 由宿主另行提供，见 userFileFavoriteStore） */
export interface UserFileDto {
    id?: number | undefined;
    displayName?: string | undefined;
    urlOriginal?: string | undefined;
}

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
    rules?: { [key: string]: string; } | undefined;
    caseType?: PinyinCaseType;
    variantType?: PinyinVariantType;
    spaceBetweenChars?: boolean;
}

export interface PinyinConvertRequest {
    text?: string | undefined;
    options?: PinyinConvertOptions | undefined;
}
