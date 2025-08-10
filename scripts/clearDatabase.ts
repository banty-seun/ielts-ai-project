
/**
 * Script to clear all database records
 * Usage: npx tsx scripts/clearDatabase.ts
 */

import { db } from '../server/db';
import { users, studyPlans, weeklyStudyPlans, taskProgress } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { exit } from 'process';

const run = async () => {
  console.log('Warning: This will delete ALL records from the database.');
  console.log('This action cannot be undone.');
  
  try {
    // Delete in order to respect foreign key constraints
    console.log('Deleting task progress records...');
    await db.delete(taskProgress);
    
    console.log('Deleting weekly study plans...');
    await db.delete(weeklyStudyPlans);
    
    console.log('Deleting study plans...');
    await db.delete(studyPlans);
    
    console.log('Deleting users...');
    await db.delete(users);
    
    console.log('Successfully cleared all database records.');
    exit(0);
  } catch (error) {
    console.error('Failed to clear database:', error);
    exit(1);
  }
};

// Execute the script
run();
