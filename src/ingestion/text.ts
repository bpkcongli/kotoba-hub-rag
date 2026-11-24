import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import { IngestionError } from '@/ingestion/types';

const excluded = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'template',
  'noscript',
  'svg',
  'math',
]);

const blocks = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'tr',
  'h1',
  'h2',
  'h3',
  'h4',
  'blockquote',
  'section',
]);

export function normalizeText(raw: string, unicode: 'NONE' | 'NFC'): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return unicode === 'NFC' ? text.normalize('NFC') : text;
}

export function htmlToText(html: string, unicode: 'NONE' | 'NFC'): string {
  if (html.length > 128 * 1024) {
    throw new IngestionError('INVALID_SOURCE');
  }

  const root = parseFragment(html, { scriptingEnabled: false });

  const visit = (node: DefaultTreeAdapterMap['node'], depth: number): string => {
    if (depth > 128) {
      throw new IngestionError('INVALID_SOURCE');
    }

    if ('tagName' in node && excluded.has(node.tagName)) {
      return '';
    }

    if ('value' in node) {
      return node.value;
    }

    if (!('childNodes' in node)) {
      return '';
    }

    const text = node.childNodes.map((child) => visit(child, depth + 1)).join('');

    if ('tagName' in node) {
      if (node.tagName === 'br') {
        return '\n';
      }

      if (node.tagName === 'rt') {
        return `(${text})`;
      }

      if (node.tagName === 'rp') {
        return '';
      }

      if (node.tagName === 'td' || node.tagName === 'th') {
        return `${text}\t`;
      }

      if (blocks.has(node.tagName)) {
        return `\n${text}\n`;
      }
    }

    return text;
  };

  return normalizeText(visit(root, 0), unicode);
}
