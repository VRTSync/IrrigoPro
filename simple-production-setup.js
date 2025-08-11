// Direct production database reset script
import bcrypt from 'bcrypt';
import { Pool } from '@neondatabase/serverless';

// This will run against the actual production database
const productionDbUrl = process.env.DATABASE_URL;

async function resetProductionUsers() {
  const pool = new Pool({ connectionString: productionDbUrl });
  
  try {
    // Hash the simple password
    const passwordHash = await bcrypt.hash('password123', 10);
    console.log('Password hash generated:', passwordHash);
    
    // Clear all users
    await pool.query('DELETE FROM users');
    console.log('Cleared all existing users');
    
    // Create Randy and superadmin
    const insertQuery = `
      INSERT INTO users (
        username, password, name, email, role, 
        company_id, is_active, email_verified,
        created_at, updated_at
      ) VALUES 
      ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()),
      ($9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
    `;
    
    await pool.query(insertQuery, [
      'randy@highplainsprop.com', passwordHash, 'Randy Mangel', 'randy@highplainsprop.com', 'company_admin', null, true, true,
      'superadmin', passwordHash, 'Super Administrator', 'admin@irrigopro.com', 'super_admin', null, true, true
    ]);
    
    console.log('Created fresh users');
    
    // Verify
    const result = await pool.query('SELECT username, name, role FROM users ORDER BY role');
    console.log('Production users:', result.rows);
    
  } catch (error) {
    console.error('Production setup failed:', error);
  } finally {
    await pool.end();
  }
}

resetProductionUsers();