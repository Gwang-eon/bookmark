const LOCALE_MAP = { ko: "ko-KR", en: "en-US", ja: "ja-JP" };

export function msg(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function getLocale() {
  const lang = chrome.i18n.getUILanguage().split("-")[0];
  return LOCALE_MAP[lang] || "ko-KR";
}

export function localizeHtml() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const translated = msg(el.dataset.i18n);
    if (translated) {
      el.textContent = translated;
    }
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const translated = msg(el.dataset.i18nPlaceholder);
    if (translated) {
      el.placeholder = translated;
    }
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    const translated = msg(el.dataset.i18nTitle);
    if (translated) {
      el.title = translated;
    }
  }
}

export function getBucketDisplayName(bucket) {
  const map = { high: msg("bucket_high"), medium: msg("bucket_medium"), low: msg("bucket_low") };
  return map[bucket] || bucket;
}

export function getBucketCssClass(bucket) {
  return bucket;
}
