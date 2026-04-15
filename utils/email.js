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

const baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-width: 480px;
  margin: 0 auto;
  color: #333;
`;
const btnStyle = `
  display: inline-block;
  padding: 12px 28px;
  background: #2E7D32;
  color: #fff !important;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 700;
  font-size: 15px;
`;
const footerStyle = `
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #eee;
  color: #999;
  font-size: 12px;
`;

/* ── Email Verification ─────────────────────────────────────────────────── */
async function sendVerificationEmail(toEmail, toName, token) {
  const url = `${appUrl()}/verify-email?token=${token}`;
  await getTransporter().sendMail({
    from: fromAddress(),
    to: toEmail,
    subject: '✅ Verify your Garbage Goober account',
    html: `
      <div style="${baseStyle}">
        <h2 style="color:#2E7D32;margin-bottom:8px">Welcome, ${toName}! 👋</h2>
        <p>Thanks for signing up to <strong>Garbage Goober</strong> — the trash duty manager for GWG Reutlingen.</p>
        <p>Click the button below to verify your email address and activate your account:</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${url}" style="${btnStyle}">Verify my email</a>
        </p>
        <p style="color:#666;font-size:13px">
          This link expires in <strong>24 hours</strong>.<br>
          If you did not sign up, you can safely ignore this email.
        </p>
        <div style="${footerStyle}">Garbage Goober · GWG Reutlingen Student Dormitory</div>
      </div>
    `,
  });
}

/* ── Password Reset ─────────────────────────────────────────────────────── */
async function sendPasswordResetEmail(toEmail, toName, token) {
  const url = `${appUrl()}/reset-password?token=${token}`;
  await getTransporter().sendMail({
    from: fromAddress(),
    to: toEmail,
    subject: '🔑 Reset your Garbage Goober password',
    html: `
      <div style="${baseStyle}">
        <h2 style="color:#2E7D32;margin-bottom:8px">Password Reset</h2>
        <p>Hi ${toName},</p>
        <p>We received a request to reset your Garbage Goober password. Click the button below — the link is valid for <strong>1 hour</strong>.</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${url}" style="${btnStyle}">Reset my password</a>
        </p>
        <p style="color:#666;font-size:13px">
          If you did not request this, you can safely ignore this email. Your password will not change.
        </p>
        <div style="${footerStyle}">Garbage Goober · GWG Reutlingen Student Dormitory</div>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
