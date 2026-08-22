const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// SHARED `users` collection — the SAME accounts used by the Sales Head / Coordinator apps.
// Schema mirrors those apps so login here authenticates against the same records.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    employeeId: { type: String, unique: true, sparse: true, trim: true },
    role: {
      type: String,
      enum: ['Sales Head', 'Sales Coordinator', 'Sales Manager'],
      required: true,
    },
    password: { type: String, required: true, minlength: 6, select: false },
    resetOtp: { type: String, select: false },
    resetOtpExpires: { type: Date, select: false },
    resetOtpVerified: { type: Boolean, default: false, select: false },
    lastLoginAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// One email can hold multiple roles (e.g. Coordinator + Manager). Uniqueness is per (email, role).
userSchema.index({ email: 1, role: 1 }, { unique: true });

// Hash password before save (matches the other apps' bcrypt cost so hashes are cross-compatible).
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    employeeId: this.employeeId,
    role: this.role,
    lastLoginAt: this.lastLoginAt,
  };
};

module.exports = mongoose.model('User', userSchema);
