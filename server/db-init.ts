import { db } from './db';
import { sql } from 'drizzle-orm';

// Database initialization and validation
export async function initializeDatabase() {
  try {
    // Test database connection
    await db.execute(sql`SELECT 1`);
    console.log('✅ Database connection verified');
    
    // In production, we don't run migrations automatically
    // Migrations should be run separately using drizzle-kit
    if (process.env.NODE_ENV !== 'production') {
      console.log('📝 Development environment - migrations should be run manually');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

export default initializeDatabase;