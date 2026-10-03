/**
 * i18n 语言包键一致性校验脚本
 *
 * 作用：对比 `src/i18n/locales/en` 与 `src/i18n/locales/zh` 下同名命名空间的键结构，
 *       发现缺失/多余的键（键不一致会导致中文模式下回退到英文）。
 *
 * 用法：node scripts/verify_i18n_keys.mjs
 * 退出码：0 = 全部一致；1 = 存在不一致（可用于 CI / 提交前检查）
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../src/i18n/locales');

/**
 * 把嵌套对象拍平成 "a.b.c" 形式的键列表。
 * @param {object} obj 语言包对象
 * @param {string} [prefix] 键前缀
 * @returns {string[]} 拍平后的键列表
 */
function flattenKeys(obj, prefix = '') {
  if (obj == null || typeof obj !== 'object') return [];
  return Object.entries(obj).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return value != null && typeof value === 'object'
      ? flattenKeys(value, next)
      : [next];
  });
}

/**
 * 动态导入某个命名空间语言包；文件不存在时返回空对象。
 * @param {string} lang 语言代码
 * @param {string} file 文件名（含扩展名）
 * @returns {Promise<object>}
 */
async function loadNamespace(lang, file) {
  const abs = path.join(LOCALES_DIR, lang, file);
  try {
    const mod = await import(pathToFileURL(abs).href);
    return mod.default ?? {};
  } catch (error) {
    console.error(`[verify-i18n] 无法加载 ${lang}/${file}: ${error.message}`);
    return {};
  }
}

async function main() {
  const enDir = path.join(LOCALES_DIR, 'en');
  const files = (await readdir(enDir))
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort();

  let mismatchCount = 0;

  for (const file of files) {
    const en = await loadNamespace('en', file);
    const zh = await loadNamespace('zh', file);

    const enKeys = new Set(flattenKeys(en));
    const zhKeys = new Set(flattenKeys(zh));

    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));

    if (missingInZh.length === 0 && missingInEn.length === 0) {
      console.log(`✓ ${file}  (${enKeys.size} 个键，一致)`);
      continue;
    }

    mismatchCount += 1;
    console.warn(`✗ ${file} 键不一致：`);
    if (missingInZh.length) {
      console.warn(`  中文缺失 ${missingInZh.length} 个：${missingInZh.slice(0, 20).join(', ')}${missingInZh.length > 20 ? ' …' : ''}`);
    }
    if (missingInEn.length) {
      console.warn(`  英文缺失 ${missingInEn.length} 个：${missingInEn.slice(0, 20).join(', ')}${missingInEn.length > 20 ? ' …' : ''}`);
    }
  }

  if (mismatchCount > 0) {
    console.error(`\n[verify-i18n] 共 ${mismatchCount} 个命名空间存在键不一致。`);
    process.exit(1);
  }
  console.log('\n[verify-i18n] 所有语言包键结构一致。');
}

main().catch((error) => {
  console.error('[verify-i18n] 校验失败：', error);
  process.exit(1);
});
