<script setup lang="ts">
import { PinyinConvertConfig } from 'aarc-core/models/config';
import { PinyinCaseType, PinyinVariantType, PinyinUStyle } from 'aarc-core/components/composables/pinyinConverter';
import { ref } from 'vue';

/**
 * 拼音转换设置表格（存档默认设置与各个预设共用）。
 * 直接就地改写 settings 的字段，不做 v-model —— 与 config.pinyinConvert 的写法一致。
 */
defineProps<{
    settings:PinyinConvertConfig
}>()

const rulesNoteExpanded = ref(false)
</script>

<template>
<tbody>
    <tr>
        <td style="min-width: 50px;">大小写</td>
        <td>
            <select v-model="settings.caseType">
                <option :value="PinyinCaseType.Pascal">每字首字母大写</option>
                <option :value="PinyinCaseType.FirstUpper">整体首字母大写</option>
                <option :value="PinyinCaseType.WordsFirstUpper">每词首字母大写</option>
                <option :value="PinyinCaseType.AllUpper">全大写</option>
                <option :value="PinyinCaseType.AllLower">全小写</option>
            </select>
        </td>
    </tr>
    <tr>
        <td style="min-width: 50px;">方言</td>
        <td>
            <select v-model="settings.variantType">
                <option :value="PinyinVariantType.Mandarin">普通话</option>
                <option :value="PinyinVariantType.Cantonese">广东话</option>
            </select>
        </td>
    </tr>
    <tr>
        <td>字间<br/>空格</td>
        <td>
            <input v-model="settings.spaceBetweenChars" type="checkbox">
        </td>
    </tr>
    <tr>
        <td>中英<br/>空格</td>
        <td>
            <input v-model="settings.spaceBetweenMixed" type="checkbox">
        </td>
    </tr>
    <tr>
        <td>绿</td>
        <td>
            <select v-model="settings.uStyle">
                <option :value="undefined">默认</option>
                <option :value="PinyinUStyle.U">lu</option>
                <option :value="PinyinUStyle.Umlaut">lü</option>
                <option :value="PinyinUStyle.V">lv</option>
            </select>
        </td>
    </tr>
    <tr>
        <td>略</td>
        <td>
            <select v-model="settings.ueStyle">
                <option :value="undefined">默认</option>
                <option :value="PinyinUStyle.U">lue</option>
                <option :value="PinyinUStyle.Umlaut">lüe</option>
                <option :value="PinyinUStyle.V">lve</option>
            </select>
        </td>
    </tr>
    <tr>
        <td>
            自定义<br/>规则
        </td>
        <td>
            <textarea v-model="settings.rules"></textarea>
        </td>
    </tr>
    <tr>
        <td colspan="2">
            <button class="lite" @click="rulesNoteExpanded = !rulesNoteExpanded">
                {{ rulesNoteExpanded ? '收起自定义规则说明': '展开自定义规则说明' }}
            </button>
            <div v-show="rulesNoteExpanded" class="smallNote">
                <p>根据个人需求添加更多翻译规则，例如:</p>
                <p class="example-p">大学:University、会展中心:Expo Center</p>
                <p class="example-p">南站:South Rwy Sta、城市名:城市英文名</p>
                <p>^表示开头处、$表示结尾处，例如:</p>
                <p class="example-p">^省:provincial、站$:Rwy Sta</p>
                <p>^$在右侧同样可以使用，例如:</p>
                <p class="example-p">北$:^North、东$:^East</p>
                <p class="example-p">李家村东→East LiJiaCun</p>
                <p>值首尾的下划线表示强制空格，“中英空格”关闭时仍生效:</p>
                <p class="example-p">公园:_Park、北$:^North_</p>
            </div>
        </td>
    </tr>
</tbody>
</template>

<style lang="scss" scoped>
textarea{
    width: 180px;
    height: 180px;
}
.smallNote{
    text-align: left;
}
.example-p{
    margin-left: 10px;
}
</style>
