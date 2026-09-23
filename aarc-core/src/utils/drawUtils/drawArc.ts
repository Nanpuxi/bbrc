import { Coord, FormalRay, FreeRay, twinPts2Ray } from "aarc-core/models/coord";
import { makeCoordLength1 } from "../coordUtils/coordMath";
import { CvsContext } from "aarc-core/models/cvs/common/cvsContext";
import { formalArcGeometry, freeArcGeometry } from "./arcGeometry";

export function drawArcByThreePoints(
    ctx:CvsContext,
    a:Coord,
    b:Coord,
    c:Coord,
    mode:'formal'|'free' = 'formal'
){
    if(mode === 'free'){
        const ray0:FreeRay = {source:a, way:makeCoordLength1([b[0]-a[0], b[1]-a[1]])}
        const ray1:FreeRay = {source:c, way:makeCoordLength1([c[0]-b[0], c[1]-b[1]])}
        return drawArcByFreeRays(ctx, ray0, ray1)
    }
    const ray0 = twinPts2Ray(a, b)
    const ray1 = twinPts2Ray(b, c)
    ray1.source = c
    return drawArcByFormalRays(ctx, ray0, ray1)
}

export function drawArcByFormalRays(ctx:CvsContext, a:FormalRay, b:FormalRay, radius?:number){
    const geo = formalArcGeometry(a, b, radius)
    if(!geo){
        ctx.lineTo(...b.source)
        return
    }
    ctx.arc(...geo.center, geo.radius, geo.startAngle, geo.endAngle, geo.counterClockwise)
}

export function drawArcByFreeRays(ctx:CvsContext, a:FreeRay, b:FreeRay, radius?:number){
    const geo = freeArcGeometry(a, b, radius)
    if(!geo){
        ctx.lineTo(...b.source)
        return
    }
    ctx.arc(...geo.center, geo.radius, geo.startAngle, geo.endAngle, geo.counterClockwise)
}
