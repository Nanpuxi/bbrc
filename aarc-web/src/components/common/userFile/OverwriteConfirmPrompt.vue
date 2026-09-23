<script setup lang="ts">
import { storeToRefs } from 'pinia';
import Prompt from 'aarc-core/components/common/Prompt.vue';
import { useOverwriteConfirmStore } from '@/app/globalStores/overwriteConfirmStore';

/**
 * "同名资源覆盖"确认弹窗（基于 core 的 Prompt.vue，挂载于 App.vue）。
 * 与资源类型无关：任何上传方在 preflight 发现同名资源后，
 * 调 useOverwriteConfirmStore().request(items) 即可复用本弹窗。
 */
const overwriteConfirmStore = useOverwriteConfirmStore()
const { pending } = storeToRefs(overwriteConfirmStore)
</script>

<template>
    <Prompt v-if="pending" :bgClickClose="true" @close="overwriteConfirmStore.answer(false)">
        <div class="overwriteConfirm">
            <div class="title">将覆盖同名资源</div>
            <div class="items">
                <div v-for="(item, idx) in pending.items" :key="idx" class="item">
                    <div class="name" :title="item.name">{{ item.name }}</div>
                    <div class="thumbs">
                        <div class="thumbBox">
                            <img v-if="item.existingThumbUrl" :src="item.existingThumbUrl" alt="当前预览" />
                            <div v-else class="thumbFallback">无预览</div>
                            <div class="thumbLabel">当前</div>
                        </div>
                        <template v-if="item.newThumbUrl">
                            <div class="arrow">→</div>
                            <div class="thumbBox">
                                <img :src="item.newThumbUrl" alt="新预览" />
                                <div class="thumbLabel">新上传</div>
                            </div>
                        </template>
                    </div>
                </div>
            </div>
            <div class="buttons">
                <button class="minor" @click="overwriteConfirmStore.answer(false)">取消</button>
                <button @click="overwriteConfirmStore.answer(true)">确认覆盖</button>
            </div>
        </div>
    </Prompt>
</template>

<style lang="scss" scoped>
.overwriteConfirm {
    min-width: 240px;
    max-width: 360px;
    .title {
        font-size: 16px;
        font-weight: bold;
        text-align: center;
        margin-bottom: 10px;
    }
    .items {
        max-height: 320px;
        overflow-y: auto;
        margin-bottom: 10px;
        .item {
            background-color: #eee;
            border-radius: 6px;
            margin-bottom: 6px;
            padding: 8px 10px;
            &:last-child {
                margin-bottom: 0;
            }
            .name {
                font-size: 14px;
                text-align: center;
                word-break: break-all;
                margin-bottom: 6px;
            }
            .thumbs {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                .arrow {
                    font-size: 18px;
                    color: #666;
                }
                .thumbBox {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                    img, .thumbFallback {
                        width: 96px;
                        height: 96px;
                        object-fit: contain;
                        background-color: white;
                        border: 1px solid #ccc;
                        border-radius: 4px;
                    }
                    .thumbFallback {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #999;
                        font-size: 13px;
                    }
                    .thumbLabel {
                        font-size: 12px;
                        color: #666;
                    }
                }
            }
        }
    }
    .buttons {
        display: flex;
        justify-content: center;
        gap: 10px;
        button {
            min-width: 80px;
        }
    }
}
</style>
