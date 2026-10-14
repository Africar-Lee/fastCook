import { mediaMessages } from './messages-media.ts';
import { appMessages } from './messages-app.ts';
import { engineMessages } from './messages-engine.ts';
import { errorMessages } from './messages-errors.ts';
import { kitchenMessages } from './messages-kitchen.ts';
import { toolMessages } from './messages-tools.ts';

export type Locale = 'zh-CN' | 'en';
type Parameters = Readonly<Record<string, string | number>>;
export const messages: Readonly<Record<string, string>> = Object.freeze({ ...engineMessages, ...errorMessages, ...kitchenMessages, ...toolMessages, ...appMessages, ...mediaMessages });
const originalMessages = new Map(Object.entries(messages).filter(([key]) => !key.endsWith('::one')).map(([key, value]) => [value, key]));
const engineTemplates = Object.keys(engineMessages).filter(key => key.includes('{')).map(key => {
  const parameters = [...key.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]!);
  const pattern = key.split(/\{[a-zA-Z]+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)');
  return { key, parameters, pattern: new RegExp(`^${pattern}$`, 'u') };
});
let locale: Locale = 'zh-CN';
const listeners = new Set<() => void>();

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}

export function getLocale(): Locale { return locale; }

export function setLocale(value: Locale): void {
  if (!isLocale(value) || value === locale) return;
  locale = value;
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function t(message: string, parameters: Parameters = {}, language: Locale = locale): string {
  const key = Object.hasOwn(messages, message) ? message : originalMessages.get(message) ?? message;
  if (language === 'en' && !Object.hasOwn(messages, key)) {
    for (const template of engineTemplates) {
      const match = template.pattern.exec(message);
      if (match) return t(template.key, Object.fromEntries(template.parameters.map((name, index) => [name, match[index + 1]!])), language);
    }
  }
  const singular = parameters.count === 1 ? messages[`${key}::one`] : undefined;
  const translated = language === 'en' ? singular ?? messages[key] ?? message : key;
  return translated.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder);
}

export function formatList(items: readonly string[]): string {
  return items.join(locale === 'en' ? ', ' : '、');
}

export function formatDate(value: string | Date): string {
  return new Date(value).toLocaleString(locale === 'en' ? 'en-GB' : 'zh-CN');
}

export function localizedLabels<Key extends string>(labels: Readonly<Record<Key, string>>): Readonly<Record<Key, string>> {
  const descriptors = Object.fromEntries(Object.entries<string>(labels).map(([key, value]) => [key, {
    enumerable: true, get: () => t(value),
  }]));
  return Object.freeze(Object.defineProperties({}, descriptors)) as Readonly<Record<Key, string>>;
}
