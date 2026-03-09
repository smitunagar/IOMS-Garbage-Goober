'use strict';
/**
 * Email notifications via Nodemailer.
 * Supports any SMTP provider (Gmail, Outlook, Brevo, etc.)
 *
 * Required env vars:
 *   SMTP_HOST   - e.g. smtp.gmail.com
 *   SMTP_PORT   - e.g. 587
 *   SMTP_USER   - e.g. your-app@gmail.com
 *   SMTP_PASS   - App password (Gmail: https://myaccount.google.com/apppasswords)
 *   SMTP_FROM   - Display name + address, e.g. "Garbage Goober <your-app@gmail.com>"
 */

const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  _transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || '587', 10),
    secure: parseInt(SMTP_PORT || '587', 10) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  return _transporter;
}

/**
 * Send a bin-full alert email to the duty person.
 * Silently skips if SMTP is not configured.
 */
async function sendBinAlertEmail({ toEmail, toName, binLabel, binEmoji, binColor, reporterName, floor, note }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[Mailer] SMTP not configured — skipping email notification.');
    return false;
  }

  const from = process.env.SMTP_FROM || `"Garbage Goober" <${process.env.SMTP_USER}>`;
  const noteRow = note
    ? `<tr><td style="padding:6px 0;color:#555;font-size:14px;">📝 <strong>Note:</strong> "${note}"</td></tr>`
    : '';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f0;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">

        <!-- Header -->
        <tr>
          <td style="background:${binColor};padding:28px 32px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">${binEmoji}</div>
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">Bin Full Alert</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Floor ${floor} · ${binLabel}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 16px;font-size:16px;color:#222;">Hey <strong>${toName}</strong> 👋</p>
            <p style="margin:0 0 20px;font-size:15px;color:#444;line-height:1.6;">
              You're on <strong>Trash Duty</strong> this week. Someone just reported that a bin is full and needs to be taken out.
            </p>

            <table width="100%" cellpadding="0" cellspacing="0"
                   style="background:#f8fdf8;border:1px solid #d4edda;border-radius:8px;padding:16px 20px;margin-bottom:20px;">
              <tr><td style="padding:4px 0;font-size:14px;color:#555;">
                <strong style="color:#222;">Bin type:</strong> &nbsp;${binEmoji} ${binLabel}
              </td></tr>
              <tr><td style="padding:4px 0;font-size:14px;color:#555;">
                <strong style="color:#222;">Floor:</strong> &nbsp;Floor ${floor}
              </td></tr>
              <tr><td style="padding:4px 0;font-size:14px;color:#555;">
                <strong style="color:#222;">Reported by:</strong> &nbsp;${reporterName}
              </td></tr>
              ${noteRow}
            </table>

            <p style="margin:0 0 24px;font-size:15px;color:#444;">
              Please take care of it as soon as possible. Thanks! 💪
            </p>

            <a href="https://ioms-garbage-goober.vercel.app/home"
               style="display:inline-block;background:#2E7D32;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">
              Open Garbage Goober →
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;border-top:1px solid #eee;text-align:center;">
            <p style="margin:0;font-size:12px;color:#999;">
              Garbage Goober – IOMS · GWG Reutlingen<br>
              You received this because you are on trash duty this week.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from,
      to: `"${toName}" <${toEmail}>`,
      subject: `🗑️ Bin Full – Floor ${floor}: ${binLabel} needs emptying`,
      html,
      text: `Hey ${toName},\n\nYou're on trash duty this week.\n${binEmoji} ${binLabel} bin on Floor ${floor} is full and needs to be taken out.\nReported by: ${reporterName}${note ? `\nNote: "${note}"` : ''}\n\nPlease take care of it soon!\n– Garbage Goober IOMS`,
    });
    console.log(`[Mailer] Bin alert sent to ${toEmail}`);
    return true;
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err.message);
    return false;
  }
}

module.exports = { sendBinAlertEmail };
