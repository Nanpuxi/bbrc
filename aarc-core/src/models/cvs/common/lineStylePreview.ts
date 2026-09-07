import { LineStyle } from "aarc-core/models/save"
import { strokeStyledLine } from "./strokeStyledLine"

/** 预览画布宽度（配置页内嵌预览与资源缩略图共用） */
export const lineStylePreviewCvsWidth = 400
/** 预览内容区高度：线路所在的横向条带高度；正方形缩略图中条带垂直居中，上下以白色填充 */
export const lineStylePreviewCvsHeight = 60

/**
 * 资源缩略图使用的固定动态色。
 * 必须固定：否则同一样式每次生成的缩略图 md5 不同，会产生垃圾文件。
 */
const previewResourceDynaColor = '#3399FF'

/**
 * 在给定 ctx 上绘制一条线路样式预览：白色背景 + 居中水平线。
 * 画布尺寸须为 lineStylePreviewCvsWidth × lineStylePreviewCvsHeight
 * （正方形缩略图请先自行 translate 到内容条带区域）。
 */
export function drawLineStylePreview(
    ctx: CanvasRenderingContext2D,
    lineStyle: LineStyle,
    dynaColor: string
){
    if(!lineStyle.layers)
        return
    const w = lineStylePreviewCvsWidth
    const h = lineStylePreviewCvsHeight
    const lrMargin = w/10
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, w, h)
    ctx.beginPath()
    ctx.moveTo(lrMargin, h/2)
    ctx.lineTo(w - lrMargin, h/2)
    strokeStyledLine(ctx, {
        lineStyle,
        lineWidthBase: h/3,
        dynaColor,
        fixedColorConverter: (c)=>c,
        baseCap: 'butt'
    })
}

/**
 * 静态渲染一次线路样式预览，输出正方形 webp Blob（作为 UserFile 缩略图）。
 * 内容条带垂直居中，上下多出的部分以白色填充；动态色固定，保证相同样式产出相同文件。
 */
export function renderLineStylePreviewBlob(lineStyle: LineStyle): Promise<Blob|null> {
    if(!lineStyle.layers || lineStyle.layers.length===0)
        return Promise.resolve(null)
    const size = lineStylePreviewCvsWidth
    const cvs = document.createElement('canvas')
    cvs.width = size
    cvs.height = size
    const ctx = cvs.getContext('2d')
    if(!ctx)
        return Promise.resolve(null)
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, size, size)
    ctx.translate(0, (size - lineStylePreviewCvsHeight)/2)
    drawLineStylePreview(ctx, lineStyle, previewResourceDynaColor)
    return new Promise(resolve => cvs.toBlob(b => resolve(b), 'image/webp'))
}
