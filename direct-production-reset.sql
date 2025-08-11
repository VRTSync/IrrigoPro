-- Direct production database password reset
-- Randy should try each of these credentials

-- Option 1: Reset superadmin to simple password
UPDATE users SET 
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password is 'password'
    email_verified = true,
    updated_at = NOW()
WHERE username = 'superadmin';

-- Option 2: Reset randymangel to simple password  
UPDATE users SET 
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password is 'password'
    email_verified = true,
    updated_at = NOW()
WHERE username = 'randymangel';

-- Option 3: Create fresh Randy account
INSERT INTO users (
    username, password, name, email, role, 
    company_id, is_active, email_verified
) VALUES (
    'randy@highplainsprop.com',
    '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- password is 'password'
    'Randy Mangel',
    'randy@highplainsprop.com',
    'company_admin',
    NULL,
    true,
    true
) ON CONFLICT (username) DO UPDATE SET
    password = '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    email_verified = true;

-- Randy should try these combinations:
-- 1. superadmin / password
-- 2. randymangel / password  
-- 3. randy@highplainsprop.com / password