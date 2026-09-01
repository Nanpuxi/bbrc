import { QuadCoord, RectCoord } from "aarc-core/models/coord"
import { CvsContext } from "aarc-core/models/cvs/common/cvsContext"

export function drawRect(ctx:CvsContext, rect:RectCoord, strokeColor?:string, lineWidth?:number){
    const [x, y] = rect[0]
    const [xr, yb] = rect[1]
    const w = xr - x
    const h = yb - y
    ctx.strokeStyle = strokeColor ?? 'black'
    ctx.lineWidth = lineWidth ?? 1.5
    ctx.strokeRect(x, y, w, h)
}

function traceQuadPath(ctx:CvsContext, quad:QuadCoord){
    ctx.beginPath()
    ctx.moveTo(quad[0][0], quad[0][1])
    for(let i=1;i<4;i++)
        ctx.lineTo(quad[i][0], quad[i][1])
    ctx.closePath()
}

export function drawQuad(ctx:CvsContext, quad:QuadCoord, strokeColor?:string, lineWidth?:number){
    ctx.strokeStyle = strokeColor ?? 'black'
    ctx.lineWidth = lineWidth ?? 1.5
    traceQuadPath(ctx, quad)
    ctx.stroke()
}

export function fillQuad(ctx:CvsContext, quad:QuadCoord, fillColor:string){
    ctx.fillStyle = fillColor
    traceQuadPath(ctx, quad)
    ctx.fill()
}