/**
 * Deterministic detection of an explicit payment confirmation / cancellation in the student's message.
 * This is deliberately NOT left to the LLM: a question such as "Can I pay $500?" must never count as consent.
 */
const AFFIRMATIVE =
  /\b(yes|yep|yeah|y|confirm|confirmed|ok|okay|sure|proceed|approve|approved|go ahead|do it|pay it|evet|onayl[ıi]yorum|onaylar[ıi]m|onay|tamam|olur|devam|kabul)\b/i;
const NEGATIVE =
  /\b(no|not|don't|dont|do not|cancel|stop|wait|never|hay[ıi]r|iptal|vazge[çc]|de[ğg]il|dur|bekle|istemiyorum)\b/i;
const CHANGES_SOMETHING = /\d|\b(but|instead|however|only|ama|yerine|fakat|sadece)\b/i;

export function isExplicitConfirmation(message: string): boolean {
  const text = message.trim();
  if (!text || text.includes("?")) return false;
  if (text.split(/\s+/).length > 8) return false;
  if (NEGATIVE.test(text) || CHANGES_SOMETHING.test(text)) return false;
  return AFFIRMATIVE.test(text);
}

export function isCancellation(message: string): boolean {
  const text = message.trim();
  return /\b(cancel|never ?mind|stop|don't|do not|no|hay[ıi]r|iptal|vazge[çc]|istemiyorum)\b/i.test(text) && text.split(/\s+/).length <= 10;
}

export function detectLanguage(message: string, previous: "en" | "tr" = "en"): "en" | "tr" {
  if (/[çğıöşüÇĞİÖŞÜ]/.test(message)) return "tr";
  if (/\b(merhaba|selam|bakiye|bakiyem|ödeme|öde|harç|harcım|nedir|kaç|ne zaman|evet|hayır|taksit|iade|lütfen|yapabilir)\b/i.test(message)) return "tr";
  if (/\b(the|what|when|can|how|my|please|balance|pay|tuition|refund)\b/i.test(message)) return "en";
  return previous;
}
