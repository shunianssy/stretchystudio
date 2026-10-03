/**
 * 轻量级国际化（i18n）核心。
 *
 * 设计目标：
 * - 零依赖：不引入额外 npm 包，基于项目已有的 zustand 实现语言状态。
 * - 简单：仅提供 t()（非组件环境）与 useTranslation()（组件内）两个入口。
 * - 安全：缺失的键会回退到英文，再回退到键名本身，避免界面出现空白或报错。
 *
 * 用法（React 组件内）：
 *   const { t } = useTranslation();
 *   <button title={t('editor.topBar.newProject')}>…</button>
 *
 * 用法（非组件模块）：
 *   import { t } from '@/i18n';
 *   const message = t('io.export.failed');
 *
 * 插值：文案中使用 {name} 占位，调用时传入对象：
 *   t('timeline.clipCount', { count: 3 })  // "3 个片段"
 */
import { useCallback, useEffect } from 'react';
import { useLanguageStore, SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from './store';
import en from './locales/en';
import zh from './locales/zh';

/** 语言 -> 语言包 的映射表 */
const DICTIONARIES = { en, zh };

/** 英文作为兜底语言 */
const FALLBACK_LANG = 'en';

export { SUPPORTED_LANGUAGES, LANGUAGE_LABELS };
export { useLanguageStore };

/**
 * 按 "a.b.c" 路径读取嵌套对象中的字符串。
 * @param {object|undefined} dict 语言包
 * @param {string} key 点分路径
 * @returns {string|undefined}
 */
function lookup(dict, key) {
  if (!dict || !key) return undefined;
  return key.split('.').reduce((acc, part) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return acc[part];
  }, dict);
}

/**
 * 将 {name} 形式的占位符替换为实际值。
 * 未提供对应变量时保留原占位符，便于发现遗漏。
 * @param {string} template 文案模板
 * @param {Record<string, unknown>} [vars] 插值变量
 * @returns {string}
 */
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    vars[name] != null ? String(vars[name]) : match
  ));
}

/**
 * 翻译函数（纯函数，需显式传入语言）。
 * @param {'en' | 'zh'} lang 当前语言
 * @param {string} key 文案键
 * @param {Record<string, unknown>} [vars] 插值变量
 * @returns {string}
 */
export function translate(lang, key, vars) {
  if (!key) return '';
  const dict = DICTIONARIES[lang] ?? DICTIONARIES[FALLBACK_LANG];
  const value = lookup(dict, key)
    ?? lookup(DICTIONARIES[FALLBACK_LANG], key)
    ?? key;
  if (typeof value !== 'string') return key;
  return interpolate(value, vars);
}

/**
 * 非组件环境下的翻译函数，直接读取当前语言状态。
 * 注意：返回值不会随语言切换自动更新，仅用于事件回调、日志等一次性文案。
 * @param {string} key 文案键
 * @param {Record<string, unknown>} [vars] 插值变量
 * @returns {string}
 */
export function t(key, vars) {
  return translate(useLanguageStore.getState().lang, key, vars);
}

/**
 * React Hook：订阅语言变化并返回翻译函数。
 * @returns {{ t: (key: string, vars?: Record<string, unknown>) => string, lang: string, setLang: (lang: string) => void }}
 */
export function useTranslation() {
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);

  const translateFn = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  return { t: translateFn, lang, setLang };
}

/**
 * 同步语言到 DOM：<html lang> 与 document.title。
 * 在根组件调用一次即可。
 */
export function useLanguageEffect() {
  const lang = useLanguageStore((s) => s.lang);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    const title = translate(lang, 'common.appTitle');
    if (title && title !== 'common.appTitle') {
      document.title = title;
    }
  }, [lang]);
}
