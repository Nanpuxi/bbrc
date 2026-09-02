/**
 * apiGenerated.ts（NSwag 生成）与 core 侧 aarc-core/models/types/apiShapes.ts（字段子集投影）
 * 之间的编译期兼容性断言（decoupling-step17.md 工作包 A）。
 *
 * 纯类型文件，无运行时代码。后端 DTO 发生影响 core 的形状漂移时，
 * 此处在 type-check 阶段直接报错，而不依赖注入点恰好走到。
 *
 * 方向说明：
 * - AssertAssignableTo<Core, Gen>：生成类型必须可赋给 core 投影（生成 ⊇ 投影），
 *   覆盖 SaveDto（App.vue initSaveInfoProvider）、UserFileDto（UserFileFavorites.vue onFavoriteFileSelected）
 * - AssertAssignableTo<Gen, Core>：core 构造的请求必须可赋给生成类型（投影 ⊆ 生成），
 *   覆盖 PinyinConvertRequest（App.vue initPinyinConvertProvider）
 * - 数值 enum（PinyinCaseType/PinyinVariantType）借 TS number 互赋规则天然兼容，
 *   已随 PinyinConvertRequest 的断言间接覆盖
 */

import type { SaveDto as GenSaveDto, UserFileDto as GenUserFileDto, PinyinConvertRequest as GenPinyinConvertRequest } from "./apiGenerated";
import type { SaveDto as CoreSaveDto, UserFileDto as CoreUserFileDto, PinyinConvertRequest as CorePinyinConvertRequest } from "aarc-core/models/types/apiShapes";

type AssertAssignableTo<Target, Source extends Target> = Source

export type SaveDtoAssert = AssertAssignableTo<CoreSaveDto, GenSaveDto>
export type UserFileDtoAssert = AssertAssignableTo<CoreUserFileDto, GenUserFileDto>
export type PinyinConvertRequestAssert = AssertAssignableTo<GenPinyinConvertRequest, CorePinyinConvertRequest>
