'use strict';
const nodemailer = require('nodemailer');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function appUrl() {
  return (process.env.APP_URL || 'https://ioms-garbage-goober.vercel.app').replace(/\/$/, '');
}

function fromAddress() {
  return process.env.SMTP_FROM || '"Garbage Goober" <no-reply@garbagegoober.de>';
}

/* ── Shared email shell ─────────────────────────────────────────────────── */
function emailShell({ headerIcon, headerBg, headerTitle, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${headerTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f4;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

        <!-- ── Header ── -->
        <tr>
          <td style="background:${headerBg};border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
            <div style="font-size:48px;margin-bottom:12px">${headerIcon}</div>
            <div style="color:#fff;font-size:22px;font-weight:700;letter-spacing:-0.3px">${headerTitle}</div>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#fff;padding:36px 40px;color:#333;font-size:15px;line-height:1.6;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#f4f6f4;border-top:1px solid #e0e0e0;padding:20px 40px;text-align:center;color:#999;font-size:12px;border-radius:0 0 12px 12px;">
            <strong style="color:#2E7D32">Garbage Goober</strong> &nbsp;·&nbsp; GWG Reutlingen Student Dormitory<br>
            <span style="font-size:11px">This is an automated message — please do not reply.</span>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function actionBtn(url, label) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
    <tr><td align="center">
      <a href="${url}"
         style="display:inline-block;padding:14px 36px;background:#2E7D32;color:#fff;
                text-decoration:none;font-weight:700;font-size:15px;border-radius:8px;
                letter-spacing:0.2px">
        ${label}
      </a>
    </td></tr>
  </table>`;
}

function fallbackLink(url) {
  return `<p style="margin-top:20px;padding:12px 16px;background:#f9f9f9;border-radius:6px;
                    border:1px solid #e8e8e8;font-size:12px;color:#666;word-break:break-all;">
    If the button doesn't work, paste this link into your browser:<br>
    <a href="${url}" style="color:#2E7D32">${url}</a>
  </p>`;
}

/* ── Email Verification ─────────────────────────────────────────────────── */
async function sendVerificationEmail(toEmail, toName, token) {
  const url = `${appUrl()}/verify-email?token=${token}`;
  const html = emailShell({
    headerIcon: '🗑️',
    headerBg: '#2E7D32',
    headerTitle: 'Verify your email address',
    bodyHtml: `
      <p style="margin-top:0">Hi <strong>${toName}</strong>,</p>
      <p>Welcome to <strong>Garbage Goober</strong> — the trash duty manager for GWG Reutlingen dormitory!</p>
      <p>To activate your account, please verify your email address by clicking the button below:</p>
      ${actionBtn(url, '✅ Verify my email')}
      <p style="font-size:13px;color:#888;margin-bottom:4px">
        ⏰ This link expires in <strong>24 hours</strong>.
      </p>
      <p style="font-size:13px;color:#888;margin-top:4px">
        If you did not create an account, you can safely ignore this email.
      </p>
      ${fallbackLink(url)}
    `,
  });

  await getTransporter().sendMail({
    from: fromAddress(),
    to: toEmail,
    subject: '✅ Verify your Garbage Goober account',
    html,
  });
}

/* ── Password Reset ─────────────────────────────────────────────────────── */
async function sendPasswordResetEmail(toEmail, toName, token) {
  const url = `${appUrl()}/reset-password?token=${token}`;
  const html = emailShell({
    headerIcon: '🔑',
    headerBg: '#1565C0',
    headerTitle: 'Password reset request',
    bodyHtml: `
      <p style="margin-top:0">Hi <strong>${toName}</strong>,</p>
      <p>We received a request to reset the password for your Garbage Goober account.</p>
      <p>Click the button below to choose a new password:</p>
      ${actionBtn(url, '🔑 Reset my password')}
      <p style="font-size:13px;color:#888;margin-bottom:4px">
        ⏰ This link expires in <strong>1 hour</strong>.
      </p>
      <p style="font-size:13px;color:#888;margin-top:4px">
        If you did not request a password reset, no action is needed — your password will not change.
      </p>
      ${fallbackLink(url)}
    `,
  });

  await getTransporter().sendMail({
    from: fromAddress(),
    to: toEmail,
    subject: '🔑 Reset your Garbage Goober password',
    html,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
