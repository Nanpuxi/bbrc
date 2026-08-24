<script setup lang="ts">
import { computed, ref } from 'vue';
import donorsJson from '@/data/donate/donors.json';

interface Donor {
    name: string
    amount: number
    remark?: string
}

const props = withDefaults(defineProps<{
    collapsible?: boolean
}>(), {
    collapsible: true
})

const expanded = ref(!props.collapsible)

const donors = computed<Donor[]>(() => {
    return [...(donorsJson as Donor[])].sort((a, b) => {
        if (a.amount !== b.amount) return b.amount - a.amount
        return a.name.localeCompare(b.name)
    })
})
</script>

<template>
<div class="donor-list">
    <h2>感谢捐赠</h2>
    <div class="listWrap" :class="{ collapsed: !expanded }">
        <div v-for="d in donors" :key="d.name" class="donor">
            <span class="name">{{ d.name }}</span>
            <span class="amount">￥{{ d.amount.toFixed(2) }}</span>
        </div>
        <div v-if="!expanded" class="fadeMask"></div>
    </div>
    <button v-if="collapsible" class="lite expandBtn" @click="expanded = !expanded">{{ expanded ? '收起▲' : '查看全部▼' }}</button>
    <div class="donorNote">
        本名单按金额从高到低排序，金额相同时按昵称字典序排列。<br/>
        为保护隐私，未留昵称的捐赠者不在名单中。<br/>
        如果名单有遗漏，或是不希望被展示，请qq私聊：1783826971（Au）
    </div>
</div>
</template>

<style scoped lang="scss">
.donor-list{
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    padding: 16px;
    h2{
        font-size: 18px;
        color: #999;
        margin: 0;
    }
}
.listWrap{
    position: relative;
    width: 100%;
    max-width: 400px;
    &.collapsed{
        max-height: 300px;
        overflow: hidden;
    }
}
.fadeMask{
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 60px;
    background: linear-gradient(to bottom, transparent, white);
    pointer-events: none;
}
.donor{
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    border-bottom: 1px solid #eee;
    color: #333;
    font-size: 14px;
    .amount{
        color: #cf8a2e;
        font-weight: bold;
    }
}
.expandBtn{
    margin: auto;
    color: cornflowerblue;
}
.donorNote{
    font-size: 12px;
    color: #aaa;
    text-align: center;
    line-height: 1.6;
}
</style>
