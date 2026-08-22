// SendGrid email helper for OTP verification (Sales Manager backend).
// Mirrors the Sales Head / Coordinator backends so OTP emails look identical.
const sgMail = require('@sendgrid/mail');

const isConfigured = () => !!process.env.SENDGRID_API_KEY && !!process.env.SENDGRID_FROM;

const sendOtpEmail = async (toEmail, userName, otp) => {
  if (!isConfigured()) {
    throw new Error('SendGrid is not configured (SENDGRID_API_KEY / SENDGRID_FROM missing)');
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const msg = {
    to: toEmail,
    from: {
      email: process.env.SENDGRID_FROM,
      name: process.env.SENDGRID_FROM_NAME || 'Nexus CRM',
    },
    subject: 'Your Nexus CRM Password Reset OTP',
    text: `Hi ${userName},\n\nYour password reset OTP is: ${otp}\n\nThis code is valid for 10 minutes. If you did not request this, please ignore this email.\n\n— ${process.env.SENDGRID_FROM_NAME || 'Nexus CRM'}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #E2E8F0;border-radius:12px;">
        <h2 style="color:#1E1B4B;margin-top:0;">Password Reset Request</h2>
        <p style="color:#475569;">Hi ${userName},</p>
        <p style="color:#475569;">Use the verification code below to reset your password:</p>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
          <span style="font-size:28px;font-weight:800;letter-spacing:8px;color:#4F46E5;">${otp}</span>
        </div>
        <p style="color:#64748B;font-size:13px;">This code is valid for <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.</p>
        <p style="color:#94A3B8;font-size:12px;margin-bottom:0;">— ${process.env.SENDGRID_FROM_NAME || 'Nexus CRM'}</p>
      </div>
    `,
  };

  await sgMail.send(msg);
};

module.exports = { sendOtpEmail, isConfigured };
