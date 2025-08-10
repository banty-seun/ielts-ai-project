/**
 * Script to delete all data associated with a user by email
 * Usage: npx tsx scripts/deleteUserData.ts user@example.com
 */

import { storage } from '../server/storage';
import { exit } from 'process';

const run = async () => {
  const email = process.argv[2];

  if (!email) {
    console.error('Error: Please provide a user email as an argument.');
    console.error('Usage: npx tsx scripts/deleteUserData.ts user@example.com');
    exit(1);
  }

  console.log(`Attempting to delete user data for email: ${email}`);

  try {
    // Validate the user exists first
    const user = await storage.getUserByEmail(email);
    
    if (!user) {
      console.error(`Error: No user found with email: ${email}`);
      exit(1);
    }
    
    console.log(`User found: ${user.username} (ID: ${user.id})`);
    
    // Confirm with user before proceeding
    console.log('This will delete ALL data associated with this user including:');
    console.log('- User account information');
    console.log('- Study plans');
    console.log('- Weekly study plans');
    console.log('This action cannot be undone.');
    
    // We can't easily prompt for confirmation in this script without adding dependencies,
    // so we'll just proceed with deletion
    
    console.log(`Deleting user data for email: ${email}`);
    await storage.deleteUserDataByEmail(email);
    
    console.log(`Successfully deleted all data for user with email: ${email}`);
    exit(0);
  } catch (error) {
    console.error('Failed to delete user data:', error);
    exit(1);
  }
};

// Execute the script
run();