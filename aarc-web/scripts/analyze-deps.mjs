// 依赖闭包完整性检查（prebuild）：从 aarc-core 入口文件出发递归解析 import，
// 若存在无法解析的 import、或 core 文件 import 逃逸到 aarc-core/src 之外
// （单向依赖：web → core 允许，core → web 禁止），则以非零码退出，阻止构建。
// 用法:
//   node scripts/analyze-deps.mjs              # 仅检查，不写文件
//   node scripts/analyze-deps.mjs --out x.txt  # 检查并把闭包清单写入指定文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CORE_SRC_DIR = path.resolve(SCRIPT_DIR, '../../aarc-core/src');
const ENTRIES = [
  path.join(CORE_SRC_DIR, 'components/Cvs.vue'),
  path.join(CORE_SRC_DIR, 'components/Menu.vue'),
];

// 单元测试也作为入口：core 的测试依赖必须全部自给自足
function collectTestEntries(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectTestEntries(p);
    else if (e.isFile()) ENTRIES.push(p);
  }
}
collectTestEntries(path.join(CORE_SRC_DIR, 'tests'));

// 解析 --out 参数（--out file 或 --out=file），默认不写文件
function parseOutFile(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') return argv[i + 1] ?? null;
    if (argv[i].startsWith('--out=')) return argv[i].slice('--out='.length);
  }
  return null;
}
const outFile = parseOutFile(process.argv.slice(2));

// 匹配静态 import / export ... from / 动态 import()
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const TRY_EXTS = ['', '.ts', '.vue', '.js', '.tsx', '.jsx', '.mjs', '.json'];
const TRY_INDEX = ['index.ts', 'index.vue', 'index.js'];

// 返回 { file } 解析成功 / { escape: true } 解析成功但逃逸出 core / null 无法解析或第三方包
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('aarc-core/')) {
    base = path.join(CORE_SRC_DIR, spec.slice('aarc-core/'.length));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else if (spec.startsWith('@/') || spec.startsWith('aarc-web')) {
    return { escape: true }; // core 内禁止 @/ 别名与 aarc-web 引用
  } else {
    return null; // 第三方包，跳过
  }
  for (const ext of TRY_EXTS) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) {
      const resolved = base + ext;
      return isInsideCore(resolved) ? { file: resolved } : { escape: true };
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const idx of TRY_INDEX) {
      const p = path.join(base, idx);
      if (fs.existsSync(p)) {
        return isInsideCore(p) ? { file: p } : { escape: true };
      }
    }
  }
  return null;
}

function isInsideCore(p) {
  const rel = path.relative(CORE_SRC_DIR, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const missingEntries = ENTRIES.filter(f => !fs.existsSync(f));
if (missingEntries.length > 0) {
  console.error('❌ 入口文件不存在:');
  for (const f of missingEntries) console.error('  ' + f);
  process.exit(1);
}

const visited = new Set();
const queue = [...ENTRIES];
const unresolved = [];
const escaped = [];

while (queue.length > 0) {
  const file = queue.shift();
  const norm = path.normalize(file);
  if (visited.has(norm)) continue;
  visited.add(norm);

  let content;
  try {
    content = fs.readFileSync(norm, 'utf8');
  } catch {
    continue; // 非文本资源（如 svg/png），无需继续递归
  }

  for (const m of content.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const r = resolveImport(spec, norm);
    if (r?.escape) {
      escaped.push(`${spec}  (from ${path.relative(CORE_SRC_DIR, norm)})`);
    } else if (r?.file) {
      const rn = path.normalize(r.file);
      if (!visited.has(rn)) queue.push(rn);
    } else if (spec.startsWith('aarc-core/') || spec.startsWith('./') || spec.startsWith('../')) {
      unresolved.push(`${spec}  (from ${path.relative(CORE_SRC_DIR, norm)})`);
    }
  }
}

if (outFile) {
  const result = [...visited]
    .map(f => path.relative(CORE_SRC_DIR, f).split(path.sep).join('/'))
    .sort();
  fs.writeFileSync(path.resolve(outFile), result.join('\n') + '\n', 'utf8');
  console.log(`闭包清单（${visited.size} 个文件）已写入 ${path.resolve(outFile)}`);
}

let failed = false;
if (escaped.length > 0) {
  console.error(`❌ 单向依赖违规：${escaped.length} 个 import 逃逸出 aarc-core（core → web 方向禁止）:`);
  for (const u of escaped) console.error('  ' + u);
  failed = true;
}
if (unresolved.length > 0) {
  console.error(`❌ 依赖闭包检查失败：${unresolved.length} 个 import 未能解析（已分析 ${visited.size} 个文件）:`);
  for (const u of unresolved) console.error('  ' + u);
  failed = true;
}
if (failed) process.exit(1);
console.log(`✅ 依赖闭包检查通过（${visited.size} 个文件，无未解析 import，无 core → web 逃逸）`);
