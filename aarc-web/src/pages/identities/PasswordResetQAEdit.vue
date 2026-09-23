<script setup lang="ts">
import { useApiStore } from '@/app/com/apiStore';
import { useUserInfoStore } from '@/app/globalStores/userInfo';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import Notice from 'aarc-core/components/common/Notice.vue';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useIdentitiesRoutesJump } from './routes/routesJump';

const api = useApiStore()
const { showPop } = useUniqueComponentsStore()
const userInfoStore = useUserInfoStore()
const { isLogined } = storeToRefs(userInfoStore)
const { loginRouteJump } = useIdentitiesRoutesJump()
const route = useRoute()

const enteredFromEmailBindSuccess = computed<boolean>(() => route.query.fromEmailBind === '1')

const question = ref<string>("");
const answer = ref<string>("");

async function save() {
    if (!question.value.trim()) {
        showPop('请输入问题', 'warning');
        return;
    }
    if (question.value.trim().length > 32) {
        showPop('问题不能超过32个字符', 'warning');
        return;
    }
    if (!answer.value.trim()) {
        showPop('请输入答案', 'warning');
        return;
    }
    if (answer.value.trim().length > 16) {
        showPop('答案不能超过16个字符', 'warning');
        return;
    }
    const res = await api.user.setPasswordResetQA(question.value.trim(), answer.value.trim())
    if (res) {
        showPop('保存成功', 'success')
    }
}

onMounted(async() => {
    await userInfoStore.getIdentityInfo()
    if (!isLogined.value) {
        showPop('请先登录', 'failed')
        loginRouteJump()
        return
    }
    const existing = await api.user.myPasswordResetQuestion()
    question.value = existing || ""
})
</script>

<template>
    <div class="container">
        <h1>密码重置问答</h1>
        <p v-if="enteredFromEmailBindSuccess">
            你已成功绑定邮箱<br/>
            本页面非必填，可随时由「个人信息设置-设置重置问答」再次进入，但强烈建议立即设置
        </p>
        <div class="form">
            <div class="row">
                <input v-model="question" placeholder="问题（32字以内）" maxlength="32" />
            </div>
            <div class="row">
                <input v-model="answer" placeholder="答案（16字以内）" maxlength="16" autocomplete="off" />
                <button @click="save" class="save-btn">保存</button>
            </div>
        </div>
        <Notice :type="'info'" :title="'说明'">
            设置问题和答案后，忘记密码时可通过“邮箱+答案”自助重置密码。答案不会展示给任何人（包括你自己），修改时需要从头重新输入。
        </Notice>
        <Notice :type="'warn'" :title="'注意'">
            请设置无歧义且他人难以猜到的问题和答案<br/>
            正确例子：
            <div class="example">
                问题：我最喜欢的演员姓+我最喜欢的城市，无分隔<br/>
                答案：刘广州
            </div>
            错误例子：
            <div class="example">
                问题：我高中班主任的姓氏<br/>
                答案：王
            </div>
        </Notice>
    </div>
</template>

<style scoped lang="scss">
.container {
    max-width: 400px;
    margin: 0 auto;
    padding: 0px;
}
h1 {
    text-align: center;
    margin-bottom: 20px;
}
.form {
    display: flex;
    flex-direction: column;
    margin: 20px 0px;
}
.row {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
}
input {
    flex: 1;
    border: 1px solid #ddd;
    border-radius: 4px;
}
.save-btn {
    cursor: pointer;
    white-space: nowrap;
}
.example{
    background-color: #ff450054;
    padding: 4px;
    border-radius: 4px;
    font-size: 12px;
    margin: 4px;
}
</style>
