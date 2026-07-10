// i18n scaffolding (#49, PK-market fit). Founder call: English-first launch with
// i18n scaffolding + Urdu (ur) seeded for a few high-traffic strings, rather than
// pulling in next-intl and extracting all ~30 screens now. This is a dependency-free
// dictionary + a tiny t() lookup so the wiring exists and Urdu/RTL can be verified
// end-to-end; remaining copy stays English and is added key-by-key over time.
//
// Keys are dotted namespaces. Missing keys fall back to the key's English value,
// then to the key itself, so a partial Urdu dictionary can never blank the UI.

export const LOCALES = ["en", "ur"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Locales that render right-to-left. Drives `dir` on <html> and logical layout. */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ur"]);

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function isLocale(value: string | null | undefined): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}

/** Human label for a locale, in its own script (for the switcher). */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ur: "اردو",
};

type Dict = Record<string, string>;

// English is the source of truth / fallback. Urdu is seeded for the highest-value
// nav + storefront strings; add keys here as screens are localized.
const en: Dict = {
  "nav.orders": "Orders",
  "nav.search": "Search",
  "nav.cart": "Cart",
  "nav.account": "Account",
  "nav.signIn": "Sign in",
  "common.reconnecting": "Reconnecting…",
  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.viewCart": "View cart",
  "home.title": "Restaurants near you",
  "home.searchPlaceholder": "Search restaurants or dishes",
  "restaurant.reviews": "reviews",
  "restaurant.minOrder": "Min",
  "restaurant.delivery": "Delivery",
  "restaurant.popular": "Popular",
  "cart.empty": "Your cart is empty",
  "cart.checkout": "Checkout",
  "a11y.openMenu": "Open menu",
  "a11y.account": "Account",
  "a11y.viewCartItems": "View cart",
};

const ur: Dict = {
  "nav.orders": "آرڈرز",
  "nav.search": "تلاش",
  "nav.cart": "ٹوکری",
  "nav.account": "اکاؤنٹ",
  "nav.signIn": "سائن ان",
  "common.reconnecting": "دوبارہ رابطہ ہو رہا ہے…",
  "common.loading": "لوڈ ہو رہا ہے…",
  "common.retry": "دوبارہ کوشش کریں",
  "common.viewCart": "ٹوکری دیکھیں",
  "home.title": "آپ کے قریب ریستوران",
  "home.searchPlaceholder": "ریستوران یا کھانے تلاش کریں",
  "restaurant.reviews": "جائزے",
  "restaurant.minOrder": "کم از کم",
  "restaurant.delivery": "ڈیلیوری",
  "restaurant.popular": "مقبول",
  "cart.empty": "آپ کی ٹوکری خالی ہے",
  "cart.checkout": "چیک آؤٹ",
  "a11y.openMenu": "مینو کھولیں",
  "a11y.account": "اکاؤنٹ",
  "a11y.viewCartItems": "ٹوکری دیکھیں",
};

export const DICTIONARIES: Record<Locale, Dict> = { en, ur };

/** Translate a key for a locale, falling back to English then the key itself. */
export function translate(locale: Locale, key: string): string {
  return DICTIONARIES[locale]?.[key] ?? DICTIONARIES.en[key] ?? key;
}
