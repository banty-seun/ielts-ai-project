/**
 * Week utilities for IELTS AI Study Plan
 * 
 * These utilities help with calculating and managing the 6-week IELTS study program,
 * including determining the current week based on user onboarding date.
 */

import { isValid, parseISO, differenceInDays } from 'date-fns';

/**
 * User profile interface containing the necessary data for week calculations
 */
export interface UserProfile {
  id: string;
  createdAt?: string | Date; // ISO string or Date object representing onboarding completion
  testDate?: string | Date;   // Optional test date (not used in current week calculation)
  [key: string]: any;         // Allow for additional user properties
}

/**
 * Constants for the IELTS study program
 */
export const STUDY_PROGRAM = {
  TOTAL_WEEKS: 6,             // Fixed 6-week program length
  DEFAULT_WEEK: 1             // Default to Week 1 if calculation fails
};

/**
 * Calculates the current study week number for a user based on onboarding date
 * 
 * The study plan follows a fixed 6-week progression. Week 1 begins on the day
 * the user completes onboarding. The current week is determined by how many
 * full weeks have passed since then, capped at 6 weeks.
 * 
 * @param user - User profile object containing createdAt timestamp
 * @returns A number between 1 and 6 representing the current study week
 * 
 * @example
 * // User onboarded 10 days ago
 * getCurrentWeekNumber({ id: '123', createdAt: '2025-04-24T12:00:00Z' }) // Returns 2
 * 
 * // User onboarded more than 6 weeks ago
 * getCurrentWeekNumber({ id: '123', createdAt: '2025-03-01T12:00:00Z' }) // Returns 6 (capped)
 */
export function getCurrentWeekNumber(user: UserProfile): number {
  // Handle missing user or createdAt
  if (!user || !user.createdAt) {
    console.warn('Missing user data for week calculation, defaulting to Week 1');
    return STUDY_PROGRAM.DEFAULT_WEEK;
  }
  
  try {
    // Parse createdAt if it's a string
    const createdAtDate = typeof user.createdAt === 'string' 
      ? parseISO(user.createdAt) 
      : user.createdAt;
    
    // Validate the parsed date
    if (!isValid(createdAtDate)) {
      console.warn('Invalid createdAt date format, defaulting to Week 1');
      return STUDY_PROGRAM.DEFAULT_WEEK;
    }
    
    // Calculate days since onboarding
    const now = new Date();
    const diffInDays = differenceInDays(now, createdAtDate);
    
    // Ensure we don't have negative days (if createdAt is in the future)
    if (diffInDays < 0) {
      console.warn('User createdAt date is in the future, defaulting to Week 1');
      return STUDY_PROGRAM.DEFAULT_WEEK;
    }
    
    // Calculate week number (1-based) and cap at TOTAL_WEEKS (6)
    const weekNumber = Math.min(
      Math.floor(diffInDays / 7) + 1, 
      STUDY_PROGRAM.TOTAL_WEEKS
    );
    
    return weekNumber;
  } catch (error) {
    console.error('Error calculating week number:', error);
    return STUDY_PROGRAM.DEFAULT_WEEK;
  }
}

/**
 * Test cases for getCurrentWeekNumber (reference implementation)
 * These would be moved to a proper test file in a real implementation
 */
/* 
// Test: User created today (Week 1)
const today = new Date();
const userToday = { id: '123', createdAt: today };
console.assert(getCurrentWeekNumber(userToday) === 1, 'Today should be Week 1');

// Test: User created 6 days ago (still Week 1)
const sixDaysAgo = new Date();
sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
const userSixDaysAgo = { id: '123', createdAt: sixDaysAgo };
console.assert(getCurrentWeekNumber(userSixDaysAgo) === 1, '6 days ago should be Week 1');

// Test: User created 7 days ago (Week 2)
const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
const userSevenDaysAgo = { id: '123', createdAt: sevenDaysAgo };
console.assert(getCurrentWeekNumber(userSevenDaysAgo) === 2, '7 days ago should be Week 2');

// Test: User created 50 days ago (Week 6, capped)
const fiftyDaysAgo = new Date();
fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
const userFiftyDaysAgo = { id: '123', createdAt: fiftyDaysAgo };
console.assert(getCurrentWeekNumber(userFiftyDaysAgo) === 6, '50 days ago should be Week 6 (capped)');

// Test: Missing createdAt (Week 1 default)
const userNoCreatedAt = { id: '123' };
console.assert(getCurrentWeekNumber(userNoCreatedAt) === 1, 'Missing createdAt should default to Week 1');

// Test: Invalid date string (Week 1 default)
const userInvalidDate = { id: '123', createdAt: 'not-a-date' };
console.assert(getCurrentWeekNumber(userInvalidDate) === 1, 'Invalid date should default to Week 1');
*/

/**
 * Determines if a given week number is the current week for a user
 * Useful for highlighting the current week in the UI
 * 
 * @param weekNumber - The week number to check (1-6)
 * @param user - User profile object containing createdAt timestamp
 * @returns Boolean indicating if the specified week is the current week
 */
export function isCurrentWeek(weekNumber: number, user: UserProfile): boolean {
  if (weekNumber < 1 || weekNumber > STUDY_PROGRAM.TOTAL_WEEKS) {
    return false;
  }
  
  const currentWeek = getCurrentWeekNumber(user);
  return weekNumber === currentWeek;
}

/**
 * Generates an array of week labels for the study program
 * Useful for displaying the week navigation in the UI
 * 
 * @returns Array of week labels (e.g., ["Week 1", "Week 2", ..., "Week 6"])
 */
export function getWeekLabels(): string[] {
  return Array.from(
    { length: STUDY_PROGRAM.TOTAL_WEEKS }, 
    (_, i) => `Week ${i + 1}`
  );
}