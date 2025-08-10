/**
 * Simple tracker for firestore operations
 * This is a mock implementation for debugging purposes
 */

export const sharedTracker = {
  trackRead: (collection: string, count: number = 1) => {
    console.log(`[MOCK Tracker] Tracked ${count} reads from ${collection}`);
  },
  trackWrite: (collection: string, count: number = 1) => {
    console.log(`[MOCK Tracker] Tracked ${count} writes to ${collection}`);
  },
  trackDelete: (collection: string, count: number = 1) => {
    console.log(`[MOCK Tracker] Tracked ${count} deletes from ${collection}`);
  },
  getStats: () => ({
    reads: 0,
    writes: 0,
    deletes: 0
  })
};

export function createComponentTracker(componentName: string) {
  return {
    trackRead: (collection: string, count: number = 1) => {
      console.log(`[MOCK ${componentName} Tracker] Tracked ${count} reads from ${collection}`);
    },
    trackWrite: (collection: string, count: number = 1) => {
      console.log(`[MOCK ${componentName} Tracker] Tracked ${count} writes to ${collection}`);
    },
    trackDelete: (collection: string, count: number = 1) => {
      console.log(`[MOCK ${componentName} Tracker] Tracked ${count} deletes from ${collection}`);
    },
    getStats: () => ({
      reads: 0,
      writes: 0,
      deletes: 0
    })
  };
}