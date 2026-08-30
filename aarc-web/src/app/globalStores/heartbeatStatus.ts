import { defineStore } from "pinia"
import { ref } from "vue"

const storeId = 'heartbeatStatus'

export const useHeartbeatStatusStore = defineStore(storeId, () => {
    // 上次心跳成功的时间（Unix 时间戳，毫秒）；0 表示尚无成功记录
    const lastSuccessAt = ref(0)

    function markSuccess(time: number = Date.now()) {
        lastSuccessAt.value = time
    }

    /**
     * 距离上次成功心跳过去了多少毫秒；尚无成功记录时返回 0
     */
    function sinceLastSuccessMs(now: number = Date.now()): number {
        if (lastSuccessAt.value <= 0)
            return 0
        return now - lastSuccessAt.value
    }

    return {
        lastSuccessAt,
        markSuccess,
        sinceLastSuccessMs
    }
})
