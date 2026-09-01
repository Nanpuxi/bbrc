<script setup lang="ts">
import { computed } from 'vue';

// 父组件通过 v-model 提供/读取弧度制数值，UI 显示角度制
const radians = defineModel<number>({ default: 0 })

const round2 = (v: number) => Math.round(v * 100) / 100

const degrees = computed<number>({
    get: () => round2((radians.value ?? 0) * 180 / Math.PI),
    set: (v) => {
        radians.value = round2(v) * Math.PI / 180
    }
})
</script>

<template>
    <div class="angle-input">
        <input class="angle-num"
            type="number"
            v-model.number="degrees"
            min="-180"
            max="180"
            step="5"
        />
        <input
            type="range"
            v-model.number="degrees"
            min="-180"
            max="180"
            step="5"
        />
    </div>
</template>

<style scoped lang="scss">
.angle-input {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 190px;
    margin: 0px auto;

    input {
        margin: 0px;
        width: 160px;
        font-size: 15px;
        box-sizing: border-box;
    }
    .angle-num {
        width: 80px;
    }
}
</style>
