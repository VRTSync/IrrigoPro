import { storage } from "./server/storage.js";
import bcrypt from "bcrypt";

async function setupUsers() {
  console.log("Setting up production users...");
  
  try {
    // Check if superadmin already exists
    const existingSuperAdmin = await storage.getUserByUsername("superadmin");
    if (!existingSuperAdmin) {
      await storage.createUser({
        username: "superadmin",
        password: await bcrypt.hash("admin123", 10),
        name: "Super Administrator",
        email: "superadmin@irrigopro.com",
        role: "super_admin",
        companyId: null,
        isActive: true,
        emailVerified: true
      });
      console.log("✓ Superadmin user created");
    } else {
      console.log("✓ Superadmin user already exists");
    }

    // Check if Randy already exists, if not create him
    const existingRandy = await storage.getUserByUsername("randy@highplainsprop.com");
    if (!existingRandy) {
      await storage.createUser({
        username: "randy@highplainsprop.com",
        password: await bcrypt.hash("password123", 10),
        name: "Randy Mangel",
        email: "randy@highplainsprop.com",
        role: "company_admin",
        companyId: null,
        isActive: true,
        emailVerified: true
      });
      console.log("✓ Randy user created");
    } else {
      // Update Randy's password to ensure it's correct
      await storage.updateUser(existingRandy.id, {
        password: await bcrypt.hash("password123", 10),
        updatedAt: new Date()
      });
      console.log("✓ Randy user updated with correct password");
    }

    console.log("All users setup completed successfully!");
    
    // Verify the users can authenticate
    const testRandy = await storage.getUserByUsername("randy@highplainsprop.com");
    const testSuper = await storage.getUserByUsername("superadmin");
    
    if (testRandy && testSuper) {
      console.log("✓ All user accounts verified in database");
      process.exit(0);
    } else {
      console.error("❌ User verification failed");
      process.exit(1);
    }
    
  } catch (error) {
    console.error("❌ Error setting up users:", error);
    process.exit(1);
  }
}

setupUsers();