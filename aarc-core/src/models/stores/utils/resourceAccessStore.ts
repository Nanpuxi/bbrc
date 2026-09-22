import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * 资源类栏目的访问屏蔽，三个栏目各一个 ref（互不影响，宿主可分别判定）：
 * - iconAccessNotice：“文本标签图标”栏目
 * - dataSourcesAccessNotice：“数据源”栏目
 * - uploadAccessNotice：“线路样式”导入/导出侧栏的“上传资源”页
 * 值为“为什么屏蔽”的提示文案：传入即屏蔽并原样显示，undefined 表示不屏蔽。
 * 文案由宿主给出是因为“凭什么挡住用户”本就是宿主的权限判定（如“浏览模式且不是所有者”），
 * 各栏目可以各不相同。
 * 只由 loadSaveIntoEditor 每次赋值——不能进 resetDerivedStores/relaunchDerivedStores，
 * 那两条路径在 undo/stash 时也会跑，屏蔽状态不该随撤销重做变动。
 */
export const useResourceAccessStore = defineStore('resourceAccess', ()=>{
    const iconAccessNotice = ref<string>()
    const dataSourcesAccessNotice = ref<string>()
    const uploadAccessNotice = ref<string>()
    return { iconAccessNotice, dataSourcesAccessNotice, uploadAccessNotice }
})
