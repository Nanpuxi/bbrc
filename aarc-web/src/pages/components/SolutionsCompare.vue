<script setup lang="ts">
const rows: { feature: string, official: string, private: string, local: string }[] = [
    { feature: '功能修改/新增', official: '受限', private: '自由', local: '自由' },
    { feature: '商业化（付费会员/售卖）', official: '不存在', private: '自由', local: '自由' },
    { feature: '创作规范', official: '平台决定', private: '你的团队决定', local: '——' },
    { feature: '存储', official: '平台存储', private: '你的服务器', local: '你的手机/电脑' },
    { feature: '成本', official: '免费', private: '服务器和域名自理', local: '免费' },
    { feature: '数据安全', official: '平台存储', private: '自行负责', local: '完全本地掌控' },
    { feature: '联网', official: '联网使用', private: '联网使用', local: '离线也能用' },
    { feature: '更新', official: '被动强制更新', private: '自行决定何时更新', local: '自行决定何时更新' },
]
</script>

<template>
    <table class="solutionsCompare">
        <thead>
            <tr>
                <th>功能</th>
                <th>官网</th>
                <th>私服</th>
                <th>exe/apk</th>
            </tr>
        </thead>
        <tbody>
            <tr v-for="row in rows" :key="row.feature">
                <td>{{ row.feature }}</td>
                <td class="con">{{ row.official }}</td>
                <td class="pro">{{ row.private }}</td>
                <td class="pro">{{ row.local }}</td>
            </tr>
        </tbody>
    </table>
</template>

<style scoped lang="scss">
.solutionsCompare{
    margin: 10px auto;
    th, td{
        padding: 6px;
        text-align: center;
    }
    th{
        background-color: #f3f4f6;
        color: black
    }
    .pro{
        color: green;
        font-weight: bold;
    }
    .con{
        color: #999;
    }
}
</style>
