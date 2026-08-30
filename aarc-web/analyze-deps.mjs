// 依赖闭包完整性检查（prebuild）：从入口文件出发递归解析 import，
// 若存在无法解析的相对/别名 import 则以非零码退出，阻止构建。
// 用法:
//   node analyze-deps.mjs              # 仅检查，不写文件
//   node analyze-deps.mjs --out x.txt  # 检查并把闭包清单写入指定文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(SCRIPT_DIR, 'src');
const ENTRIES = [
  path.join(SRC_DIR, 'components/Cvs.vue'),
  path.join(SRC_DIR, 'components/Menu.vue'),
];

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

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) {
    base = path.join(SRC_DIR, spec.slice(2));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // 第三方包，跳过
  }
  for (const ext of TRY_EXTS) {
    if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) {
      return base + ext;
    }
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const idx of TRY_INDEX) {
      const p = path.join(base, idx);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
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
    const resolved = resolveImport(spec, norm);
    if (resolved) {
      if (!visited.has(path.normalize(resolved))) queue.push(resolved);
    } else if (spec.startsWith('@/') || spec.startsWith('./') || spec.startsWith('../')) {
      unresolved.push(`${spec}  (from ${path.relative(SRC_DIR, norm)})`);
    }
  }
}

if (outFile) {
  const result = [...visited]
    .map(f => path.relative(SRC_DIR, f).split(path.sep).join('/'))
    .sort();
  fs.writeFileSync(path.resolve(outFile), result.join('\n') + '\n', 'utf8');
  console.log(`闭包清单（${visited.size} 个文件）已写入 ${path.resolve(outFile)}`);
}

if (unresolved.length > 0) {
  console.error(`❌ 依赖闭包检查失败：${unresolved.length} 个 import 未能解析（已分析 ${visited.size} 个文件）:`);
  for (const u of unresolved) console.error('  ' + u);
  process.exit(1);
}
console.log(`✅ 依赖闭包检查通过（${visited.size} 个文件，无未解析 import）`);
