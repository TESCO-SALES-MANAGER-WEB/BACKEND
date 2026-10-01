// Authentication for the Sales Manager apps (web + mobile).
// Authenticates against the SHARED `users` collection — the same accounts created in the
// Sales Head app — so the mobile app and web app use one backend, one DB, one identity.
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const { protect, JWT_SECRET } = require('../middleware/auth');
const { syncUserName } = require('../utils/syncUserName');

// Optional email helper. Loaded defensively so a missing util or an un-installed
// @sendgrid/mail dependency can never crash the whole auth router at load time —
// the OTP flow simply falls back to the dev OTP path below.
let sendOtpEmail = null;
let isConfigured = () => false;
try {
  const mailer = require('../utils/sendEmail');
  sendOtpEmail = mailer.sendOtpEmail;
  isConfigured = mailer.isConfigured || isConfigured;
} catch (e) {
  console.warn('[auth] sendEmail util unavailable — OTP will use dev fallback.');
}

const signToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d', // long-lived for mobile
  });

// POST /api/auth/login  { email (or employeeId), password, role? }
// role defaults to 'Sales Manager' since this backend serves the Manager apps.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const role = req.body.role || 'Sales Manager';
    // Optional: the designation the user chose at login (Manager / Business Development
    // Executive). Managers and BDEs share the 'Sales Manager' role and differ only by
    // `designation`, so when the client sends it we verify the account matches.
    const selectedDesignation = req.body.designation;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please enter your email/ID and password' });
    }
    const identifier = String(email).trim();
    const user = await User.findOne({
      role,
      $or: [{ email: identifier.toLowerCase() }, { employeeId: identifier }],
    }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact admin.' });
    }
    // Defense-in-depth: never issue a token for an account whose role does not match.
    if (user.role !== role) {
      return res.status(403).json({ success: false, message: `You are not registered as ${role}` });
    }
    // Designation gate — only enforced when the client specifies which role it is logging
    // in as (the web login does; the mobile app and older clients omit it, so their
    // behaviour is unchanged). A missing/blank designation on the account means a plain
    // Manager (the schema default), so existing Manager accounts keep working.
    if (selectedDesignation) {
      const isBDE = (d) => /business development|\bbde\b/i.test(String(d || ''));
      const accountIsBDE = isBDE(user.designation);
      const wantsBDE = isBDE(selectedDesignation);
      if (accountIsBDE !== wantsBDE) {
        const correct = accountIsBDE ? 'Business Development Executive' : 'Manager';
        return res.status(403).json({
          success: false,
          message: `This account is registered as ${correct}. Please select "${correct}" and try again.`,
        });
      }
    }

    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });
    return res.json({ success: true, token: signToken(user), user: user.toSafeJSON() });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// GET /api/auth/me  (protected) — resolve the token back to the account
router.get('/me', protect, (req, res) => res.json({ success: true, user: req.user.toSafeJSON() }));

// PATCH /api/auth/profile  (protected) — edit own name/email (persists to the shared account)
router.patch('/profile', protect, async (req, res) => {
  try {
    const { name, email } = req.body || {};
    const prevName = req.user.name; // capture before change for retroactive sync
    if (typeof name === 'string' && name.trim()) req.user.name = name.trim();
    if (typeof email === 'string' && email.trim()) req.user.email = email.trim().toLowerCase();
    await req.user.save();
    // A display-name change must retroactively update this person's name on all
    // existing leads/appointments/etc. (records reference people by name).
    if (req.user.name && req.user.name !== prevName) {
      await syncUserName(prevName, req.user.name).catch((e) =>
        console.warn('[profile] name sync failed:', e && e.message)
      );
    }
    return res.json({ success: true, user: req.user.toSafeJSON() });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ success: false, message: 'That email is already in use.' });
    }
    return res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/auth/push-token  (protected) — register this device's Expo push token
router.post('/push-token', protect, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ success: false, message: 'token is required' });
    await User.updateOne({ _id: req.user._id }, { $addToSet: { pushTokens: token } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/auth/push-token  (protected) — unregister on logout
router.delete('/push-token', protect, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ success: false, message: 'token is required' });
    await User.updateOne({ _id: req.user._id }, { $pull: { pushTokens: token } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/logout  (stateless JWT — client discards the token)
router.post('/logout', protect, (req, res) => res.json({ success: true, message: 'Logged out' }));

// POST /api/auth/forgot-password  { email } → generates a 6-digit OTP valid 10 min.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please enter your email ID' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOtp = otp;
    user.resetOtpExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.resetOtpVerified = false;
    await user.save({ validateBeforeSave: false });

    if (sendOtpEmail && isConfigured()) {
      try {
        await sendOtpEmail(user.email, user.name, otp);
        return res.json({ success: true, message: `OTP sent to ${user.email}` });
      } catch (mailErr) {
        console.error('SendGrid error:', mailErr.response?.body || mailErr.message);
        if (process.env.NODE_ENV !== 'production') {
          console.log(`[Nexus CRM OTP fallback] ${user.email}: ${otp}`);
          return res.json({ success: true, message: 'Email sending failed (dev fallback: OTP shown)', devOtp: otp });
        }
        return res.status(500).json({ success: false, message: 'Failed to send OTP email. Try again later.' });
      }
    }

    // Email not available/configured: dev fallback
    console.log(`[Nexus CRM OTP] ${user.email}: ${otp}`);
    const payload = { success: true, message: 'OTP generated (email not configured)' };
    if (process.env.NODE_ENV !== 'production') payload.devOtp = otp;
    return res.json(payload);
  } catch (err) {
    console.error('Forgot-password error:', err);
    return res.status(500).json({ success: false, message: 'Server error sending OTP' });
  }
});

// POST /api/auth/verify-otp  { email, otp }
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select(
      '+resetOtp +resetOtpExpires'
    );
    if (!user || !user.resetOtp || user.resetOtp !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP. Please enter the correct code.' });
    }
    if (user.resetOtpExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    user.resetOtpVerified = true;
    await user.save({ validateBeforeSave: false });
    return res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    console.error('Verify-OTP error:', err);
    return res.status(500).json({ success: false, message: 'Server error verifying OTP' });
  }
});

// POST /api/auth/reset-password  { email, otp, newPassword }
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }
    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select(
      '+resetOtp +resetOtpExpires +resetOtpVerified +password'
    );
    if (!user || user.resetOtp !== otp || !user.resetOtpVerified) {
      return res.status(400).json({ success: false, message: 'OTP verification failed. Start over.' });
    }
    if (user.resetOtpExpires < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }
    user.password = newPassword; // hashed by the model's pre-save hook
    user.resetOtp = undefined;
    user.resetOtpExpires = undefined;
    user.resetOtpVerified = false;
    await user.save();
    return res.json({ success: true, message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset-password error:', err);
    return res.status(500).json({ success: false, message: 'Server error resetting password' });
  }
});

module.exports = router;
