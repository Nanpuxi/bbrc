# 拼音转换：现状与本地化改造方案

> 范围：本文档只涉及 **aarc-core 与 aarc-web**。后端（`AARC.WebApi` / `AARC.Utils`）暂不处理，HTTP 端点在下线前保持现状可用。

## 一、现状

### 调用链

```
NameEdit.vue / TextTagEdit.vue（转换按钮）
  └─ usePinyinConvert(source, dest, afterDone)     aarc-core/src/components/composables/usePinyinConvert.ts
       ├─ 二次点击确认/覆盖逻辑（core 内）
       ├─ 读取 config.pinyinConvert（规则/大小写/变体/字间空格，config.ts:126）
       └─ 调用宿主注入的 PinyinConvertProvider（纯 HTTP 包装）
            └─ web: App.vue:37 → api.saveUtils.pinyinConvert(req)
                 → POST {apiUrlBase}/api/SaveUtils/PinyinConvert（无鉴权，限长 50 字）
                 → AARC.WebApi/Utils/PinyinConverter.cs（规则切分 + EzPinyin 普通话 / Jyutping 粤语）
```

### core 侧的 provider 适配层（改造后删除）

- `usePinyinConvert.ts`：`PinyinConvertProvider` 类型、`initPinyinConvertProvider`、`hasPinyinConvertProvider`。
- `app/hostServices.ts`：`pinyinConvert?: PinyinConvertProvider` 字段（唯一的"纯计算型"宿主服务）。
- 三处注入门控：`NameEdit.vue:20`、`TextTagEdit.vue:29`、`PinyinConvertConfig.vue:11`——未注入时转换按钮与"站名拼音转换"配置区隐藏。
- `models/types/apiShapes.ts`：`PinyinConvertRequest`/`PinyinConvertOptions`（`PinyinCaseType`/`PinyinVariantType` 枚举仍被配置 UI 使用，需保留或迁移）。
- web 侧接线：`App.vue:37` 注入、`apiShapesAssert.ts:24` 的 `PinyinConvertRequestAssert` 静态断言。

### 后端转换语义（即 core 本地化后必须复刻的行为）

`PinyinConverter.Convert`：

1. **规则切分**（`SplitToSegments`）：规则 Key 支持 `^`（仅开头匹配）、`$`（仅结尾匹配）、`^x$`（全串相等）；按 Key 长度降序最长匹配；Key/Value 去空白、空 Key 剔除（防死循环）；Value 支持 `^`/`$` 前缀/后缀把结果段搬到输出头部/尾部；命中规则的值 as-is；其余字符按"是否中文"（`\u4E00-\u9FFF`、`\u3400-\u4DBF`）聚合成段。
2. **中文段转换**：普通话 EzPinyin **逐字默认读音**（无声调、非词组感知，如"重庆"→zhong qing）；粤语 Jyutping `CanTone.Style.NORMAL`（无调号）。
3. **大小写/拼接**：Pascal 逐字首大写；AllUpper/AllLower 整段转换；FirstUpper 仅第一个段 Pascal（注意：`isFirstSeg` 被非中文首段消耗，"a中国"→"a zhongguo"）；`SpaceBetweenChars` 控制逐字空格；段间一律以空格连接。
4. `ü` 记法：EzPinyin 输出 `nv`（女）但 `lue`（略），即 `ü`→`v`、`üe`→`ue`。

该行为的 27 个 xunit 基准用例在 `AARC.Utils.Test/PinyinConverterTests.cs`（含注释说明各边界语义），是移植时的规格书。

## 二、本地库实测结论（已验证）

候选库（当前装在 aarc-tauri，评估通过后迁入 aarc-core dependencies）：

| 项 | pinyin-pro（普通话） | to-jyutping（粤语） |
|---|---|---|
| 调用 | `pinyin(seg, { type:'array', toneType:'none' })` | `getJyutpingList(seg)` → `[字, 粤拼\|null][]`，去末尾数字 |
| 词组感知 | **是**，整段调用会分词（"重庆"→chong qing），与 EzPinyin 逐字语义不符；**须逐字调用**（"重"→zhong，对齐） | 逐字，对齐 |
| 粤语调号 | — | 带调号（zung1），正则去数字后与 C# 无调号输出一致 |
| `ü` | 默认 `nü`/`lüe`；后处理 `ü(?=e)`→`u`、`ü`→`v` 后与 EzPinyin 完全一致（女→nv、略→lue、虐→nue，已实测） | — |
| 体积（dist 全量） | ~0.9M | ~1.3M |

残余差异：两库"单字最常用音"词频表不同，极少数生僻多音字选音可能与 EzPinyin 不同（常见字已抽样全部对齐）；粤语多音节合字（如"瓩"）C# 只取首音节，本地库返回完整，可截断对齐亦可忽略。

## 三、改造方案

### 原则

- 拼音转换不再是宿主服务：core 自包含实现，web/tauri/未来宿主零接线、行为一致、离线可用。
- **词典懒加载**：`pinyin-pro`/`to-jyutping` 必须经 `await import()` 在首次转换时加载（vite 自动切异步 chunk）。否则 web 首屏将白增约 400–500K gzip。provider 签名本就是 Promise，天然契合。
- 50 字上限原本在 Controller 校验，本地化后需在 core 侧补同样校验。

### 改动清单

**aarc-core**

1. `package.json` 增加 `pinyin-pro`、`to-jyutping` 依赖。
2. 新建 `src/components/composables/pinyinConverter.ts`：移植 `SplitToSegments` 切分逻辑 + 大小写/拼接规则（逐字调用 pinyin-pro，粤语走 to-jyutping 并去调号，含 `ü` 后处理与 50 字校验），导出 `convertPinyinLocal(text, options): Promise<string>`。
3. `usePinyinConvert.ts`：删除 provider 相关定义，`convertPinyin` 直接调用本地实现；保留 `convertPinyin`/`pinyinOverriding` 对外签名不变（`useTwinTextarea`、两个编辑组件无需改动调用方式）。
4. 删除 `hasPinyinConvertProvider()` 及 `NameEdit.vue`/`TextTagEdit.vue`/`PinyinConvertConfig.vue` 的注入门控（转换按钮与配置区改为常显）。
5. `app/hostServices.ts`：删除 `pinyinConvert` 字段及对应 init。
6. `models/types/apiShapes.ts`：删除 `PinyinConvertRequest`/`PinyinConvertOptions`；`PinyinCaseType`/`PinyinVariantType` 移至 `pinyinConverter.ts`（或 config.ts）导出，更新 `PinyinConvertConfig.vue` 引用。
7. 测试：把 `PinyinConverterTests.cs` 的 27 个用例移植为 vitest（`src/tests/` 下新建 `pinyinConverter.spec.ts`），纯字符串逻辑无需 DOM stub；用例中基于 EzPinyin/Jyutping 词典的预期值（如"重庆"→zhong qing）改为本地库实测值并注明。

**aarc-web**

1. `App.vue`：删 `pinyinConvert` 注入行（`initCoreHostServices` 其余字段不变）。
2. `apiShapesAssert.ts`：删 `PinyinConvertRequestAssert` 及对应 import/注释。
3. 后端端点下线时再重新生成 ts client（本次不动，生成的 `saveUtils.pinyinConvert` 方法残留无害）。

**aarc-tauri**

- 无需任何接线改动；功能自动可用。README"可省略"列表中的 `pinyinConvert` 条目待改造完成后更新。

### 验收

- `pnpm --filter aarc-core type-check`、`pnpm --filter aarc-core test:run`、`pnpm --filter aarc-web type-check` 通过。
- web 构建产物中 pinyin 相关词典位于异步 chunk，主包体积无显著增长。
- 两端抽样对比：常用站名（含多音字、中英文混合、粤语变体）输出与现状 HTTP 方式一致。

### 文档同步（改造完成时一并做）

- `aarc-core/README.md` 宿主服务表删除拼音行。
- `aarc-web/docs/decoupling.md` §3.4、`decoupling-step17.md` 相关表格与说明更新（provider 列表、apiShapes 断言说明）。
- `aarc-tauri/README.md` 第 76 行附近"可省略"说明更新。
