import { DataSource } from "../save";

export function defaultDataSources(_getNewId:()=>number): DataSource[] {
    return [];
    // return [{
    //     id: getNewId(),
    //     name: '滨蜀颜色库',
    //     url: 'http://binshu.jowei19.com/colorsetsapi.json',
    //     type: 'colorSets',
    //     autoUpdate: true,
    //     overwriteSameName: true
    // }]
}