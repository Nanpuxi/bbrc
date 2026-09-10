import { ControlPoint } from "aarc-core/models/save";
import { defineStore } from "pinia";
import { useSaveStore } from "../saveStore";
import { useConfigStore } from "../configStore";
import { useFreePtDirectionStore } from "./freePtDirectionStore";
import { numberCmpEpsilon } from "aarc-core/utils/consts";
import { computed, ref, watch } from "vue";
import { Coord } from 'aarc-core/models/coord';
import {
    buildNeighbors,
    cleanNeighborsForDeletedPt,
    decideClusterRestoreStrategy,
    getClusterMaxSizePure,
    getPtSnapCandidatesAndReachPure,
    getRectOfClusterPure,
    getStaClusterByIdPure,
    isPtSinglePure,
    makeClustersFromNeighborsPure,
    Neighbors,
    PtSnapCandidatesInfo,
    resolveStaNamePure,
    SavePatch,
    tryTransferStaNameWithinClusterPure,
    updateNeighborsForMovedPt
} from "./staClusterStore.pure";

export const useStaClusterStore = defineStore('staCluster', ()=>{
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    const freePtDirectionStore = useFreePtDirectionStore()
    saveStore.deletedPoint = cleanClustersFromDeletedPt
    
    // 使用时读取而非一次性捕获：snapOctaClingPtPtDist 可能在会话内被修改
    const getConfigClingingDist = () => cs.config.snapOctaClingPtPtDist

    // free 点 cluster 生成模式：loose（默认，吸附阈值内即算入）/ strict（需几乎精确落在
    // 吸附点位上）/ off（free 点完全不参与 cluster 生成，由 ptClingingPure 拒绝任何含
    // free 点的点对；此处不传吸附候选只是为了避免 free 点候选的无效计算）
    const getFreePtClusterMode = () => cs.config.freePtClusterMode

    // free 点偏移候选的比较阈值与实际吸附（snapCore.snapInterPt）对齐：
    // snapOctaClingPtPtThrs × 吸附阈值缩放比率（点所属线路的最小宽度）
    const getSnapThrs = (id: number) =>
        cs.config.snapOctaClingPtPtThrs * saveStore.getSnapThrsRatio(id)

    // 贴合距离相关配置（基础距离、吸附阈值、线宽映射的吸附尺寸、free cluster 模式）变化时，
    // 邻接表与 cluster 缓存必须整体失效（靠懒加载重建），
    // 否则会残留旧配置算出的邻接关系（如远距离 cluster）；
    // 且增量更新会用新配置重算单点邻接，与旧边混杂
    // 值键 watch 而非 deep watch：readConfigFromSave 会整体替换 config 对象，
    // 即使各项值未变也会触发 deep watch，在首次渲染后把刚建好的缓存误清
    // （进存档后第一个操作若是移动点，增量更新会落在空邻接表上，见 docs/cluster.md 7.4）
    watch(
        () => [
            cs.config.snapOctaClingPtPtDist,
            cs.config.snapOctaClingPtPtThrs,
            cs.config.freePtClusterMode,
            JSON.stringify(cs.config.lineWidthMapped)
        ].join('|'),
        () => clearItems()
    )

    const getPtSnapCandidatesAndReach = (pt: ControlPoint): PtSnapCandidatesInfo =>
        getPtSnapCandidatesAndReachPure(
            pt,
            id => saveStore.getLinesDecidedPtSnapSize(id),
            id => freePtDirectionStore.getPtDirectionInfos(id),
            getConfigClingingDist()
        )

    const staClusters = ref<ControlPoint[][]>()
    const staBelongToCluster = computed<Record<number, ControlPoint[]|undefined>>(()=>{
        const clusters = staClusters.value
        if(!clusters)
            return {}
        const res:Record<number, ControlPoint[]|undefined> = {}
        for(const c of clusters){
            for(const pt of c){
                res[pt.id] = c
            }
        }
        return res
    })
    function getStaClusters(){
        if(!staClusters.value){
            initNeighbors()
            makeClustersFromNeighbors()
        }
        return staClusters.value
    }

    /**
     * 记录每个点的邻点，在有点移动或删除时，需要更新
     */
    let neighbors:Neighbors = {}
    function initNeighbors() {
        const pts = saveStore.save?.points
        if (!pts)
            return
        const freeMode = getFreePtClusterMode()
        neighbors = buildNeighbors(
            pts,
            getConfigClingingDist(),
            id => saveStore.getLinesDecidedPtSnapSize(id),
            numberCmpEpsilon,
            freeMode === 'off' ? undefined : getPtSnapCandidatesAndReach,
            freeMode === 'off' ? undefined : getSnapThrs,
            freeMode
        )
    }
    function makeClustersFromNeighbors(){
        staClusters.value = makeClustersFromNeighborsPure(
            neighbors,
            id => saveStore.getPtById(id)
        )
    }

    function updateClustersBecauseOf(pt:ControlPoint){
        // 邻接表/cluster 尚未懒加载构建时（如进入存档后第一个操作就是移动点，
        // 或配置变更刚使缓存失效），存档数据本身已是最新，无需增量更新，
        // 之后的 getStaClusters 会基于当前存档全量构建。
        // 若在空邻接表上做增量更新：新邻接表只含被移动点的边，且 staClusters
        // 会被置为“已构建”，导致既有 cluster 全部丢失且懒加载无法自愈
        if(staClusters.value === undefined)
            return
        const freeMode = getFreePtClusterMode()
        neighbors = updateNeighborsForMovedPt(
            neighbors,
            pt,
            saveStore.save?.points || [],
            getConfigClingingDist(),
            id => saveStore.getLinesDecidedPtSnapSize(id),
            numberCmpEpsilon,
            freeMode === 'off' ? undefined : getPtSnapCandidatesAndReach,
            freeMode === 'off' ? undefined : getSnapThrs,
            freeMode
        )
        makeClustersFromNeighbors()
    }
    function cleanClustersFromDeletedPt(ptId:number){
        // 与 updateClustersBecauseOf 同理：未构建时删除已反映在当前存档中，
        // 无需清理，等懒加载全量构建即可
        if(staClusters.value === undefined)
            return
        neighbors = cleanNeighborsForDeletedPt(neighbors, ptId)
        makeClustersFromNeighbors()
    }

    function tryTransferStaNameWithinCluster(sta:ControlPoint){
        const cluster = getStaClusters()?.find(c=>c.find(s=>s.id === sta.id))
        if(!cluster)
            return
        const transfer = tryTransferStaNameWithinClusterPure(sta, cluster)
        if(!transfer)
            return
        const target = saveStore.getPtById(transfer.toId)
        if(!target)
            return
        target.name = transfer.name
        target.nameS = transfer.nameS
        target.nameP = transfer.nameP
        return target
    }
    function getMaxSizePtWithinCluster(ptId:number, sizeType:'ptSize'|'ptNameSize'|'ptNameSnapSize'){
        const get = sizeType === 'ptSize' 
            ? (id:number)=>saveStore.getLinesDecidedPtSize(id)
            : sizeType === 'ptNameSize'
            ? (id:number)=>saveStore.getLinesDecidedPtNameSize(id)
            : (id:number)=>saveStore.getLinesDecidedPtNameSnapSize(id)
        return getClusterMaxSizePure(staBelongToCluster.value[ptId], get, ptId)
    }
    function getRectOfCluster(cluster: ControlPoint[]|undefined):Coord[] {
        if (!cluster || cluster.length === 0)
            return []
        return getRectOfClusterPure(cluster)
    }
    function clearItems(){
        staClusters.value = undefined
        neighbors = {}
    }
    /**
     * undo/redo 恢复存档后的 cluster 缓存处理（替代无条件的 clearItems）。
     * patch 未触及 points/lines 时完整保留缓存；只动少量 points 时增量恢复；
     * 其余情况（无 patch 信息、动了 lines、变更点过多）回退全量重建
     */
    function restoreWithPatch(patch?: SavePatch){
        const strategy = decideClusterRestoreStrategy(patch, staClusters.value !== undefined)
        if(strategy === 'preserve')
            return
        if(strategy === 'rebuild' || !patch?.points){
            clearItems()
            return
        }
        const allPts = saveStore.save?.points || []
        const freeMode = getFreePtClusterMode()
        for(const entry of patch.points){
            const pt = entry.new === undefined ? undefined : saveStore.getPtById(entry.id)
            if(!pt){
                neighbors = cleanNeighborsForDeletedPt(neighbors, entry.id)
                continue
            }
            neighbors = updateNeighborsForMovedPt(
                neighbors,
                pt,
                allPts,
                getConfigClingingDist(),
                id => saveStore.getLinesDecidedPtSnapSize(id),
                numberCmpEpsilon,
                freeMode === 'off' ? undefined : getPtSnapCandidatesAndReach,
                freeMode === 'off' ? undefined : getSnapThrs,
                freeMode
            )
        }
        makeClustersFromNeighbors()
    }
    function getStaClusterById(ptId:number){
        return getStaClusterByIdPure(ptId, getStaClusters() || [], id => saveStore.getPtById(id))
    }
    function getStaName(ptId: number, raw?: boolean): {name: string, nameSub: string, ptId: number} {
        return resolveStaNamePure(
            ptId,
            !!raw,
            saveStore.save?.points || [],
            saveStore.save?.pointLinks || [],
            getStaClusters() || []
        )
    }

    function isPtSingle(ptId: number) {
        const pt = saveStore.getPtById(ptId)
        if (!pt)
            return false
        return isPtSinglePure(ptId, getStaClusters() || [])
    }
    return {
        getStaClusters,
        updateClustersBecauseOf,
        tryTransferStaNameWithinCluster,
        getMaxSizePtWithinCluster,
        clearItems,
        restoreWithPatch,
        getRectOfCluster,
        getStaClusterById,
        isPtSingle,
        getStaName,
        cleanClustersFromDeletedPt
    }
})
