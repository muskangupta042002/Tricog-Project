import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Load translations from src/locales
import en from './locales/en.json';
import hi from './locales/hi.json';
import te from './locales/te.json';
import ta from './locales/ta.json';
import mr from './locales/mr.json';
import ml from './locales/ml.json';
import kn from './locales/kn.json';

const resources = {
  en: { translation: en },
  hi: { translation: hi },
  te: { translation: te },
  ta: { translation: ta },
  mr: { translation: mr },
  ml: { translation: ml },
  kn: { translation: kn },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    debug: process.env.NODE_ENV === 'development',
  });

export default i18n;