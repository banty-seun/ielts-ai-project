import { useMemo } from "react";
import { createComponentTracker } from "@lib/firestoreTracker";

/**
 * Provides a memoized tracker for Firestore operations by component name.
 */
export function useFirestoreOpTracker(componentName: string) {
  return useMemo(() => createComponentTracker(componentName), [componentName]);
}
