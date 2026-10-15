import { Coord, QuadCoord, RectCoord } from "aarc-core/models/coord";

function quadBoundingRectInternal(quad: QuadCoord): RectCoord {
    let leftX = quad[0][0], rightX = quad[0][0];
    let upperY = quad[0][1], lowerY = quad[0][1];
    for (let i = 1; i < 4; i++) {
        const [x, y] = quad[i];
        leftX = Math.min(leftX, x);
        rightX = Math.max(rightX, x);
        upperY = Math.min(upperY, y);
        lowerY = Math.max(lowerY, y);
    }
    return [[leftX, upperY], [rightX, lowerY]];
}

/** 判断点是否在矩形内部 */
export function rectInside(rect: RectCoord, pos: Coord) {
    const [x, y] = pos;
    const [[leftX, upperY], [rightX, lowerY]] = rect;
    return x >= leftX && x <= rightX && y <= lowerY && y >= upperY;
}

/** 判断点是否在凸四边形内部（先用轴对齐包围盒快速拒绝，再用叉积法精确判断） */
export function quadInside(quad: QuadCoord, pos: Coord) {
    // 防御：四边形含 NaN/Infinity 等异常值时无法参与命中（如空文本曾产生的退化四边形），
    // 视为不在内部并告警，避免异常四边形污染点击/框选检测
    for (const [qx, qy] of quad) {
        if (!Number.isFinite(qx) || !Number.isFinite(qy)) {
            console.warn('quadInside 收到异常四边形，已忽略本次命中检测：', quad);
            return false;
        }
    }
    const [x, y] = pos;
    const [[leftX, upperY], [rightX, lowerY]] = quadBoundingRectInternal(quad);
    if (x < leftX || x > rightX || y < upperY || y > lowerY) {
        return false;
    }
    // 叉积法：点应始终位于每条有向边的同一侧（凸四边形）
    let initialSign = 0;
    for (let i = 0; i < 4; i++) {
        const [x0, y0] = quad[i];
        const [x1, y1] = quad[(i + 1) % 4];
        const cross = (x1 - x0) * (y - y0) - (y1 - y0) * (x - x0);
        if (cross === 0) continue;
        if (initialSign === 0) {
            initialSign = cross > 0 ? 1 : -1;
        } else if ((cross > 0 ? 1 : -1) !== initialSign) {
            return false;
        }
    }
    return true;
}

/** 向四个方向扩大矩形 */
export function enlargeRect(rect: RectCoord, delta: number) {
    const [[leftX, upperY], [rightX, lowerY]] = rect;
    return [[leftX - delta, upperY - delta], [rightX + delta, lowerY + delta]] as RectCoord;
}

/** 向四个方向扩大矩形（按比例） */
export function enlargeRectBy(rect: RectCoord, pct: number) {
    const [[leftX, upperY], [rightX, lowerY]] = rect;
    const deltaX = (rightX - leftX) * pct;
    const deltaY = (lowerY - upperY) * pct;
    return [[leftX - deltaX, upperY - deltaY], [rightX + deltaX, lowerY + deltaY]] as RectCoord;
}

/** 判断“矩形和点的距离的平方”是否小于指定值 */
export function rectCoordDistSqLessThan(rect: RectCoord, pos: Coord, cmpSq: number) {
    const [x, y] = pos;
    const [[leftX, upperY], [rightX, lowerY]] = rect;

    // 如果点在矩形内部，距离为0
    if (x >= leftX && x <= rightX && y >= upperY && y <= lowerY) {
        return true;
    }

    // 计算点到矩形最近边的距离
    let closestX, closestY;

    // 找到最近的X坐标
    if (x < leftX) {
        closestX = leftX;
    } else if (x > rightX) {
        closestX = rightX;
    } else {
        closestX = x; // 点在矩形的X范围内
    }

    // 提前计算x差的平方，如果已经大于cmpSq则直接返回false
    const xDiffSq = (x - closestX) ** 2;
    if (xDiffSq > cmpSq) {
        return false;
    }

    // 找到最近的Y坐标
    if (y < upperY) {
        closestY = upperY;
    } else if (y > lowerY) {
        closestY = lowerY;
    } else {
        closestY = y; // 点在矩形的Y范围内
    }

    // 计算y差的平方并加上x差的平方
    const yDiffSq = (y - closestY) ** 2;
    const distSq = xDiffSq + yDiffSq;
    return distSq < cmpSq;
}

function segmentDistSq(pos: Coord, a: Coord, b: Coord): number {
    const [x, y] = pos;
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return (x - ax) ** 2 + (y - ay) ** 2;
    let t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    return (x - projX) ** 2 + (y - projY) ** 2;
}

/** 判断“四边形和点的距离的平方”是否小于指定值（先用包围盒快速拒绝，再精确计算到最近边的距离；点在内部时距离为 0） */
export function quadCoordDistSqLessThan(quad: QuadCoord, pos: Coord, cmpSq: number) {
    // 点在内部或边上时距离为 0
    if (quadInside(quad, pos)) return true;

    const [x, y] = pos;
    const [[leftX, upperY], [rightX, lowerY]] = quadBoundingRectInternal(quad);
    // 粗略排除：即使点距离包围盒最近点的距离平方都大于 cmpSq，则直接 false
    const closestX = x < leftX ? leftX : x > rightX ? rightX : x;
    const closestY = y < upperY ? upperY : y > lowerY ? lowerY : y;
    const xDiffSq = (x - closestX) ** 2;
    if (xDiffSq > cmpSq) return false;
    const yDiffSq = (y - closestY) ** 2;
    if (xDiffSq + yDiffSq > cmpSq) return false;

    // 精确计算到四条边的最小距离
    let minDistSq = Infinity;
    for (let i = 0; i < 4; i++) {
        const distSq = segmentDistSq(pos, quad[i], quad[(i + 1) % 4]);
        if (distSq < minDistSq) minDistSq = distSq;
        if (minDistSq < cmpSq) return true;
    }
    return minDistSq < cmpSq;
}

/** 将 RectCoord 转换为 QuadCoord（按左上、右上、右下、左下的顺序） */
export function rectToQuad(rect: RectCoord): QuadCoord {
    return [
        [rect[0][0], rect[0][1]],
        [rect[1][0], rect[0][1]],
        [rect[1][0], rect[1][1]],
        [rect[0][0], rect[1][1]],
    ];
}

/** 计算 QuadCoord 的轴对齐包围盒 */
export function quadBoundingRect(quad: QuadCoord): RectCoord {
    return quadBoundingRectInternal(quad);
}

/** 将矩形绕指定中心旋转指定角度，得到 QuadCoord */
export function rotateRectToQuad(rect: RectCoord, center: Coord, angle: number): QuadCoord {
    if (!angle) return rectToQuad(rect);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const corners: Coord[] = [
        [rect[0][0], rect[0][1]],
        [rect[1][0], rect[0][1]],
        [rect[1][0], rect[1][1]],
        [rect[0][0], rect[1][1]],
    ];
    return corners.map(([x, y]) => {
        const dx = x - center[0];
        const dy = y - center[1];
        return [center[0] + dx * cos - dy * sin, center[1] + dx * sin + dy * cos] as Coord;
    }) as QuadCoord;
}

/** 两个轴对齐矩形的轴对齐并集（包围盒） */
export function unionRect(a: RectCoord, b: RectCoord): RectCoord {
    return [
        [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
        [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
    ];
}

/** 把轴对齐矩形绕 center 做非等比缩放（sx 横向、sy 纵向），结果仍是轴对齐矩形 */
export function scaleRect(rect: RectCoord, center: Coord, sx: number, sy: number): RectCoord {
    const [cx, cy] = center;
    return [
        [cx + (rect[0][0] - cx) * sx, cy + (rect[0][1] - cy) * sy],
        [cx + (rect[1][0] - cx) * sx, cy + (rect[1][1] - cy) * sy],
    ];
}

/** 统一 RectCoord（绕 center 旋转 angle）与已是 QuadCoord 的输入为 QuadCoord */
export function toQuadCoord(rect: RectCoord | QuadCoord, center: Coord = [0, 0], angle: number = 0): QuadCoord {
    return rect.length === 4 ? rect : rotateRectToQuad(rect, center, angle);
}

/** 按各边法向向外平移 delta 扩大凸四边形（类似 enlargeRect），新顶点为相邻偏移边的交点 */
export function enlargeQuad(quad: QuadCoord, delta: number): QuadCoord {
    // 面积符号判断环绕方向（屏幕坐标系 y 向下，面积为正即顺时针）
    let area2 = 0;
    for (let i = 0; i < 4; i++) {
        const [x0, y0] = quad[i];
        const [x1, y1] = quad[(i + 1) % 4];
        area2 += x0 * y1 - x1 * y0;
    }
    const winding = area2 >= 0 ? 1 : -1;
    // 每条边向外偏移 delta：记录偏移后直线上一点、方向与单位外法向
    const offPts: Coord[] = [];
    const dirs: Coord[] = [];
    const normals: Coord[] = [];
    for (let i = 0; i < 4; i++) {
        const [x0, y0] = quad[i];
        const [x1, y1] = quad[(i + 1) % 4];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        // 顺时针（屏幕坐标）时外法向为 (dy, -dx)
        const nx = (dy / len) * winding;
        const ny = (-dx / len) * winding;
        normals.push([nx, ny]);
        offPts.push([x0 + nx * delta, y0 + ny * delta]);
        dirs.push([dx, dy]);
    }
    // 新顶点 = 相邻两条偏移边的交点
    const res: Coord[] = [];
    for (let i = 0; i < 4; i++) {
        const prev = (i + 3) % 4;
        const [px, py] = offPts[prev];
        const [pdx, pdy] = dirs[prev];
        const [qx, qy] = offPts[i];
        const [qdx, qdy] = dirs[i];
        const denom = pdx * qdy - pdy * qdx;
        if (Math.abs(denom) < 1e-12) {
            // 相邻边平行（退化），退化为顶点沿两法向之和偏移
            res.push([
                quad[i][0] + (normals[prev][0] + normals[i][0]) * delta,
                quad[i][1] + (normals[prev][1] + normals[i][1]) * delta,
            ]);
            continue;
        }
        const t = ((qx - px) * qdy - (qy - py) * qdx) / denom;
        res.push([px + t * pdx, py + t * pdy]);
    }
    return res as QuadCoord;
}