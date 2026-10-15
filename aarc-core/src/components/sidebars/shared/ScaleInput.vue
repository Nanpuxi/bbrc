<script setup lang="ts">
import { computed } from 'vue';

// 缩放倍率输入：undefined 表示未设置（主倍率按 1，副倍率跟随主值）
const scale = defineModel<number>()
const props = defineProps<{ placeholder?: string, cancelable?: boolean }>()
const emit = defineEmits<{ cancel: [] }>()

// 输入框的上下限，setter 统一按此 clamp
const MIN = 0.05, MAX = 10
// 滑条只覆盖常用区间；超出区间的值显示在端点，拖动后才按滑条取值
const RANGE_MIN = 0.3, RANGE_MAX = 2, RANGE_STEP = 0.1

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v))

const text = computed<string>({
    get: () => scale.value === undefined ? '' : String(scale.value),
    set: (v) => {
        //留空或非法值（非有限）一律写回 undefined，由渲染层按默认倍率处理
        //注意：type="number" 的 v-model 即使不加 .number，Vue 也会把合法输入转成 number 传入
        const s = String(v ?? '').trim()
        const n = Number(s)
        scale.value = s !== '' && Number.isFinite(n) ? clamp(n) : undefined
    }
})

const rangeVal = computed<number>({
    get: () => scale.value === undefined ? 1 : clamp(scale.value),
    set: (v) => { scale.value = clamp(v) }
})
</script>

<template>
    <div class="scaleInput">
        <div class="scaleNumRow">
            <input class="scaleNum" type="number" v-model.lazy="text" :min="MIN" :max="MAX"
                :placeholder="props.placeholder ?? '默认'"/>
            <button v-if="props.cancelable" class="lite cancel" title="清除此项，改为跟随主文本"
                @click="emit('cancel')">×</button>
        </div>
        <input type="range" v-model.number="rangeVal" :min="RANGE_MIN" :max="RANGE_MAX" :step="RANGE_STEP"/>
    </div>
</template>

<style scoped lang="scss">
.scaleInput{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 160px;
    margin: 0px auto;

    input{
        margin: 0px;
        width: 140px;
        font-size: 15px;
        box-sizing: border-box;
    }
    .scaleNumRow{
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        width: 140px;

        .scaleNum{
            width: 80px;
        }
        .cancel{
            width: 24px;
            padding: 0px;
        }
    }
}
</style>
