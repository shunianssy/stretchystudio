/**
 * i18n 语言状态管理
 *
 * 使用 zustand 保存当前语言，并持久化到 localStorage。
 * 初始语言的解析顺序：本地存储 > 浏览器语言 > 英文（en）。
 */
import { create } from 'zustand';

/** localStorage 中保存语言偏好的键名 */
const STORAGE_KEY = 'stretchy_lang';

/** 支持的语言列表 */
export const SUPPORTED_LANGUAGES = ['en', 'zh'];

/** 语言展示名称（用于切换菜单） */
export const LANGUAGE_LABELS = {
  en: 'English',
  zh: '简体中文',
};

/**
 * 读取语言偏好，失败时回退到浏览器语言或英文。
 * 这里吞掉异常，避免在隐私模式等 localStorage 不可用的环境下崩溃。
 * @returns {'en' | 'zh'} 初始语言
 */
function resolveInitialLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch (error) {
    // localStorage 不可用（例如隐私模式），忽略并使用浏览器语言
  }

  const navLang = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return navLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const useLanguageStore = create((set) => ({
  /** 当前语言 */
  lang: resolveInitialLang(),

  /**
   * 切换语言并持久化。
   * 传入不支持的语言时直接忽略，避免污染状态。
   * @param {'en' | 'zh'} lang
   */
  setLang: (lang) => {
    if (!SUPPORTED_LANGUAGES.includes(lang)) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (error) {
      // 持久化失败不影响本次切换
    }
    set({ lang });
  },
}));
