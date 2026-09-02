<script setup lang="ts">
// 极简等待遮罩：全屏蒙层阻止一切页面操作；等待超过 cancelableMs 出现取消按钮，
// 点击后清空全部等待原因（放弃操作）。行为约定见 aarc-core/README.md「回调注入接口」一节。
import { computed, ref, watch } from 'vue';

const cancelableMs = 4 * 1000;   // 与 aarc-web 的 apiCancelableMs 对齐

const showReasons = ref<Set<string>>(new Set())
const showing = computed(()=>{
    return showReasons.value.size > 0;
})
function setShowing(reason:string, value: boolean){
    if(value){
        showReasons.value.add(reason);
    }else{
        showReasons.value.delete(reason);
    }
}

const showCancelBtn = ref(false)
let waitStartAt = 0;
let waitTimeTooLongCheckTimer:number = 0
watch(showing, (newValue)=>{
    window.clearInterval(waitTimeTooLongCheckTimer)
    if(newValue){
        waitStartAt = Date.now();
        waitTimeTooLongCheckTimer = window.setInterval(()=>{
            if(Date.now() - waitStartAt > cancelableMs){
                showCancelBtn.value = true;
                window.clearInterval(waitTimeTooLongCheckTimer)
            }
        }, 100)
    }
    else{
        showCancelBtn.value = false;
    }
})
function cancel(){
    // minimal 宿主没有可中止的 api 层，直接清空所有等待原因，强制结束等待
    showReasons.value.clear()
}
defineExpose({
    setShowing
});
</script>

<template>
<div v-if="showing" class="wait">
    <div class="spinner"></div>
    <button v-if="showCancelBtn" class="cancelWaiting danger" @click="cancel">
        取消
    </button>
</div>
</template>

<style scoped lang="scss">
.wait{
    position: fixed;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 50000;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 60px;
}
.spinner {
    border: 10px solid white;
    border-top: 10px solid cornflowerblue;
    box-sizing: border-box;
    width: 70px;
    height: 70px;
    border-radius: 1000px;
    animation: spin 2s cubic-bezier(0.9, 0.1, 0.1, 0.9) infinite;
    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
}
.cancelWaiting{
    width: 100px;
    box-sizing: border-box;
    border: 2px solid white;
}
</style>
