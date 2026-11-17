const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Экранирует пользовательский текст перед вставкой в HTML.
 * Yandex Maps интерпретирует balloonContent как HTML, поэтому значения
 * из поездки нельзя передавать туда без этой обработки.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}
