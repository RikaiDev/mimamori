/**
 * Message templates for DM notifications
 * Will be replaced by i18n module in Issue #7
 */

import type { Language } from '../config.js';

interface TemplateStrings {
  greeting: string;
  noticed: string;
  explanation: (issueType: string) => string;
  suggestionIntro: string;
  closing: string;
}

const templates: Record<Language, TemplateStrings> = {
  en: {
    greeting: "Hey there! I'm the workplace atmosphere helper.",
    noticed: 'I noticed your recent message in #{channelName} might make some colleagues feel uncomfortable.',
    explanation: (issueType) => {
      switch (issueType) {
        case 'discrimination':
          return "The message may come across as discriminatory, even if that wasn't your intention.";
        case 'harassment':
          return 'The tone of the message might feel like harassment to the recipient.';
        case 'bullying':
          return "The message might be perceived as bullying, even if you didn't mean it that way.";
        case 'inappropriate':
          return 'The message may not be appropriate for a professional workplace setting.';
        default:
          return 'The message might have a negative impact on team atmosphere.';
      }
    },
    suggestionIntro: 'Maybe try expressing it differently? Here\'s a thought:',
    closing: 'This is just a friendly reminder to help maintain a positive team atmosphere!',
  },
  ja: {
    greeting: 'こんにちは！職場の雰囲気サポーターです。',
    noticed: '#{channelName}での最近のメッセージについて、少し気になる点がありました。',
    explanation: (issueType) => {
      switch (issueType) {
        case 'discrimination':
          return '意図せず差別的に受け取られる可能性のある表現が含まれているかもしれません。';
        case 'harassment':
          return '受け取る側にとってハラスメントと感じられる可能性があります。';
        case 'bullying':
          return 'いじめのように受け取られる可能性があります。';
        case 'inappropriate':
          return '職場では適切でない表現かもしれません。';
        default:
          return 'チームの雰囲気に影響を与える可能性があります。';
      }
    },
    suggestionIntro: '別の表現を試してみてはいかがでしょうか：',
    closing: 'これは良いチーム環境を維持するためのフレンドリーなリマインダーです！',
  },
  'zh-TW': {
    greeting: '嗨！我是職場氛圍小幫手。',
    noticed: '我注意到你最近在 #{channelName} 的發言，可能會讓某些同事感到不太舒服。',
    explanation: (issueType) => {
      switch (issueType) {
        case 'discrimination':
          return '這則訊息可能會被解讀為有歧視意味，即使你並非有意如此。';
        case 'harassment':
          return '這則訊息的語氣可能讓收訊者感到被騷擾。';
        case 'bullying':
          return '這則訊息可能會被視為霸凌行為，即使你不是這個意思。';
        case 'inappropriate':
          return '這則訊息在專業職場環境中可能不太恰當。';
        default:
          return '這則訊息可能會對團隊氛圍產生負面影響。';
      }
    },
    suggestionIntro: '也許可以試試換個方式表達？例如：',
    closing: '這只是個友善提醒，希望能幫助團隊維持良好的溝通氛圍！',
  },
};

export function buildNotificationMessage(
  language: Language,
  channelName: string,
  issueType: string,
  suggestion?: string
): string {
  const t = templates[language];
  const parts: string[] = [];

  parts.push(t.greeting);
  parts.push('');
  parts.push(t.noticed.replace('{channelName}', channelName));
  parts.push('');
  parts.push(t.explanation(issueType));

  if (suggestion) {
    parts.push('');
    parts.push(t.suggestionIntro);
    parts.push(`> ${suggestion}`);
  }

  parts.push('');
  parts.push(t.closing);

  return parts.join('\n');
}
