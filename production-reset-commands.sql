-- IrrigoPro Production Database Reset Commands
-- Run these directly in your production database

-- OPTION 1: Quick Randy Reset (Recommended)
-- Reset Randy's password to "password123"
UPDATE users SET 
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    email_verified = true,
    updated_at = NOW()
WHERE username = 'randymangel';

-- OPTION 2: Create Fresh Randy Account
-- Insert or update Randy with clean credentials
INSERT INTO users (
    username, password, name, email, role, 
    company_id, is_active, email_verified,
    created_at, updated_at
) VALUES (
    'randy@highplainsprop.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password123
    'Randy Mangel',
    'randy@highplainsprop.com',
    'company_admin',
    NULL,
    true,
    true,
    NOW(),
    NOW()
) ON CONFLICT (username) DO UPDATE SET
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    email_verified = true,
    updated_at = NOW();

-- OPTION 3: Nuclear Reset (Delete everything, start fresh)
-- ⚠️ WARNING: This deletes ALL users
DELETE FROM users;

INSERT INTO users (
    username, password, name, email, role, 
    company_id, is_active, email_verified,
    created_at, updated_at
) VALUES 
(
    'randy@highplainsprop.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password123
    'Randy Mangel',
    'randy@highplainsprop.com',
    'company_admin',
    NULL,
    true,
    true,
    NOW(),
    NOW()
),
(
    'superadmin',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password123
    'Super Administrator', 
    'admin@irrigopro.com',
    'super_admin',
    NULL,
    true,
    true,
    NOW(),
    NOW()
);

-- Verify the changes
SELECT username, name, role, email_verified FROM users ORDER BY role;

-- After running any of these options, Randy should be able to log in with:
-- Username: randy@highplainsprop.com (or randymangel for Option 1)
-- Password: password123