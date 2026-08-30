<script setup lang="ts">
import DonorList from '../components/DonorList.vue';
</script>

<template>
<div class="donorListPage">
    <DonorList :collapsible="false"></DonorList>
</div>
</template>

<style scoped lang="scss">
.donorListPage{
    max-width: 600px;
    margin: 20px auto;
    padding: 0 10px;
}
</style>
