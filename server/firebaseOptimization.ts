/**
 * Firebase Optimization Utilities 
 * Functions to monitor, track, and optimize Firebase usage
 * 
 * This file provides utilities to:
 * 1. Track Firestore read/write operations
 * 2. Audit operation counts by component/feature
 * 3. Provide insight into potential optimization areas
 */

// Track Firebase operations by feature/component
interface OperationCount {
  reads: number;
  writes: number;
  deletes: number;
  lastReset: number;
}

// Global operation tracking by feature
const operationsByFeature = new Map<string, OperationCount>();

// Track total operations
const totalOperations: OperationCount = {
  reads: 0,
  writes: 0,
  deletes: 0,
  lastReset: Date.now()
};

/**
 * Log an operation to the tracking system
 * 
 * @param featureKey - Identifier for the feature/component (e.g., 'dashboard', 'onboarding')
 * @param operationType - Type of operation ('read', 'write', 'delete')
 * @param count - Number of operations to log (default: 1)
 */
export function logFirestoreOperation(
  featureKey: string, 
  operationType: 'read' | 'write' | 'delete',
  count: number = 1
) {
  // Only track in development mode
  if (process.env.NODE_ENV !== 'development') return;
  
  // Get or create feature tracking
  let featureTracking = operationsByFeature.get(featureKey);
  if (!featureTracking) {
    featureTracking = { reads: 0, writes: 0, deletes: 0, lastReset: Date.now() };
    operationsByFeature.set(featureKey, featureTracking);
  }
  
  // Update counts
  if (operationType === 'read') {
    featureTracking.reads += count;
    totalOperations.reads += count;
  } else if (operationType === 'write') {
    featureTracking.writes += count;
    totalOperations.writes += count;
  } else if (operationType === 'delete') {
    featureTracking.deletes += count;
    totalOperations.deletes += count;
  }
}

/**
 * Create Firestore-wrapped operations that automatically track usage
 * This is a higher-order function that wraps Firestore methods with tracking
 * 
 * @param featureKey - Identifier for the feature being tracked
 */
export function createTrackedFirestore(featureKey: string) {
  // Log read operations
  const logRead = (count: number = 1) => 
    logFirestoreOperation(featureKey, 'read', count);
  
  // Log write operations
  const logWrite = (count: number = 1) => 
    logFirestoreOperation(featureKey, 'write', count);
  
  // Log delete operations
  const logDelete = (count: number = 1) => 
    logFirestoreOperation(featureKey, 'delete', count);
  
  return {
    logRead,
    logWrite,
    logDelete
  };
}

// Log Firestore operation metrics periodically
setInterval(() => {
  // Only log in development
  if (process.env.NODE_ENV !== 'development') return;
  
  const now = Date.now();
  const minutesSinceReset = Math.round((now - totalOperations.lastReset) / 1000 / 60);
  
  // Only log if we have operations to report
  if (totalOperations.reads > 0 || totalOperations.writes > 0 || totalOperations.deletes > 0) {
    console.log('[Firebase Optimization] Firestore operation metrics:', {
      timeWindow: `${minutesSinceReset} minutes`,
      totalReads: totalOperations.reads,
      totalWrites: totalOperations.writes,
      totalDeletes: totalOperations.deletes,
      operationsByFeature: [...operationsByFeature.entries()].map(([feature, counts]) => ({
        feature,
        reads: counts.reads,
        writes: counts.writes,
        deletes: counts.deletes,
        readPercentage: Math.round((counts.reads / Math.max(totalOperations.reads, 1)) * 100)
      }))
    });
  }
  
  // Reset metrics every hour
  if (minutesSinceReset >= 60) {
    totalOperations.reads = 0;
    totalOperations.writes = 0;
    totalOperations.deletes = 0;
    totalOperations.lastReset = now;
    
    // Also reset feature counters
    operationsByFeature.clear();
  }
}, 300000); // Log every 5 minutes