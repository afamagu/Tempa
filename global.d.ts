import type { InterfaceLocale } from './i18n/config'
import type messages from './messages/en.json'

// next-intl strict typing: every t('…') key must exist in the English
// dictionary (the source of truth); every other dictionary is held to the
// same shape by i18n/request.ts (`satisfies`) and messages/messages.test.ts.
declare module 'next-intl' {
  interface AppConfig {
    Locale: InterfaceLocale
    Messages: typeof messages
  }
}
