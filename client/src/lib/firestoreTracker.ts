/**
 * Firestore Operation Tracking Utility
 * Monitors and optimizes Firestore read/write operations on the client side
 * 
 * This utility helps track and analyze Firestore usage patterns to:
 * 1. Monitor read/write consumption
 * 2. Identify optimization opportunities
 * 3. Provide usage metrics for development
 */

// Global operation counters (only for dev mode)
interface FirestoreMetrics {
  reads: {
    total: number;
    byComponent: Record<string, number>;
    byCollection: Record<string, number>;
  };
  writes: {
    total: number;
    byComponent: Record<string, number>;
    byCollection: Record<string, number>;
  };
  deletes: {
    total: number;
    byComponent: Record<string, number>;
    byCollection: Record<string, number>;
  };
  sessionStartTime: number;
}

// Initialize the window property for global tracking
declare global {
  interface Window {
    firestoreMetrics?: FirestoreMetrics;
  }
}

// Initialize metrics object
const initMetrics = (): FirestoreMetrics => ({
  reads: {
    total: 0,
    byComponent: {},
    byCollection: {}
  },
  writes: {
    total: 0,
    byComponent: {},
    byCollection: {}
  },
  deletes: {
    total: 0,
    byComponent: {},
    byCollection: {}
  },
  sessionStartTime: Date.now()
});

// Initialize global metrics in dev mode only
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  if (!window.firestoreMetrics) {
    window.firestoreMetrics = initMetrics();
    
    // Log initial setup
    console.log('[Firestore Tracker] Initialized operation tracking');
  }
}

/**
 * Track a Firestore operation (read, write, delete)
 * 
 * @param operationType - Type of operation
 * @param componentName - Name of the component/hook performing the operation
 * @param collectionName - Name of the Firestore collection being accessed
 * @param count - Number of documents affected (default: 1)
 */
export function trackFirestoreOperation(
  operationType: 'read' | 'write' | 'delete',
  componentName: string,
  collectionName: string,
  count: number = 1
): void {
  // Only track in development mode
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') {
    return;
  }
  
  // Initialize metrics if not already done
  if (!window.firestoreMetrics) {
    window.firestoreMetrics = initMetrics();
  }
  
  const metrics = window.firestoreMetrics;
  
  // Update metrics based on operation type
  switch (operationType) {
    case 'read':
      metrics.reads.total += count;
      metrics.reads.byComponent[componentName] = (metrics.reads.byComponent[componentName] || 0) + count;
      metrics.reads.byCollection[collectionName] = (metrics.reads.byCollection[collectionName] || 0) + count;
      
      // Log individual read operations
      console.log(`[Firestore Read] ${componentName} read ${count} document(s) from "${collectionName}"`);
      break;
      
    case 'write':
      metrics.writes.total += count;
      metrics.writes.byComponent[componentName] = (metrics.writes.byComponent[componentName] || 0) + count;
      metrics.writes.byCollection[collectionName] = (metrics.writes.byCollection[collectionName] || 0) + count;
      break;
      
    case 'delete':
      metrics.deletes.total += count;
      metrics.deletes.byComponent[componentName] = (metrics.deletes.byComponent[componentName] || 0) + count;
      metrics.deletes.byCollection[collectionName] = (metrics.deletes.byCollection[collectionName] || 0) + count;
      break;
  }
}

/**
 * Log a summary of all Firestore operations
 * Used to show total operations after a page load or session
 */
export function logFirestoreMetricsSummary(): void {
  // Only in development mode
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') {
    return;
  }
  
  const metrics = window.firestoreMetrics;
  if (!metrics) return;
  
  const sessionDurationMs = Date.now() - metrics.sessionStartTime;
  const sessionDurationMin = Math.round(sessionDurationMs / 1000 / 60 * 10) / 10;
  
  console.group(`[Firestore Metrics Summary] Session duration: ${sessionDurationMin} minutes`);
  
  console.log('Total Operations:', {
    reads: metrics.reads.total,
    writes: metrics.writes.total,
    deletes: metrics.deletes.total
  });
  
  console.log('Reads by Component:', metrics.reads.byComponent);
  console.log('Reads by Collection:', metrics.reads.byCollection);
  
  if (metrics.writes.total > 0) {
    console.log('Writes by Component:', metrics.writes.byComponent);
    console.log('Writes by Collection:', metrics.writes.byCollection);
  }
  
  if (metrics.deletes.total > 0) {
    console.log('Deletes by Component:', metrics.deletes.byComponent);
    console.log('Deletes by Collection:', metrics.deletes.byCollection);
  }
  
  console.groupEnd();
}

/**
 * Reset metrics - useful for measuring specific workflows
 */
export function resetFirestoreMetrics(): void {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') {
    return;
  }
  
  window.firestoreMetrics = initMetrics();
  console.log('[Firestore Tracker] Metrics reset');
}

// Auto-log metrics every 5 minutes to track accumulation
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  setInterval(() => {
    if (window.firestoreMetrics?.reads.total) {
      logFirestoreMetricsSummary();
    }
  }, 5 * 60 * 1000);
}

// Create component-specific tracker
export function createComponentTracker(componentName: string) {
  return {
    trackRead: (collectionName: string, count: number = 1) => 
      trackFirestoreOperation('read', componentName, collectionName, count),
    
    trackWrite: (collectionName: string, count: number = 1) => 
      trackFirestoreOperation('write', componentName, collectionName, count),
    
    trackDelete: (collectionName: string, count: number = 1) => 
      trackFirestoreOperation('delete', componentName, collectionName, count)
  };
}