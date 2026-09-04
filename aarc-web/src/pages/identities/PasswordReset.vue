<script setup lang="ts">
import { useApiStore } from '@/app/com/apiStore';
import { useUniqueComponentsStore } from 'aarc-core/app/globalStores/uniqueComponents';
import Notice from 'aarc-core/components/common/Notice.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useIdentitiesRoutesJump } from './routes/routesJump';

const api = useApiStore()
const { showPop } = useUniqueComponentsStore()
const { loginRouteJump } = useIdentitiesRoutesJump()
const contact = import.meta.env.VITE_GuideResetPassword || "请联系管理员"

const email = ref<string>("");
const answer = ref<string>("");
const question = ref<string>();
const code = ref<string>("");
const newPassword = ref<string>("");
const newPasswordRepeat = ref<string>("");
const countdown = ref<number>(0);
let timer: ReturnType<typeof setInterval> | null = null;

const storageKey = 'aarc-pwdResetCodeCountdown';

const emailValid = computed<boolean>(() => email.value.includes('@'));

function getRemainingFromStorage(): number {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    const target = parseInt(raw, 10);
    if (isNaN(target)) return 0;
    const remaining = Math.ceil((target - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
}

function startCountdown(seconds: number) {
    countdown.value = seconds;
    const target = Date.now() + seconds * 1000;
    localStorage.setItem(storageKey, target.toString());
    timer = setInterval(() => {
        const remaining = getRemainingFromStorage();
        countdown.value = remaining;
        if (remaining <= 0) {
            clearInterval(timer!);
            timer = null;
            localStorage.removeItem(storageKey);
        }
    }, 1000);
}

const codeRequested = ref(false)

async function loadQuestion() {
    question.value = undefined
    if (!emailValid.value) return;
    try {
        question.value = await api.user.getPasswordResetQuestion(email.value)
    }
    catch {
        // 错误弹窗由 apiStore 统一处理（例如该账号未设置重置问题）
    }
}

async function requestReset() {
    if (countdown.value > 0) return;
    if (!email.value) {
        showPop('请输入邮箱地址', 'warning');
        return;
    }
    if (!emailValid.value) {
        showPop('邮箱格式不正确', 'warning');
        return;
    }
    if (!question.value) {
        await loadQuestion()
        if (!question.value) return;
    }
    if (!answer.value.trim()) {
        showPop('请输入问题的答案', 'warning');
        return;
    }
    const res = await api.user.requestPasswordReset(email.value, answer.value.trim())
    if (res) {
        showPop('验证码已发送到邮箱', 'success')
        startCountdown(60);
        codeRequested.value = true
    }
}

async function confirmReset() {
    if (!email.value) {
        showPop('请输入邮箱地址', 'warning');
        return;
    }
    if (!code.value) {
        showPop('请输入验证码', 'warning');
        return;
    }
    if (!newPassword.value || newPassword.value.length < 6) {
        showPop('密码至少6个字符', 'warning');
        return;
    }
    if (newPassword.value !== newPasswordRepeat.value) {
        showPop('前后两次输入密码不一致', 'warning');
        return;
    }
    const res = await api.user.confirmPasswordReset(email.value, code.value, newPassword.value)
    if (res) {
        showPop('密码重置成功，请使用新密码登录', 'success')
        window.setTimeout(() => {
            loginRouteJump(false)
        }, 1000)
    }
}

onMounted(() => {
    const remaining = getRemainingFromStorage();
    if (remaining > 0) {
        startCountdown(remaining);
    }
});

onUnmounted(() => {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
});
</script>

<template>
    <div class="container">
        <h1>忘记密码</h1>
        <Notice :type="'info'" :title="'说明'">
            输入已绑定的邮箱和密码重置问题的答案，验证通过后系统将发送重置验证码到邮箱<br/>
            未绑定邮箱或未设置重置问答的账号无法自助重置，如果无法重置，或遇到其他问题，{{ contact }}
        </Notice>
        <div class="form">
            <div class="row">
                <input v-model="email" type="email" placeholder="请输入邮箱地址" @blur="loadQuestion" />
            </div>
            <template v-if="question">
                <div class="question">
                    问题：{{ question }}
                </div>
                <div class="row">
                    <input v-model="answer" type="text" placeholder="请输入问题的答案" />
                    <button
                        @click="requestReset"
                        class="code-btn"
                        :disabled="countdown > 0"
                    >
                        {{ countdown > 0 ? `${countdown}秒后重试` : '发送验证码' }}
                    </button>
                </div>
            </template>
            <template v-if="codeRequested">
                <div class="row">
                    <input v-model="code" type="text" placeholder="请输入验证码" />
                </div>
                <div class="row">
                    <input v-model="newPassword" type="password" placeholder="请输入新密码" autocomplete="new-password" />
                </div>
                <div class="row">
                    <input v-model="newPasswordRepeat" type="password" placeholder="请重复新密码" autocomplete="new-password" />
                    <button @click="confirmReset" class="confirm-btn">确认重置</button>
                </div>
            </template>
        </div>
        <Notice v-if="codeRequested" :type="'info'" :title="'提示'">
            如果确认邮箱正确但收不到邮件，请耐心等待一段时间。验证码2小时内有效。在重置完成前，原密码将不可用。
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
    gap: 16px;
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
.question {
    font-size: 15px;
    color: #333;
}
.code-btn,
.confirm-btn {
    cursor: pointer;
    white-space: nowrap;
}
.code-btn:disabled {
    cursor: not-allowed;
    opacity: 0.7;
}
</style>
