<script setup lang="ts">
import { SaveDto } from '@/app/com/apiGenerated';
import { useSaveListLocalConfigStore } from '@/app/localConfig/saveListLocalConfig';
import iconWarn from '@/assets/ui/warn.svg';
import Prompt from 'aarc-core/components/common/Prompt.vue'
import { ref, watch } from 'vue';
import { multiUserEditRule, multiUserEditRulePromptPending } from './multiUserEditRule';

const props = defineProps<{
    saveStatus?: SaveDto
    /** 'navigate': 显示"进入编辑"按钮，点击后emit navigate；'close': 显示"知道了"按钮，仅关闭 */
    mode?: 'navigate' | 'close'
}>()

const emit = defineEmits<{
    navigate: []
}>()

const saveListLocalConfig = useSaveListLocalConfigStore()
const multiUserEditRulePromptShow = ref(false)
const multiUserEditRuleDoNotShowAgain = ref(false)
const rulePromptShow = ref(false)
const ruleDoNotShowAgain = ref(false)
const warnPromptShow = ref(false)

function multiUserEditRulePending(s: SaveDto) {
    return multiUserEditRulePromptPending(s, saveListLocalConfig.readMultiUserEditRuleUpdated)
}

function hasUnreadRule(s: SaveDto) {
    return !!(s.latestRuleContent && s.id && s.latestRuleCommentId
        && saveListLocalConfig.readRuleCommentIds[s.id] !== s.latestRuleCommentId)
}

/** 按 warn → rule 的顺序弹出下一个待显示的弹窗；返回是否确实弹出了。
 * skipWarn 用于已关闭 warn 的场景，避免再次弹出 warn */
function showNextPrompt(skipWarn = false): boolean {
    const s = props.saveStatus
    if (!s) return false
    // 优先展示warn
    if (!skipWarn && s.latestWarnContent) {
        warnPromptShow.value = true
        return true
    }
    // 无warn，检查rule
    if (hasUnreadRule(s)) {
        rulePromptShow.value = true
        return true
    }
    return false
}

watch(() => props.saveStatus, (s) => {
    if (!s) return
    // 最优先展示多人存档管理规定
    if (multiUserEditRulePending(s)) {
        multiUserEditRulePromptShow.value = true
        return
    }
    showNextPrompt()
}, { immediate: true })

function saveReadMultiUserEditRule() {
    if (multiUserEditRuleDoNotShowAgain.value) {
        saveListLocalConfig.readMultiUserEditRuleUpdated = multiUserEditRule.updated
    }
    multiUserEditRuleDoNotShowAgain.value = false
}

function handleMultiUserEditRulePromptClose() {
    multiUserEditRulePromptShow.value = false
    saveReadMultiUserEditRule()
    showNextPrompt()
}

function handleMultiUserEditRulePrimaryAction() {
    multiUserEditRulePromptShow.value = false
    saveReadMultiUserEditRule()
    if (showNextPrompt()) return
    if (props.mode === 'navigate') {
        emit('navigate')
    }
}

function handleWarnPromptClose() {
    warnPromptShow.value = false
    // 关闭Warn后检查是否还有未读的Rule
    showNextPrompt(true)
}

function handleRulePromptClose() {
    const s = props.saveStatus
    if (ruleDoNotShowAgain.value && s?.id && s.latestRuleCommentId) {
        saveListLocalConfig.readRuleCommentIds[s.id] = s.latestRuleCommentId
    }
    rulePromptShow.value = false
    ruleDoNotShowAgain.value = false
}

function handleRulePrimaryAction() {
    const s = props.saveStatus
    if (ruleDoNotShowAgain.value && s?.id && s.latestRuleCommentId) {
        saveListLocalConfig.readRuleCommentIds[s.id] = s.latestRuleCommentId
    }
    if (props.mode === 'navigate') {
        emit('navigate')
    }
    rulePromptShow.value = false
    ruleDoNotShowAgain.value = false
}

function handleWarnPrimaryAction() {
    warnPromptShow.value = false
    // 关闭Warn后检查是否还有未读的Rule，有则显示Rule而不是进入编辑
    if (showNextPrompt(true)) return
    // 无未读Rule，才进入编辑
    if (props.mode === 'navigate') {
        emit('navigate')
    }
}
</script>

<template>
    <Prompt v-if="multiUserEditRulePromptShow" bg-click-close @close="handleMultiUserEditRulePromptClose">
        <div class="multi-user-edit-rule-prompt">
            <div class="rule-label">多人存档管理规定</div>
            <div v-for="(rule, idx) in multiUserEditRule.rules" :key="idx" class="rule-content">{{ rule }}</div>
            <div class="rule-meta">{{ multiUserEditRule.updated }}</div>
            <label class="do-not-show-again">
                <input type="checkbox" v-model="multiUserEditRuleDoNotShowAgain" />
                <span>不再显示本条</span>
            </label>
        </div>
        <button class="major" @click="handleMultiUserEditRulePrimaryAction()">
            {{ mode === 'navigate' ? '进入编辑' : '知道了' }}
        </button>
    </Prompt>
    <Prompt v-if="warnPromptShow" bg-click-close @close="handleWarnPromptClose">
        <div class="warn-prompt">
            <img :src="iconWarn" />
            <div class="warn-content">{{ saveStatus?.latestWarnContent }}</div>
            <div class="warn-meta">
                <span>{{ saveStatus?.latestWarnBy }}</span>
                <span>{{ saveStatus?.latestWarnCreated }}</span>
            </div>
            <div class="warn-meta">编辑后，管理员会检查并消除本警告</div>
        </div>
        <button class="major" @click="handleWarnPrimaryAction()">
            {{ mode === 'navigate' ? '进入编辑' : '知道了' }}
        </button>
    </Prompt>
    <Prompt v-if="rulePromptShow" bg-click-close @close="handleRulePromptClose">
        <div class="rule-prompt">
            <div class="rule-label">编辑规则</div>
            <div class="rule-content">{{ saveStatus?.latestRuleContent }}</div>
            <div class="rule-meta">{{ saveStatus?.latestRuleCreated }}</div>
            <label class="do-not-show-again">
                <input type="checkbox" v-model="ruleDoNotShowAgain" />
                <span>不再显示本条</span>
            </label>
        </div>
        <button class="major" @click="handleRulePrimaryAction()">
            {{ mode === 'navigate' ? '进入编辑' : '知道了' }}
        </button>
    </Prompt>
</template>

<style scoped lang="scss">
.warn-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 200px;
    max-width: 300px;
    margin-bottom: 8px;

    img {
        width: 40px;
        height: 40px;
    }

    .warn-content {
        font-size: 16px;
        color: #c0392b;
        text-align: center;
        word-break: break-word;
    }

    .warn-meta {
        display: flex;
        gap: 8px;
        font-size: 12px;
        color: #666;
    }
}

.rule-prompt,
.multi-user-edit-rule-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    min-width: 200px;
    max-width: 300px;
    margin-bottom: 8px;

    .rule-label {
        font-size: 14px;
        color: #3498db;
        font-weight: bold;
    }

    .rule-content {
        font-size: 16px;
        color: #2c3e50;
        text-align: center;
        word-break: break-word;
    }

    .rule-meta {
        font-size: 12px;
        color: #666;
    }

    .do-not-show-again {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        color: #666;
        cursor: pointer;

        input {
            cursor: pointer;
        }
    }
}

.major {
    display: block;
    margin: auto;
}
</style>
