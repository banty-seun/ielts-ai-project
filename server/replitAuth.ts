import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

if (!process.env.REPLIT_DOMAINS) {
  throw new Error("Environment variable REPLIT_DOMAINS not provided");
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true, // Make sure table exists
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  // For Replit environment we need to ensure cookies work correctly
  const isDevelopment = process.env.NODE_ENV !== "production";
  
  // Log environment configuration
  console.log("[Session Config]", {
    environment: process.env.NODE_ENV || "not set",
    isDevelopment,
    hostname: process.env.REPLIT_DOMAINS || "localhost"
  });
  
  return session({
    name: "ieltsprep.sid", // Give the cookie a specific name
    secret: process.env.SESSION_SECRET || "ieltsprepappdevelopmentsecret",
    store: sessionStore,
    resave: true, // Changed to true to ensure session is saved
    saveUninitialized: true, // Changed to true to create session for all users
    rolling: true, // Refresh expiration on activity
    cookie: {
      httpOnly: true,
      secure: isDevelopment ? false : true, // Set to true for production, false for dev
      sameSite: isDevelopment ? 'lax' : 'none', // None for cross-site in production
      maxAge: sessionTtl,
      path: '/'
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    username: claims["username"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    bio: claims["bio"],
    profileImageUrl: claims["profile_image_url"],
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  for (const domain of process.env
    .REPLIT_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    // Log session state before login attempt
    console.log('[Auth Login] Session before login:', {
      id: req.sessionID,
      exists: !!req.session,
      isAuthenticated: req.isAuthenticated(),
      cookies: req.headers.cookie ? 'Present' : 'Missing'
    });
    
    // Set a test cookie to verify cookie functionality
    res.cookie('authtest', 'testvalue', {
      maxAge: 5 * 60 * 1000, // 5 minutes
      httpOnly: true,
      secure: false,
      sameSite: 'lax'
    });
    
    // Authentication
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, (err) => {
      if (err) {
        console.error("[Auth Callback Error]:", err);
        return res.redirect("/api/login");
      }
      
      // Log successful login
      console.log("[Auth Success] User authenticated via callback");
      
      // Special handling for session saving
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error("[Session Save Error]:", saveErr);
        } else {
          console.log("[Session Saved] Session ID:", req.sessionID);
        }
        
        // Redirect even if there was an error saving the session
        return res.redirect('/dashboard');
      });
    });
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  console.log("[Auth Debug] Authentication request:", {
    path: req.path,
    hasUser: !!req.user,
    isAuthenticated: req.isAuthenticated(),
    sessionID: req.sessionID,
    cookies: req.headers.cookie ? 'Present' : 'Missing'
  });
  
  // Check if req.user exists
  if (!req.user) {
    console.log("[Auth Error] No user in request");
    return res.status(401).json({ 
      message: "Unauthorized",
      detail: "No user in session"
    });
  }
  
  const user = req.user as any;

  // Double check authenticated status
  if (!req.isAuthenticated()) {
    console.log("[Auth Error] Not authenticated");
    
    // Don't redirect API calls - just return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        message: "Unauthorized",
        detail: "Not authenticated" 
      });
    }
    
    // For web routes, redirect to login
    return res.redirect("/api/login");
  }
  
  // Check if token is expired
  if (!user.expires_at) {
    console.log("[Auth Error] No expiration time in token");
    return res.status(401).json({ 
      message: "Unauthorized",
      detail: "Invalid token (no expiration)" 
    });
  }

  const now = Math.floor(Date.now() / 1000);
  
  // If token is still valid, proceed
  if (now <= user.expires_at) {
    console.log("[Auth Debug] Token valid, proceeding");
    return next();
  }
  
  console.log("[Auth Debug] Token expired, attempting refresh");
  
  // Try to refresh the token
  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    console.log("[Auth Error] No refresh token available");
    
    // Don't redirect API calls - just return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        message: "Unauthorized",
        detail: "No refresh token" 
      });
    }
    
    // For web routes, redirect to login
    return res.redirect("/api/login");
  }

  try {
    console.log("[Auth Debug] Refreshing token");
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    console.log("[Auth Debug] Token refreshed successfully");
    return next();
  } catch (error) {
    console.error("[Auth Error] Token refresh failed:", error);
    
    // Don't redirect API calls - just return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ 
        message: "Unauthorized",
        detail: "Token refresh failed" 
      });
    }
    
    // For web routes, redirect to login
    return res.redirect("/api/login");
  }
};