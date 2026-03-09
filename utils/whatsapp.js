'use strict';
/**
 * WhatsApp notification via CallMeBot (free, no subscription required).
 *
 * Each user self-registers:
 *  1. Save "+49 XXXXXXXXXXX" as a contact named "CallMeBot"
 *  2. Send "I allow callmebot to send me messages" to +34 644 64 21 21
 *  3. CallMeBot replies with your personal API key
 *  4. Enter phone + API key in Garbage Goober Settings
 *
 * API endpoint: GET https://api.callmebot.com/whatsapp.php?phone=PHONE&text=TEXT&apikey=KEY
 */

const https = require('https');

/**
 * Send a WhatsApp message to a single recipient.
 * @param {string} phone    - International format, digits + optional '+', e.g. "+4917612345678"
 * @param {string} apiKey   - CallMeBot API key for this phone number
 * @param {string} text     - Message text (will be URL-encoded)
 * @returns {Promise<boolean>} - Resolves true on success, false on failure (never throws)
 */
async function sendWhatsApp(phone, apiKey, text) {
  if (!phone || !apiKey || !text) return false;

  // Normalise phone: remove spaces/dashes, ensure no leading zeros after country code
  const cleanPhone = phone.replace(/[\s\-()]/g, '');

  const encodedText = encodeURIComponent(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cleanPhone)}&text=${encodedText}&apikey=${encodeURIComponent(apiKey)}`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const ok = res.statusCode === 200 && body.toLowerCase().includes('message queued');
        if (!ok) {
          console.warn(`[WhatsApp] Delivery issue (${res.statusCode}): ${body.slice(0, 120)}`);
        }
        resolve(ok);
      });
    }).on('error', (err) => {
      console.error('[WhatsApp] Request error:', err.message);
      resolve(false);
    });
  });
}

/**
 * Build and send a bin-full alert to the duty person.
 * @param {object} params
 * @param {string} params.dutyName        - Name of the duty person
 * @param {string} params.phone           - Their phone number
 * @param {string} params.apiKey          - Their CallMeBot API key
 * @param {string} params.binLabel        - Bin type label (e.g. "Restmüll")
 * @param {string} params.binEmoji        - Emoji for the bin (e.g. "🗑️")
 * @param {string} params.reporterName    - Name of the person who reported
 * @param {number} params.floor           - Floor number
 * @param {string} [params.note]          - Optional note from reporter
 * @returns {Promise<boolean>}
 */
async function sendBinAlert({ dutyName, phone, apiKey, binLabel, binEmoji, reporterName, floor, note }) {
  const noteStr = note ? `\n📝 Note: "${note}"` : '';
  const message =
    `🗑️ *Bin Full Alert – Floor ${floor}*\n\n` +
    `Hey ${dutyName}! You're on trash duty this week.\n\n` +
    `${binEmoji} *${binLabel}* bin is full and needs to be taken out.\n` +
    `📢 Reported by: ${reporterName}${noteStr}\n\n` +
    `Please take care of it as soon as possible. Thanks! 💪\n` +
    `– Garbage Goober IOMS`;

  return sendWhatsApp(phone, apiKey, message);
}

module.exports = { sendWhatsApp, sendBinAlert };
