import React from 'react';
import { useTranslation } from 'react-i18next';

function LanguageSelector({ onLanguageChange, currentLanguage }) {
  const { t } = useTranslation();

  const languages = [
    { code: 'en', name: t('language.english', 'English'), flag: '🇺🇸', nativeName: 'English' },
    { code: 'hi', name: t('language.hindi', 'Hindi'), flag: '🇮🇳', nativeName: 'हिंदी' },
    { code: 'te', name: t('language.telugu', 'Telugu'), flag: '🇮🇳', nativeName: 'తెలుగు' },
    { code: 'ta', name: t('language.tamil', 'Tamil'), flag: '🇮🇳', nativeName: 'தமிழ்' },
    { code: 'mr', name: t('language.marathi', 'Marathi'), flag: '🇮🇳', nativeName: 'मराठी' },
    { code: 'ml', name: t('language.malayalam', 'Malayalam'), flag: '🇮🇳', nativeName: 'മലയാളം' },
    { code: 'kn', name: t('language.kannada', 'Kannada'), flag: '🇮🇳', nativeName: 'ಕನ್ನಡ' }
  ];

  return (
    <div className="relative">
      <label htmlFor="language-select" className="sr-only">
        {t('language.selector')}
      </label>
      <select
        id="language-select"
        value={currentLanguage}
        onChange={(e) => onLanguageChange(e.target.value)}
        className="appearance-none bg-white border border-gray-300 rounded-md px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.nativeName}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
        <svg
          className="w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
  );
}

export default LanguageSelector;