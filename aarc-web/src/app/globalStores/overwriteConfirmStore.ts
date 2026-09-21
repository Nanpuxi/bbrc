import { defineStore } from 'pinia';
import { shallowRef } from 'vue';

/** 一条将被覆盖的同名资源（名称+预览图） */
export interface OverwriteConfirmItem {
    /** 既有资源的显示名 */
    name: string;
    /** 既有资源的预览图地址（可选） */
    existingThumbUrl?: string;
    /** 新内容的预览图地址（可选，如 objectURL，用完后由调用方回收） */
    newThumbUrl?: string;
}

interface PendingOverwriteConfirm {
    items: OverwriteConfirmItem[];
    resolve: (ok: boolean) => void;
}

/**
 * "同名资源覆盖"确认弹窗的状态（与 OverwriteConfirmPrompt.vue 配套，弹窗挂载在 App.vue）。
 * 任何类型的资源上传前都可经此弹窗让用户确认覆盖。
 */
export const useOverwriteConfirmStore = defineStore('overwriteConfirm', () => {
    const pending = shallowRef<PendingOverwriteConfirm>();

    /** 弹出覆盖确认框并等待用户选择：确认覆盖 resolve true，取消 resolve false */
    function request(items: OverwriteConfirmItem[]): Promise<boolean> {
        // 弹窗同时只展示一批；已有待决请求时直接视为取消旧请求
        pending.value?.resolve(false);
        return new Promise(resolve => {
            pending.value = { items, resolve };
        });
    }

    /** 由弹窗按钮调用 */
    function answer(ok: boolean) {
        const p = pending.value;
        pending.value = undefined;
        p?.resolve(ok);
    }

    return { pending, request, answer };
});
