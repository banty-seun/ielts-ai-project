import { runAllTests } from './weekUtils.test';

/**
 * Simple function to run week utilities tests in the browser console
 */
export function runWeekUtilsTests() {
  console.clear();
  console.log('Running week utilities tests...');
  runAllTests();
}

// Expose the function globally for easy access from browser console
//@ts-ignore
window.runWeekUtilsTests = runWeekUtilsTests;