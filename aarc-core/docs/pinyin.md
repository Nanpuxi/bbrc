# 拼音转换（core 本地实现）

> 2026-09 起拼音转换为 aarc-core 自包含实现（`components/composables/pinyinConverter.ts`），
> 不再依赖宿主注入与后端 HTTP 端点；web/tauri 零接线、离线可用。
> 本文档前半是现状与转换语义，后半"改造记录"保留移植时的考据备查。

## 一、现状

### 调用链

```
NameEdit.vue / TextTagEdit.vue（转换按钮）
  └─ usePinyinConvert(source, dest, afterDone)     aarc-core/src/components/composables/usePinyinConvert.ts
       ├─ 二次点击确认/覆盖逻辑（core 内）
       ├─ resolvePinyinConvert（解析预设引用，models/pinyinPreset.ts）
       └─ convertPinyinLocal（纯前端本地实现，pinyinConverter.ts）
            ├─ pinyin-pro（普通话，逐字调用，动态 import 懒加载）
            └─ to-jyutping（粤语，动态 import 懒加载）
```

- 配置来源：`config.pinyinConvert`（存档默认）与 `config.pinyinConvertPresets`（具名预设），
  字段定义见 `models/config.ts` 的 `PinyinConvertConfig`（规则/大小写/方言/字间空格/中英空格/ü 记法）。
- 原有的 `PinyinConvertProvider` 注入层（`hostServices.ts` 字段、`initPinyinConvertProvider`、
  各组件的注入门控、web `App.vue` 接线、后端 `SaveUtils/PinyinConvert` 端点）已全部删除。

### 转换语义

本地实现复刻了原 C# `PinyinConverter.Convert` 的行为（移植时的规格书是其 27 个 xunit 基准用例，
对应 vitest 版 `src/tests/unit/pinyinConverter.test.ts`），并在此基础上有本地扩展：

1. **规则切分**：规则 Key 支持 `^`（仅开头匹配）、`$`（仅结尾匹配）、`^x$`（全串相等）；按 Key 长度降序最长匹配；Key/Value 去空白、空 Key 剔除（防死循环）；Value 支持 `^`/`$` 前缀/后缀把结果段搬到输出头部/尾部；命中规则的值 as-is；其余字符按"是否中文"（`\u4E00-\u9FFF`、`\u3400-\u4DBF`）聚合成段。
2. **中文段转换**：普通话**逐字默认读音**（无声调、非词组感知，如"重庆"→zhong qing）；粤语 Jyutping 无调号。
3. **大小写/拼接**：Pascal 逐字首大写；AllUpper/AllLower 整段转换；FirstUpper 仅第一个段 Pascal（注意：`isFirstSeg` 被非中文首段消耗，"a中国"→"a zhongguo"）；`spaceBetweenChars` 控制逐字空格；段间默认以空格连接，`spaceBetweenMixed` 可关闭（缺省 true，旧存档经 configVersion 2 升级回填）。
4. **`_` 强制空格标记**（本地扩展）：规则值首尾的 `_` 表示该侧强制补一个空格，仅在 `spaceBetweenMixed` 关闭时生效（开启时标记被消费但不重复加空格），如 `公园:_Park` → `ZhongShan Park`；词中下滑线原样保留；可与 `^`/`$` 组合（`东$:^East_`）。
5. `ü` 记法：默认 `nv`（女）但 `lue`（略），即 `ü`→`v`、`üe`→`ue`；可用 `uStyle`/`ueStyle` 配置为 `u`/`ü`/`v`。
6. 超长（>50 字）返回 null，由调用方按失败处理。

## 二、词典库实测结论（移植时验证，备查）

| 项 | pinyin-pro（普通话） | to-jyutping（粤语） |
|---|---|---|
| 调用 | `pinyin(seg, { type:'array', toneType:'none' })` | `getJyutpingList(seg)` → `[字, 粤拼\|null][]`，去末尾数字 |
| 词组感知 | **是**，整段调用会分词（"重庆"→chong qing），与逐字语义不符；**须逐字调用**（"重"→zhong，对齐） | 逐字，对齐 |
| 粤语调号 | — | 带调号（zung1），正则去数字后与无调号输出一致 |
| `ü` | 默认 `nü`/`lüe`；后处理 `üe`→`ue`/`ü`→`v` 后对齐（女→nv、略→lue、虐→nue，已实测） | — |
| 体积（dist 全量） | ~0.9M | ~1.3M |

残余差异：两库"单字最常用音"词频表不同，极少数生僻多音字选音可能不同（常见字已抽样全部对齐）；粤语多音节合字（如"瓩"）返回完整，原 C# 只取首音节，可截断对齐亦可忽略。

## 三、改造记录（2026-09，已完成）

### 实现要点

- 拼音转换不是宿主服务：core 自包含实现，web/tauri/未来宿主零接线、行为一致、离线可用。
- **词典懒加载**：`pinyin-pro`/`to-jyutping` 经 `await import()` 在首次转换时加载（vite 自动切异步 chunk），避免首屏白增约 400–500K gzip。
- 50 字上限原本在后端 Controller 校验，本地化后由 core 侧 `PINYIN_CONVERT_MAX_LENGTH` 承接。
- 后端 `SaveUtils/PinyinConvert` 端点与 `AARC.Utils` 项目随后端清理一并下线，ts client 已无 `saveUtils.pinyinConvert` 残留。

### 已执行的改动（备查）

- **aarc-core**：新增依赖 `pinyin-pro`、`to-jyutping`；新建 `pinyinConverter.ts`；`usePinyinConvert.ts` 删除 provider 定义直接调本地实现；删除 `hasPinyinConvertProvider()` 及 `NameEdit.vue`/`TextTagEdit.vue`/`PinyinConvertConfig.vue` 的注入门控；`hostServices.ts` 删除 `pinyinConvert` 字段；`apiShapes.ts` 删除 `PinyinConvertRequest`/`PinyinConvertOptions`，拼音 enum 移入 `pinyinConverter.ts`；27 个基准用例移植为 `pinyinConverter.test.ts`。
- **aarc-web**：`App.vue` 删注入行；`apiShapesAssert.ts` 删 `PinyinConvertRequestAssert`。
- **aarc-tauri**：零接线，`README` 可省略列表已注明。

### 验收（当时）

- `pnpm --filter aarc-core type-check`、`pnpm --filter aarc-core test:run`、`pnpm --filter aarc-web type-check` 通过。
- web 构建产物中 pinyin 相关词典位于异步 chunk，主包体积无显著增长。
- 两端抽样对比：常用站名（含多音字、中英文混合、粤语变体）输出与改造前 HTTP 方式一致。
