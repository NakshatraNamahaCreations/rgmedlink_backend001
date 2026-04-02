const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "rgmedlink_jwt_secret_prod_2026";

/**
 * Generate JWT token for a user
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

/**
 * Auth middleware — verifies JWT token
 * Skips auth for public routes
 */
function authMiddleware(req, res, next) {
  // Public routes that don't need auth
  const publicPaths = [
    "/api/otp/send",
    "/api/otp/verify",
    "/api/auth/login",
    "/api/auth/register",
  ];

  if (publicPaths.some((p) => req.path.startsWith(p))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // Allow requests without token for now (backward compat)
    // TODO: Make this strict in production
    return next();
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    // Token invalid but allow request (backward compat)
    next();
  }
}

module.exports = { generateToken, authMiddleware, JWT_SECRET };
