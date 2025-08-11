// Direct production database setup for Randy
import { db } from './server/db.js';
import { users } from './shared/schema.js';
import bcrypt from 'bcrypt';

async function createRandyForProduction() {
  try {
    console.log('Creating Randy user for production...');
    
    // Hash the password
    const passwordHash = await bcrypt.hash('admin123', 10);
    
    // Delete any existing Randy users
    await db.delete(users).where(users.username.like('%randy%'));
    
    // Create new Randy user
    const [newUser] = await db.insert(users).values({
      username: 'randy@highplainsprop.com',
      password: passwordHash,
      name: 'Randy Mangel',
      email: 'randy@highplainsprop.com',
      role: 'company_admin',
      isActive: true,
      emailVerified: true
    }).returning();
    
    console.log('Randy created successfully:', newUser.username);
    console.log('Login with: randy@highplainsprop.com / admin123');
    
  } catch (error) {
    console.error('Error:', error);
  }
}

createRandyForProduction();