import { ControlPoint, ControlPointDir, ControlPointLink, ControlPointLinkType, ControlPointSta } from "aarc-core/models/save";
import { useConfigStore } from "aarc-core/models/stores/configStore";
import { Coord } from "aarc-core/models/coord";
import { useStaClusterStore } from "aarc-core/models/stores/saveDerived/staClusterStore";
import { defineStore } from "pinia";
import { CvsContext } from "../common/cvsContext";
import { useSaveStore } from "aarc-core/models/stores/saveStore";
import { useFreePtDirectionStore } from "aarc-core/models/stores/saveDerived/freePtDirectionStore";
import { clusterToPolyAngle, clusterToPolyMinimumArea, clusterToPolyVert, clusterToPolyInc } from "aarc-core/utils/clusterUtils/clusterPolyAngle";
import { usePointLinkStore } from "aarc-core/models/stores/pointLinkStore";
import { isZero } from "aarc-core/utils/sgn";
import { useCvsBlocksControlStore } from "../common/cvs";
import { useRenderOptionsStore } from "aarc-core/models/stores/renderOptionsStore";

interface ClusterPoly{
    coords:Coord[]
    maxStaSize:number
    ill:boolean
    isFromLink?:boolean
    /** 点的包围盒（不含线宽 padding），供逐帧视口剔除 */
    bbox:[number,number,number,number]
}
export const useClusterCvsWorker = defineStore('clusterCvsWorker', ()=>{
    const staClusterStore = useStaClusterStore()
    const saveStore = useSaveStore()
    const cs = useConfigStore()
    const pointLinkStore = usePointLinkStore()
    const freePtDirectionStore = useFreePtDirectionStore()
    const cvsBlocksControlStore = useCvsBlocksControlStore()
    const renderOptionsStore = useRenderOptionsStore()
    const clusterPolyCache = new Map<string, ClusterPoly>()

    // 全量渲染数据缓存：仅当签名（所有 cluster 点的 id/pos/dir/size + 所有 pointLink 及其非 dot 端点的 pos/dir/size/sta）变化时重建。
    // 视角移动时签名不变，逐帧只做 O(cluster数) 的视口剔除，不再遍历点和拼接缓存 key。
    let polysCache: ClusterPoly[] = []
    let sigBuf: number[] = []
    let sigLen = -1

    function getClustersRenderingData(){
        const clusters = staClusterStore.getStaClusters() || []
        const links = saveStore.save?.pointLinks
        if(signatureChanged(clusters, links)){
            polysCache = buildAllPolys(clusters)
        }
        if(renderOptionsStore.exporting)
            return polysCache
        const { left, right, top, bottom } = cvsBlocksControlStore.blockTotalBoundary
        // 未初始化/无 block 时不应省略任何 cluster
        if(left > right || top > bottom)
            return polysCache
        return polysCache.filter(p=>!isPolyOutsideView(p, left, right, top, bottom))
    }

    /**
     * 将所有 cluster 点的 id/pos/dir/size、所有 pointLink 的内容、以及非 dot 链接端点的
     * pos/dir/size/sta 写入可复用的签名缓冲区，与上一帧逐位比较，返回是否有变化。
     * 端点数据必须入签名：伪集群与 cluster 型链接的多边形由端点坐标决定，而端点未必属于
     * 真实 cluster，缺了会导致移动端点时缓存不失效。数值严格相等比较，无哈希碰撞风险。
     */
    function signatureChanged(clusters:ControlPoint[][], links:ControlPointLink[]|undefined){
        let i = 0
        let changed = false
        const put = (v:number)=>{
            if(sigBuf[i] !== v)
                changed = true
            sigBuf[i] = v
            i++
        }
        put(clusters.length)
        for(const c of clusters){
            put(c.length)
            for(const pt of c){
                put(pt.id)
                put(pt.pos[0])
                put(pt.pos[1])
                put(pt.dir ?? -1)
                put(saveStore.getLinesDecidedPtSize(pt.id))
            }
        }
        put(links?.length ?? 0)
        if(links){
            for(const l of links){
                put(l.pts[0])
                put(l.pts[1])
                put(l.type)
                // dot 连接不产生任何 cluster 多边形（伪集群与 cluster 型链接都排除它），端点位置无需入签名
                if(l.type === ControlPointLinkType.dot)
                    continue
                // 伪集群与 cluster 型链接的多边形由端点坐标决定，但端点未必属于真实 cluster，
                // 必须把端点的位置/方向/尺寸/站点状态写入签名，否则移动端点时缓存不失效
                for(const ptId of l.pts){
                    const pt = saveStore.getPtById(ptId)
                    put(pt?.pos[0] ?? 0)
                    put(pt?.pos[1] ?? 0)
                    put(pt?.dir ?? -1)
                    put(pt?.sta ?? -1)
                    put(pt ? saveStore.getLinesDecidedPtSize(pt.id) : 0)
                }
            }
        }
        if(i !== sigLen)
            changed = true
        sigLen = i
        return changed
    }

    function buildAllPolys(clusters:ControlPoint[][]){
        //伪集群：“点连接”的两端，若不属于集群，需要被涂成集群的样式
        //但需要排除类型为“dot”的点连接，dot连接需要保持原色，而dotCover需要涂色
        const fakeClusters = pointLinkStore.getLinkLinkedPts('excludeDot')
        for(const fakeCluster of fakeClusters){
            const pt = saveStore.getPtById(fakeCluster)
            if(!pt || pt.sta !== ControlPointSta.sta)
                continue
            if(clusters.some(c=>c.some(x=>x.id===fakeCluster)))
                continue
            clusters = [...clusters, [pt]]
        }
        const polys = clustersToPolys(clusters)
        const polysByLink = clustersToPolys(pointLinkStore.getClusterLinksPts(), 'asIs')
        polysByLink.forEach(p=>p.isFromLink=true)
        polys.push(...polysByLink)
        return polys
    }

    function getClusterOmitPadding(maxStaSize:number){
        // carpet 层绘制宽度最大：(ptStaSize + ptStaLineWidth) * size * 2
        const maxLineWidth = (cs.config.ptStaSize + cs.config.ptStaLineWidth) * maxStaSize * 2
        return maxLineWidth / 2
    }
    function isPolyOutsideView(p:ClusterPoly, left:number, right:number, top:number, bottom:number){
        const { cvsWidth, cvsHeight } = saveStore
        const padding = getClusterOmitPadding(p.maxStaSize)
        const [minX, maxX, minY, maxY] = p.bbox
        if((maxX + padding)/cvsWidth < left)
            return true
        if((minX - padding)/cvsWidth > right)
            return true
        if((maxY + padding)/cvsHeight < top)
            return true
        if((minY - padding)/cvsHeight > bottom)
            return true
        return false
    }

    function renderClusters(ctx:CvsContext, data:ClusterPoly[], 
        renderLayer:'carpet'|'body'|'core', transparentMode?:boolean, linkMark?:boolean
    ){
        const forEachPoly = (
            getLineWidth:(size:number)=>number,
            color:string,
            mustFill?:'mustFill'|false,
            filter?:(p:ClusterPoly)=>boolean
        )=>{
            for(const p of data){
                if(filter){
                    if(!filter(p))
                        continue
                }
                const w = getLineWidth(p.maxStaSize)
                if(!p.ill){
                    ctx.beginPath();
                    const firstPos = p.coords[0]
                    ctx.moveTo(...firstPos)
                    for(let i=1;i<p.coords.length;i++){
                        ctx.lineTo(p.coords[i][0], p.coords[i][1])
                    }
                    ctx.closePath()
                    ctx.lineWidth = w
                    ctx.strokeStyle = color
                    ctx.stroke()
                    if(mustFill){
                        ctx.fillStyle = color
                        ctx.fill()
                    }
                }else{
                    ctx.beginPath();
                    const firstPos = p.coords[0]
                    ctx.arc(...firstPos, w/2, 0, Math.PI*2)
                    ctx.fillStyle = color
                    ctx.fill()
                }
            }
        }
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        const bgColor = cs.config.bgColor;
        const exchangeColor = cs.config.ptStaExchangeLineColor;

        
        if(transparentMode){
            if(renderLayer != 'carpet'){
                return
            }
            ctx.globalAlpha = 0.7
            forEachPoly((size)=>{
                return (cs.config.ptStaSize + cs.config.ptStaLineWidth) * size * 2
            }, exchangeColor)
            ctx.globalAlpha = 1
            return
        }

        if(renderLayer == 'carpet'){
            forEachPoly((size)=>{
                return (cs.config.ptStaSize + cs.config.ptStaLineWidth) * size * 2
            }, bgColor)
        }
        else if(renderLayer == 'body'){
            forEachPoly((size) => {
                return ((cs.config.ptStaSize * 2) + cs.config.ptStaLineWidth) * size
            }, exchangeColor)
        }
        else{
            ctx.strokeStyle = cs.config.ptStaFillColor
            ctx.fillStyle = cs.config.ptStaFillColor
            forEachPoly((size) => {
                return ((cs.config.ptStaSize * 2) - cs.config.ptStaLineWidth) * size
            }, cs.config.ptStaFillColor, 'mustFill')
        }
        if(linkMark){
            forEachPoly((size)=>{
                return cs.config.ptStaLineWidth * size / 3
            }, '#ccc', false, p=>p.isFromLink??false)
        }
    }

    /**
     * 计算两个单位方向的角平分线方向（归一化）。
     * 当两方向反向（和接近零向量）时返回 undefined，避免退化。
     */
    function bisectorDir(u: Coord | undefined, v: Coord | undefined): Coord | undefined {
        if (!u || !v) return undefined
        const sum: Coord = [u[0] + v[0], u[1] + v[1]]
        const len = Math.hypot(sum[0], sum[1])
        if (isZero(len)) return undefined
        return [sum[0] / len, sum[1] / len]
    }

    function clustersToPolys(clusters:ControlPoint[][], asIs?:'asIs'):ClusterPoly[]{
        const polys:ClusterPoly[] = []
        clusters.forEach(c=>{
            const sizes = c.map(x=>saveStore.getLinesDecidedPtSize(x.id))
            if(sizes.length==0)
                return
            let poly:Coord[] = []
            const maxStaSize = Math.max(...sizes)
            const cacheKey = getClusterPolyCacheKey(c, asIs)
            const cached = clusterPolyCache.get(cacheKey)
            if(cached){
                polys.push(cached)
                return
            }
            if(asIs){
                poly = c.map(x=>x.pos)
            }
            else if(c.some(x=>x.free)){
                if(c.length === 2){
                    // 两点 cluster 特殊处理：不做最佳方向计算，直接用两点连线方向。
                    // 沿连线方向的 OBB 垂直宽度为 0，形成连接两点的窄矩形（线条）。
                    // 两点重合时 dir 为零向量，clusterToPolyAngle 回退轴对齐，退化为点（按圆形绘制）
                    const dir:Coord = [c[1].pos[0]-c[0].pos[0], c[1].pos[1]-c[0].pos[1]]
                    poly = clusterToPolyAngle(c, dir).poly
                }
                else{
                    const directions = c
                        .filter(x=>x.free)
                        .flatMap(x => {
                            const info = freePtDirectionStore.getPtDirectionInfo(x.id)
                            if (!info) return []
                            const bisector = bisectorDir(info.prev?.dir, info.next?.dir)
                            return bisector ? [...info.all, bisector] : [...info.all]
                        })
                    const best = directions.length > 0
                        ? clusterToPolyMinimumArea(c, directions)
                        : clusterToPolyVert(c)
                    poly = best.poly
                }
            }
            else{
                const vertCount = c.filter(x=>x.dir===ControlPointDir.vertical).length
                const incCount = c.filter(x=>x.dir===ControlPointDir.incline).length
                if(incCount===0){
                    const polyVert = clusterToPolyVert(c)
                    poly = polyVert.poly
                }
                else if(vertCount===0){
                    const polyInc = clusterToPolyInc(c)
                    poly = polyInc.poly
                }
                else{
                    const polyVert = clusterToPolyVert(c)
                    const polyInc = clusterToPolyInc(c)
                    if(polyInc.area < polyVert.area){
                        poly = polyInc.poly
                    }else{
                        poly = polyVert.poly
                    }
                }
            }
            const polyData:ClusterPoly = {
                coords:poly,
                maxStaSize,
                ill:isIllPosedPoly(poly),
                bbox:ptsBBox(c)
            }
            clusterPolyCache.set(cacheKey, polyData)
            polys.push(polyData)
        })
        return polys
    }
    function ptsBBox(c:ControlPoint[]):[number,number,number,number]{
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        for(const pt of c){
            const [x, y] = pt.pos
            if(x < minX) minX = x
            if(x > maxX) maxX = x
            if(y < minY) minY = y
            if(y > maxY) maxY = y
        }
        return [minX, maxX, minY, maxY]
    }
    function getClusterPolyCacheKey(c:ControlPoint[], asIs?:'asIs'){
        const parts = c.map(pt => `${pt.id}:${pt.pos[0]},${pt.pos[1]}:${pt.dir ?? ''}:${saveStore.getLinesDecidedPtSize(pt.id)}`)
        return `${parts.join('|')}|${asIs ?? ''}`
    }
    function isIllPosedPoly(poly:Coord[]){
        if(poly.length!=4)
            return false
        const xs = poly.map(x=>x[0])
        const ys = poly.map(x=>x[1])
        const xmin = Math.min(...xs)
        const xmax = Math.max(...xs)
        const ymin = Math.min(...ys)
        const ymax = Math.max(...ys)
        if(isZero(xmax-xmin) && isZero(ymax-ymin)){
            return true
        }
        return false
    }
    return {
        getClustersRenderingData, 
        renderClusters
    }
})
