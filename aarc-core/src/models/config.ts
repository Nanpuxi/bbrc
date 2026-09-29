import { SgnNumber } from "./coord"

/**
 * 存档配置  
 * 约定：所有字段必填，不能可选，由 configDefault 来兜底
 * 必拥有所有字段的 configDefault 将被用来检查是否有多余字段
 */
export interface Config{
    bgColor: string,
    bgRefImage: BgRefImageConfig,

    lineWidth: number,
    lineCarpetWiden: number,
    lineTurnAreaRadius: number,
    lineWidthMapped: LineWidthMappedConfig
    lineExtensionHandleLengthVert: string,
    lineExtensionHandleLengthInc: string,

    ptBareSize: number,
    ptBareLineWidth: number,
    ptBareLineColor: string,
    ptBareLineColorSelected: string,
    ptStaSize: number,
    ptStaLineWidth: number,
    ptStaFillColor: string,
    ptStaExchangeLineColor: string,

    // TODO: 感觉这个应该收敛为统一结构的对象，什么时候闲写个upgrade
    staNameFontSize: number,
    staNameFont: string,
    staNameFontWeight: string,
    staNameFontStyle: string,
    staNameRowHeight: number,
    staNameColor: string,
    staNameSubFontSize: number,
    staNameSubFont: string,
    staNameSubFontWeight: string,
    staNameSubFontStyle: string,
    staNameSubRowHeight: number,
    staNameSubColor: string,
    staNameCarpet: StaNameCarpetConfig,

    gridMainLineColor: string,
    gridSubLineColor: string,

    clickPtThrs: number,
    clickLineThrs: number,

    cursorSize: number,
    cursorLineWidth: number,

    snapOctaClingPtPtDist: number,
    snapOctaClingPtNameDist: number,
    snapOctaRayPtPtThrs: number,
    snapOctaClingPtPtThrs: number,
    snapOctaClingPtNameThrs: number,
    snapOctaRayPtNameThrs: number,
    snapGridThrs: number,
    snapRayAngles: string[],
    snapRayAnglesForFree: string[],
    freePtClusterMode: FreePtClusterMode,

    colorPresetArea: string,
    colorPresetWater :string,
    colorPresetGreenland: string,
    colorPresetIsland: string

    textTagFont: string,
    textTagFontStyle: string,
    textTagFontWeight: string,
    textTagFontSizeBase: number,
    textTagFontColorHex: string,
    textTagRowHeightBase: number,
    textTagSubFont: string,
    textTagSubFontStyle: string,
    textTagSubFontWeight: string,
    textTagSubFontSizeBase: number,
    textTagSubFontColorHex: string,
    textTagSubRowHeightBase: number,
    textTagPlain:TextTagPerTypeGlobalConfig,
    textTagForLine:TextTagPerTypeGlobalConfig,
    textTagForLineDropCap:boolean
    textTagForLineDropCapDetect:'classic'|'loose'
    textTagForTerrain:TextTagPerTypeGlobalConfig

    pinyinConvert:PinyinConvertConfig

    configVersion:number
}
export type LineWidthMappedConfig = Record<string, {
    staSize?:number,
    staNameSize?:number,
    /** 副站名尺寸；0/undefined 时跟随上级（最终跟随 staNameSize 链路） */
    staNameSSize?:number,
    staSnapSize?:number,
    staNameSnapSize?:number
}|undefined>
/**
 * free 点（自由区间点）参与 cluster 生成的模式：
 * loose：目前行为，点的实际位置落在对方吸附点位的吸附阈值（snapOctaClingPtPtThrs）内即算入 cluster
 * strict：点的实际位置必须几乎精确落在对方吸附点位上（仅 epsilon 余量）才算入 cluster
 * off：free 点不参与 cluster 生成（任何情况下都不生成）
 */
export type FreePtClusterMode = 'loose' | 'strict' | 'off'
export type BgRefImageConfig = {
    url?: string,
    export?: boolean,
    opacity?: number,
    left?: number,
    right?: number,
    top?: number,
    bottom?: number,
    width?: number,
    height?: number,
}
export type TextTagPerTypeGlobalConfig = {
    padding?: number,
    fontSize?: number,
    subFontSize?: number,
    textAlign?: SgnNumber,
    anchorX?: SgnNumber,
    anchorY?: SgnNumber,
    width?: number,
    edgeAnchorOutsidePadding?: boolean
}
export type PinyinConvertConfig = {
    rules?:string,
    caseType?:number,
    variantType?:number,
    spaceBetweenChars?:boolean,
    /** 单字ü的写法（PinyinUStyle）；缺省 2（V，绿→lv） */
    uStyle?:number,
    /** 韵母üe的写法（PinyinUStyle）；缺省 0（U，略→lue） */
    ueStyle?:number
}
/**
 * 站名“地毯”（文字描边基底）配置，ControlPoint.nameCarpet 与全局 Config.staNameCarpet 共用。
 * 各字段为 undefined 时回退到默认行为：
 * width：倍率，默认 1（实际宽度 = staNameFontSize × 站名字号倍率 / 4 × width）
 * color：默认使用 bgColor
 * opacity：默认 0.8
 */
export type StaNameCarpetConfig = {
    width?: number,
    color?: string,
    opacity?: number
}

export type ConfigInSave = Partial<Config>