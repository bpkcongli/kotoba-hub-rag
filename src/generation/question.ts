import type { GeneratedPracticeSession } from '@/contracts/v1.generated';

// CON-01 domain refinements mirrored from AiServiceImpl; keep compatibility tests against app.
export function validQuestion(
  question: GeneratedPracticeSession['questions'][number],
  locale: 'en' | 'id',
): boolean {
  const japanese = (text: string) =>
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text) && !/[<>]/u.test(text);

  const latinSentence = (text: string) =>
    /[a-z]/iu.test(text) &&
    !/[\r\n]|[.!?]\s+\S/u.test(text) &&
    !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}<>]/u.test(text);

  if (question.questionType === 'SHORT_FREE_RESPONSE' || question.questionType === 'SLOT_FILL') {
    if (
      (question.promptPayload.sentenceTemplate.match(/___/g) ?? []).length !== 1 ||
      !japanese(question.promptPayload.sentenceTemplate)
    ) {
      return false;
    }

    if (question.questionType === 'SHORT_FREE_RESPONSE') {
      return question.expectedAnswer.acceptedTextAnswers.every(
        (text) =>
          /^[\u3040-\u30ffー\s・]+$/u.test(text) && /[\u3041-\u3096\u30a1-\u30fa]/u.test(text),
      );
    }

    const options = question.promptPayload.options;

    return (
      new Set(options.map((option) => option.id)).size === 4 &&
      new Set(options.map((option) => option.label.normalize('NFKC').trim())).size === 4 &&
      options.every((option) => japanese(option.label)) &&
      options.some((option) => option.id === question.expectedAnswer.correctOptionId)
    );
  }

  if (question.questionType === 'ARRANGE_TOKEN') {
    const prompt = question.promptPayload;
    const toJa = prompt.direction === 'EN_TO_JA' || prompt.direction === 'ID_TO_JA';
    const sourceLanguage = locale === 'id' ? 'ID' : 'EN';
    const ids = prompt.arrangeTokens.map((token) => token.id);

    return (
      prompt.direction === (toJa ? `${sourceLanguage}_TO_JA` : `JA_TO_${sourceLanguage}`) &&
      prompt.promptLanguage === (toJa ? sourceLanguage : 'JA') &&
      prompt.answerLanguage === (toJa ? 'JA' : sourceLanguage) &&
      (toJa ? latinSentence(prompt.sourceSentence) : japanese(prompt.sourceSentence)) &&
      prompt.arrangeTokens.every((token) =>
        toJa
          ? japanese(token.label) || /^[。、！？!?]$/u.test(token.label)
          : latinSentence(token.label) || /^[0-9.,!?;:'"()—–“”‘’-]+$/u.test(token.label),
      ) &&
      new Set(ids).size === ids.length &&
      question.expectedAnswer.acceptedTokenOrders.every(
        (order) =>
          order.length === ids.length &&
          new Set(order).size === ids.length &&
          order.every((id) => ids.includes(id)),
      )
    );
  }

  return (
    question.promptPayload.promptLanguage === (locale === 'id' ? 'ID' : 'EN') &&
    latinSentence(question.promptPayload.sourceSentence) &&
    japanese(question.expectedAnswer.referenceAnswer)
  );
}
