import admin from 'firebase-admin';

// Initialize Firebase Admin SDK with environment variables
try {
  // The Firebase project ID should be "ielts-ai-a0f3b" as specified
  // We need to manually use the correct project ID because the environment
  // variable might be incorrectly set to the App ID
  const projectId = 'ielts-ai-a0f3b';
  
  const config = {
    projectId: projectId,
  };
  
  // Check if Firebase Admin has already been initialized
  const existingApps = admin.apps || [];
  if (existingApps.length === 0) {
    admin.initializeApp(config);
    console.log(`[Firebase Admin] Initialized Firebase Admin with project ID: ${config.projectId}`);
    console.log('[Firebase Admin] Note: Using hardcoded project ID "ielts-ai-a0f3b" to match the frontend');
  } else {
    console.log('[Firebase Admin] Using existing Firebase Admin app');
  }
} catch (error) {
  console.error('[Firebase Admin] Error initializing Firebase Admin:', error);
}

// Export the admin services needed
export const auth = admin.auth();
export const firestore = admin.firestore();

// Token verification cache to reduce duplicate verifications
// This is a simple in-memory cache with expiration
interface VerificationCacheEntry {
  decodedToken: any;
  expiresAt: number;
}

const tokenVerificationCache = new Map<string, VerificationCacheEntry>();

// Track verification metrics for optimization analysis
const verificationMetrics = {
  totalVerifications: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0,
  lastReset: Date.now()
};

// Generate a safe hash for the token to use as cache key (without exposing the token)
function generateTokenHash(token: string): string {
  // Using the token's length and first/last 8 chars (safe enough for our use case)
  // This avoids storing the full token in memory while still being unique enough
  return `${token.length}:${token.substring(0, 8)}:${token.substring(token.length - 8)}`;
}

// Log verification metrics periodically (dev mode)
setInterval(() => {
  const now = Date.now();
  const minutesSinceReset = Math.round((now - verificationMetrics.lastReset) / 1000 / 60);
  
  if (verificationMetrics.totalVerifications > 0) {
    console.log('[Firebase Admin] Token verification metrics:', {
      timeWindow: `${minutesSinceReset} minutes`,
      totalVerifications: verificationMetrics.totalVerifications,
      cacheHits: verificationMetrics.cacheHits,
      cacheMisses: verificationMetrics.cacheMisses,
      errors: verificationMetrics.errors,
      hitRate: `${Math.round((verificationMetrics.cacheHits / verificationMetrics.totalVerifications) * 100)}%`
    });
  }
  
  // Reset metrics every hour
  if (minutesSinceReset >= 60) {
    verificationMetrics.totalVerifications = 0;
    verificationMetrics.cacheHits = 0;
    verificationMetrics.cacheMisses = 0;
    verificationMetrics.errors = 0;
    verificationMetrics.lastReset = now;
  }
}, 300000); // Log every 5 minutes

/**
 * Verify Firebase ID token with caching to reduce Firebase API calls
 * Uses in-memory cache with token-specific TTL based on the token's expiration time
 */
export async function verifyFirebaseToken(idToken: string) {
  try {
    verificationMetrics.totalVerifications++;
    
    // Generate a token hash for cache key
    const tokenHash = generateTokenHash(idToken);
    
    // Check cache first
    const cached = tokenVerificationCache.get(tokenHash);
    const now = Date.now();
    
    // Return cached verification if it exists and hasn't expired
    if (cached && now < cached.expiresAt) {
      verificationMetrics.cacheHits++;
      
      // Only log in non-production environments
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Firebase Admin] Using cached token verification:', {
          uid: cached.decodedToken.uid,
          cacheTimeRemaining: `${Math.round((cached.expiresAt - now) / 1000 / 60)} minutes`
        });
      }
      
      return cached.decodedToken;
    }
    
    // Cache miss - perform actual verification
    verificationMetrics.cacheMisses++;
    console.log('[Firebase Admin] Verifying token (cache miss):', {
      tokenLength: idToken.length,
      tokenStart: `${idToken.substring(0, 10)}...`,
      tokenEnd: `...${idToken.substring(idToken.length - 10)}`
    });
    
    // Perform the actual verification
    const decodedToken = await auth.verifyIdToken(idToken);
    
    // Calculate cache TTL (expires 5 minutes before actual token expiry or 55 minutes, whichever is shorter)
    const expiryTimestamp = decodedToken.exp * 1000; // Convert to milliseconds
    const cacheExpiryTime = Math.min(
      expiryTimestamp - (5 * 60 * 1000), // 5 minutes before actual expiry
      now + (55 * 60 * 1000) // Maximum 55 minutes cache time
    );
    
    // Cache the verification result
    tokenVerificationCache.set(tokenHash, {
      decodedToken,
      expiresAt: cacheExpiryTime
    });
    
    console.log('[Firebase Admin] Token verified and cached:', {
      uid: decodedToken.uid,
      email: decodedToken.email || 'not provided',
      issuer: decodedToken.iss || 'unknown',
      tokenExpires: new Date(expiryTimestamp).toISOString(),
      cacheExpires: new Date(cacheExpiryTime).toISOString()
    });
    
    return decodedToken;
  } catch (err) {
    // Count errors in metrics
    verificationMetrics.errors++;
    
    // Use type assertion after checking for properties
    const error: any = err;
    console.error('[Firebase Admin] Error verifying Firebase token:', error);
    
    // Provide more detailed error info
    const errorInfo = {
      message: typeof error === 'object' && error !== null && 'message' in error 
        ? error.message : 'Unknown error',
      code: typeof error === 'object' && error !== null && 'code' in error 
        ? error.code : 'unknown_error',
      stack: typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string'
        ? error.stack.split('\n')[0] : 'No stack trace'
    };
    
    console.error('[Firebase Admin] Token verification error details:', errorInfo);
    throw new Error(`Invalid or expired Firebase token: ${errorInfo.message}`);
  }
}

// Utility function to get user by UID
export async function getFirebaseUser(uid: string) {
  try {
    return await auth.getUser(uid);
  } catch (error) {
    console.error('Error getting Firebase user:', error);
    throw new Error('User not found in Firebase');
  }
}