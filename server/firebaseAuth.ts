import { Request, Response, NextFunction } from 'express';
import { verifyFirebaseToken } from './firebaseAdmin';
import { storage } from './storage';
import crypto from 'crypto';

// Extend Express Request type to include firebase user
declare global {
  namespace Express {
    interface Request {
      firebaseUser?: {
        uid: string;
        email?: string;
        name?: string;
        picture?: string;
      };
    }
  }
}

/**
 * Symbol key for storing verification results on request object
 * This allows multiple middleware to share verification state without duplicate calls
 */
const FIREBASE_VERIFICATION_RESULT = Symbol('firebaseVerificationResult');

/**
 * Property to add to Express Request to store verification state
 */
declare global {
  namespace Express {
    interface Request {
      [FIREBASE_VERIFICATION_RESULT]?: {
        verified: boolean;
        decodedToken?: any;
        error?: Error;
        timestamp: number;
      };
    }
  }
}

/**
 * Middleware to verify Firebase ID token in Authorization header
 * Sets req.firebaseUser if token is valid
 * Uses request-scoped token verification caching to prevent redundant verifications
 */
export const verifyFirebaseAuth = async (req: Request, res: Response, next: NextFunction) => {
  const DEBUG = process.env.NODE_ENV !== 'production';
  
  // Check if verification was already performed on this request
  if (req[FIREBASE_VERIFICATION_RESULT]) {
    const result = req[FIREBASE_VERIFICATION_RESULT];
    if (DEBUG) {
      console.log('[Firebase Auth] Using request-cached verification result:', {
        path: req.path,
        verified: result.verified,
        age: `${Date.now() - result.timestamp}ms ago`
      });
    }
    
    if (result.verified) {
      // Token already verified for this request, skip re-verification
      if (!req.firebaseUser && result.decodedToken) {
        // Set firebase user if not already set (e.g., middleware added twice)
        req.firebaseUser = {
          uid: result.decodedToken.uid,
          email: result.decodedToken.email,
          name: result.decodedToken.name,
          picture: result.decodedToken.picture
        };
      }
      
      return next();
    } else {
      // Previous verification already failed for this request
      return res.status(401).json({ 
        message: 'Unauthorized',
        detail: 'Invalid token'
      });
    }
  }
  
  // Not verified yet - proceed with actual verification
  DEBUG && console.log('[Firebase Auth] Verifying token for request:', req.path);
  
  // Get the ID token from Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.split('Bearer ')[1] : null;

  // Debug auth headers (only in non-production)
  if (DEBUG) {
    console.log('[Firebase Auth] Request headers:', {
      hasAuth: !!req.headers.authorization,
      authType: authHeader?.startsWith('Bearer ') ? 'Bearer' : 'Unknown or None',
      tokenLength: token ? token.length : 0,
      tokenStart: token ? `${token.substring(0, 10)}...` : 'None',
      expectedProjectId: 'ielts-ai-a0f3b' // Must match both client and server config
    });
  }

  if (!token) {
    // Store verification result on request object for future middleware
    req[FIREBASE_VERIFICATION_RESULT] = {
      verified: false,
      error: new Error('No token provided'),
      timestamp: Date.now()
    };
    
    console.log('[Firebase Auth] No token provided');
    return res.status(401).json({ 
      message: 'Unauthorized',
      detail: 'No authentication token provided'
    });
  }

  try {
    // Verify the token (using the already optimized and memoized function)
    const decodedToken = await verifyFirebaseToken(token);
    
    // Store verification result on request object for future middleware
    req[FIREBASE_VERIFICATION_RESULT] = {
      verified: true,
      decodedToken,
      timestamp: Date.now()
    };
    
    // Add the Firebase user to the request
    req.firebaseUser = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      picture: decodedToken.picture
    };
    
    DEBUG && console.log(`[Firebase Auth] User authenticated: ${decodedToken.uid}`);
    
    next();
  } catch (error) {
    // Store verification error on request object for future middleware
    req[FIREBASE_VERIFICATION_RESULT] = {
      verified: false,
      error: error as Error,
      timestamp: Date.now()
    };
    
    console.error('[Firebase Auth] Token verification failed:', error);
    return res.status(401).json({ 
      message: 'Unauthorized',
      detail: 'Invalid token'
    });
  }
};

/**
 * Middleware to get or create a user in our database based on Firebase UID
 * Must be used after verifyFirebaseAuth
 */
export const ensureFirebaseUser = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.firebaseUser) {
    return res.status(401).json({ 
      message: 'Unauthorized',
      detail: 'User not authenticated'
    });
  }

  try {
    console.log(`[Firebase Auth] Processing user with Firebase UID: ${req.firebaseUser.uid}, Email: ${req.firebaseUser.email || 'None'}`);
    
    // STEP 1: Try to find user by Firebase UID first (most reliable match)
    let user = await storage.getUserByFirebaseUid(req.firebaseUser.uid);
    
    if (user) {
      console.log(`[Firebase Auth] ✓ User found by Firebase UID: ${user.id}`);
      
      // Update user with latest information (handles email verification status changes)
      if (req.firebaseUser.email || req.firebaseUser.picture) {
        console.log(`[Firebase Auth] Updating existing user with latest info`);
        user = await storage.upsertUser({
          ...user,
          email: req.firebaseUser.email || user.email,
          profileImageUrl: req.firebaseUser.picture || user.profileImageUrl
        });
      }
    } 
    // STEP 2: If not found by UID, try finding by email (handles email verification case)
    else if (req.firebaseUser.email) {
      console.log(`[Firebase Auth] User not found by UID, searching by email: ${req.firebaseUser.email}`);
      user = await storage.getUserByEmail(req.firebaseUser.email);
      
      // If found by email, handle potential UID conflict
      if (user) {
        const existingUid = user.firebaseUid;
        if (existingUid && existingUid !== req.firebaseUser.uid) {
          console.error(`[Firebase Auth] UID CONFLICT: Existing user ${user.id} has UID ${existingUid}, incoming ${req.firebaseUser.uid}`);
          return res.status(409).json({
            success: false,
            message: "Account conflict detected. Please contact support.",
            code: "ACCOUNT_CONFLICT"
          });
        }
        
        console.log(`[Firebase Auth] ✓ User found by email: ${user.id}, updating Firebase UID reference`);
        // Safe to update if no conflict
        user = await storage.upsertUser({
          ...user,
          firebaseUid: req.firebaseUser.uid, // Update to new Firebase UID
          profileImageUrl: req.firebaseUser.picture || user.profileImageUrl
        });
      } 
      // STEP 3: If still not found and we have an email, try username lookup as fallback
      else {
        const generatedUsername = req.firebaseUser.email.split('@')[0];
        console.log(`[Firebase Auth] User not found by email, searching by username: ${generatedUsername}`);
        
        try {
          user = await storage.getUserByUsername(generatedUsername);
          
          if (user) {
            const existingUid = user.firebaseUid;
            if (existingUid && existingUid !== req.firebaseUser.uid) {
              console.error(`[Firebase Auth] UID CONFLICT: Existing user ${user.id} has UID ${existingUid}, incoming ${req.firebaseUser.uid}`);
              return res.status(409).json({
                success: false,
                message: "Account conflict detected. Please contact support.",
                code: "ACCOUNT_CONFLICT"
              });
            }
            
            console.log(`[Firebase Auth] ✓ User found by username: ${user.id}, updating Firebase UID reference`);
            user = await storage.upsertUser({
              ...user,
              firebaseUid: req.firebaseUser.uid, // Update to new Firebase UID
              email: req.firebaseUser.email || user.email,
              profileImageUrl: req.firebaseUser.picture || user.profileImageUrl
            });
          }
        } catch (error: any) {
          console.log(`[Firebase Auth] Error looking up by username: ${error?.message || 'Unknown error'}`);
        }
      }
    }

    // STEP 4: Create a new user if no existing match was found
    if (!user) {
      console.log(`[Firebase Auth] ➕ No existing user found, creating new user for Firebase UID: ${req.firebaseUser.uid}`);
      
      // Generate a username from email with timestamp to avoid conflicts
      const timestamp = Date.now().toString().substr(-4);
      const username = req.firebaseUser.email 
        ? `${req.firebaseUser.email.split('@')[0]}_${timestamp}`
        : `user_${req.firebaseUser.uid.substring(0, 8)}`;
      
      // Generate a stable UUID for database ID (NOT Firebase UID)
      // This is critical to ensure our database ID remains stable even if Firebase UID changes
      const stableDbId = crypto.randomUUID();
      
      console.log(`[Firebase Auth] Creating new user with stable ID: ${stableDbId}`);
      
      user = await storage.upsertUser({
        id: stableDbId, // Use stable UUID as database ID
        username: username,
        email: req.firebaseUser.email,
        firebaseUid: req.firebaseUser.uid, // Store Firebase UID as reference field
        profileImageUrl: req.firebaseUser.picture
      });
      
      console.log(`[Firebase Auth] ✓ Created new user with username: ${username}`);
    }

    // Add the database user to the request
    req.user = user;
    
    // Log relationship between database and Firebase IDs for debugging
    console.log(`[Firebase Auth] Request authenticated: Database ID: ${user.id}, Firebase UID: ${req.firebaseUser.uid}`);
    
    next();
  } catch (error) {
    console.error('[Firebase Auth] Error ensuring user:', error);
    return res.status(500).json({ 
      message: 'Server error',
      detail: 'Failed to process user data'
    });
  }
};