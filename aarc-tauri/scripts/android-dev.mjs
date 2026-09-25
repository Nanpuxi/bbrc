// `tauri android dev` 包装：自动挑选与设备同网段的开发机 IPv4 并通过 --host 传给 CLI。
// 背景：CLI 在 Windows 上默认取"公网路由地址"，多网卡（Radmin VPN / VMware 等虚拟网卡）
// 时会选错，导致真机连不上 dev server（connection refused）。
import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'

const args = process.argv.slice(2)

function adb(...adbArgs) {
  return execFileSync('adb', adbArgs, { encoding: 'utf8' }).trim()
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

function sameSubnet(deviceIp, localIp, netmask) {
  if (!/^\d+(\.\d+){3}$/.test(netmask) || Number(netmask.split('.')[0]) < 8) return false
  const mask = ipv4ToInt(netmask)
  return (ipv4ToInt(deviceIp) & mask) >>> 0 === (ipv4ToInt(localIp) & mask) >>> 0
}

function listDevices() {
  const out = adb('devices')
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /\sdevice$/.test(line))
    .map((line) => line.split(/\s+/)[0])
}

// 同一台无线设备会被 TCP 串号和 mDNS 别名各识别一次，tauri 会卡在设备选择交互上；
// 保留可用串号、断开 mDNS 别名，并把重复项一并清掉
function dedupeDevices(serials) {
  const mdns = serials.filter((s) => /^adb-.*_adb-tls-connect\._tcp$/.test(s))
  const plain = serials.filter((s) => !mdns.includes(s))
  if (mdns.length && plain.length) {
    for (const s of mdns) {
      console.log(`[android-dev] disconnect 重复的 mDNS 设备: ${s}`)
      adb('disconnect', s)
    }
    return plain
  }
  // 只剩 mDNS 别名时保留它，后续用 adb shell 拿设备 IP
  return serials
}

// 优先 wlan0；拿不到再从全量 inet 地址里排除 lo/ap/rndis 取第一个
function deviceIp(serial) {
  const pick = (text) => {
    const m = text.match(/inet (\d+\.\d+\.\d+\.\d+)\/(\d+)/)
    return m ? { ip: m[1], prefix: Number(m[2]) } : null
  }
  try {
    const r = pick(adb('-s', serial, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'))
    if (r) return r
  } catch {}
  try {
    const lines = adb('-s', serial, 'shell', 'ip', '-f', 'inet', 'addr')
      .split('\n')
      .filter((l) => !/\b(lo|ap0|rndis|dummy|tun)\b/.test(l))
    for (const l of lines) {
      const r = pick(l)
      if (r) return r
    }
  } catch {}
  const m = serial.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/)
  return m ? { ip: m[1], prefix: 24 } : null
}

function localIPv4s() {
  const nets = os.networkInterfaces()
  const list = []
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) {
        list.push({ name, address: n.address, netmask: n.netmask })
      }
    }
  }
  return list
}

function resolveHost() {
  const serials = dedupeDevices(listDevices())
  if (!serials.length) return null
  if (serials.length > 1) {
    console.log(`[android-dev] 检测到多台设备（${serials.join(', ')}），交由 tauri 交互选择，跳过 --host 注入`)
    return null
  }
  const dev = deviceIp(serials[0])
  if (!dev) {
    console.log(`[android-dev] 无法获取设备 ${serials[0]} 的 IP，跳过 --host 注入`)
    return null
  }
  const netmask = prefixToNetmask(dev.prefix)
  const local = localIPv4s()
  const match = local.find((n) => sameSubnet(dev.ip, n.address, netmask))
  if (!match) {
    console.log(`[android-dev] 设备 IP ${dev.ip}/${dev.prefix} 与本机任一网卡都不在同网段：`)
    for (const n of local) console.log(`  - ${n.name} ${n.address}/${n.netmask}`)
    return null
  }
  console.log(`[android-dev] 设备 ${serials[0]} IP=${dev.ip}，选用本机网卡 "${match.name}" ${match.address}`)
  return match.address
}

function prefixToNetmask(prefix) {
  if (!(prefix >= 8 && prefix <= 32)) return '0.0.0.0'
  const bits = (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map((s) => (bits >>> s) & 255).join('.')
}

const explicitHostIdx = args.indexOf('--host')
let host
if (explicitHostIdx !== -1) {
  host = args[explicitHostIdx + 1]
  if (!host) {
    console.error('[android-dev] --host 需要跟一个地址')
    process.exit(1)
  }
} else {
  host = resolveHost() ?? undefined
}

const finalArgs = host && explicitHostIdx === -1 ? [...args, '--host', host] : args
console.log(`[android-dev] tauri android dev ${finalArgs.join(' ')}`)
const r = spawnSync('pnpm', ['exec', 'tauri', 'android', 'dev', ...finalArgs], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ADB_MDNS_AUTO_CONNECT: '0' },
})
process.exit(r.status ?? 1)
