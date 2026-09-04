// 图标生成工作流：以 aarc-web/public 下拆分的背景/前景层 SVG 为源，
// 生成全部平台图标：macOS（squircle icns + 各档 png）、Windows（ico + Store 磁贴）、
// Android（adaptive icon 双层 + legacy）、iOS（AppIcon 全套，不透明满幅）。
// 用法：pnpm --filter aarc-tauri gen:icons
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import png2icons from 'png2icons'

const here = path.dirname(fileURLToPath(import.meta.url))
const iconsDir = path.resolve(here, '../src-tauri/icons')
const bgSrc = path.resolve(here, '../../aarc-web/public/aarc-logo-background.svg')
const fgSrc = path.resolve(here, '../../aarc-web/public/aarc-logo-foreground.svg')

// 从背景层提取渐变定义、从前景层提取 Λ 路径（两份源图结构固定，叠加即还原完整 logo）
const gradient = readFileSync(bgSrc, 'utf8').match(/<linearGradient[\s\S]*?<\/linearGradient>/)[0]
const lambdaPath = readFileSync(fgSrc, 'utf8').match(/\bd="([\s\S]*?)"/)[1]

const lambda = (fill = '#FFFFFF') => `<path fill="${fill}" d="${lambdaPath}"/>`

// 超椭圆（squircle）路径：macOS 图标形状的近似，n≈4.5；SVG 的 rx 圆角矩形无法表达连续曲率
const squirclePath = (n = 4.5, points = 96) => {
  const c = 127.5, r = 127.5, p = 2 / n
  const seg = []
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2
    const x = c + r * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** p
    const y = c + r * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** p
    seg.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return seg.join('') + 'Z'
}

// macOS：1024 画布，824 居中 squircle，Λ 与彩色区域比例同 fullbleed 原图
const macosSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
${gradient.replace('id="SVGID_1_"', 'id="bg"')}
<g transform="translate(100,100) scale(3.231372549019608)">
	<path d="${squirclePath()}" fill="url(#bg)"/>
	${lambda()}
</g>
</svg>`

// Android 前景层：透明底，Λ 缩至 85% 居中，保证落在 66dp 安全区内
const androidFgSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 255 255">
<g transform="translate(19.125,19.125) scale(0.85)">${lambda()}</g>
</svg>`

// Android 背景层：渐变满幅
const androidBgSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 255 255">
${gradient.replace('id="SVGID_1_"', 'id="bg"')}
<rect width="255" height="255" fill="url(#bg)"/>
</svg>`

// Android legacy（API < 26）：方版圆角矩形 + Λ 90%；圆版圆形 + Λ 78%
const legacySquareSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 255 255">
${gradient.replace('id="SVGID_1_"', 'id="bg"')}
<rect width="255" height="255" rx="26" fill="url(#bg)"/>
<g transform="translate(12.75,12.75) scale(0.9)">${lambda()}</g>
</svg>`

const legacyRoundSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 255 255">
${gradient.replace('id="SVGID_1_"', 'id="bg"')}
<circle cx="127.5" cy="127.5" r="127.5" fill="url(#bg)"/>
<g transform="translate(28.05,28.05) scale(0.78)">${lambda()}</g>
</svg>`

// 满幅版（背景层 + 前景层等比叠加，即还原 aarc-logo-fullbleed.svg）：
// 用于 Windows Store 磁贴与 iOS AppIcon（iOS 要求不透明、满幅，不得带 alpha）
const fullbleedSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 255 255">
${gradient.replace('id="SVGID_1_"', 'id="bg"')}
<rect width="255" height="255" fill="url(#bg)"/>
${lambda()}
</svg>`

const render = (svg, size) => sharp(Buffer.from(svg(size))).png().toBuffer()
const written = []
const write = (rel, buf) => {
  writeFileSync(path.join(iconsDir, rel), buf)
  written.push(rel)
}

// macOS / 桌面通用 png（squircle）
const mac1024 = await render(macosSvg, 1024)
for (const [rel, size] of [
  ['icon.png', 512],
  ['128x128@2x.png', 256],
  ['128x128.png', 128],
  ['64x64.png', 64],
  ['32x32.png', 32],
]) {
  write(rel, await sharp(mac1024).resize(size, size).png().toBuffer())
}

// macOS icns（png2icons 内部自行缩放并打包全部尺寸，无需 iconutil）
const icns = png2icons.createICNS(mac1024, png2icons.BICUBIC2, 0)
if (!icns) throw new Error('createICNS failed')
write('icon.icns', icns)

// Windows ico（同一 squircle 源）
const ico = png2icons.createICO(mac1024, png2icons.BICUBIC2, 0, true)
if (!ico) throw new Error('createICO failed')
write('icon.ico', ico)

// Android adaptive icon 前景/背景层（108dp 画布，各密度）
for (const [dpi, size] of [['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432]]) {
  write(`android/mipmap-${dpi}/ic_launcher_foreground.png`, await render(androidFgSvg, size))
  write(`android/mipmap-${dpi}/ic_launcher_background.png`, await render(androidBgSvg, size))
}

// Android legacy 图标（48dp，各密度）
for (const [dpi, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
  write(`android/mipmap-${dpi}/ic_launcher.png`, await render(legacySquareSvg, size))
  write(`android/mipmap-${dpi}/ic_launcher_round.png`, await render(legacyRoundSvg, size))
}

// Windows Store 磁贴（满幅）
for (const size of [30, 44, 71, 89, 107, 142, 150, 284, 310]) {
  write(`Square${size}x${size}Logo.png`, await render(fullbleedSvg, size))
}
write('StoreLogo.png', await render(fullbleedSvg, 50))

// iOS AppIcon（满幅；iOS/App Store 不允许 alpha，统一 removeAlpha）
const iosTargets = [
  ['AppIcon-20x20@1x.png', 20], ['AppIcon-20x20@2x.png', 40], ['AppIcon-20x20@2x-1.png', 40], ['AppIcon-20x20@3x.png', 60],
  ['AppIcon-29x29@1x.png', 29], ['AppIcon-29x29@2x.png', 58], ['AppIcon-29x29@2x-1.png', 58], ['AppIcon-29x29@3x.png', 87],
  ['AppIcon-40x40@1x.png', 40], ['AppIcon-40x40@2x.png', 80], ['AppIcon-40x40@2x-1.png', 80], ['AppIcon-40x40@3x.png', 120],
  ['AppIcon-60x60@2x.png', 120], ['AppIcon-60x60@3x.png', 180],
  ['AppIcon-76x76@1x.png', 76], ['AppIcon-76x76@2x.png', 152],
  ['AppIcon-83.5x83.5@2x.png', 167],
  ['AppIcon-512@2x.png', 1024],
]
const iosCache = new Map()
for (const [name, size] of iosTargets) {
  if (!iosCache.has(size)) {
    iosCache.set(size, await sharp(Buffer.from(fullbleedSvg(size))).removeAlpha().png().toBuffer())
  }
  write(`ios/${name}`, iosCache.get(size))
}

// adaptive icon 定义：背景固定引用渐变 mipmap（自愈，防止被 tauri icon 等工具改回纯色）
write('android/mipmap-anydpi-v26/ic_launcher.xml', Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  <background android:drawable="@mipmap/ic_launcher_background"/>
</adaptive-icon>`))

console.log(`已生成 ${written.length} 个文件：`)
for (const f of written) console.log(`  src-tauri/icons/${f}`)
