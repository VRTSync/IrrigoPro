import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LicenseAgreement() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <Card className="shadow-lg">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                IrrigoPro License Agreement
              </CardTitle>
              <CardDescription className="text-lg">
                Terms of Service and Privacy Policy
              </CardDescription>
            </CardHeader>
            <CardContent className="prose prose-blue max-w-none dark:prose-invert">
              <div className="space-y-6">
                <section>
                  <h2 className="text-xl font-semibold mb-3">Terms of Service</h2>
                  <p>
                    Welcome to IrrigoPro, a comprehensive irrigation business management platform. 
                    By using our service, you agree to these terms and conditions.
                  </p>
                  
                  <h3 className="text-lg font-medium mt-4 mb-2">1. Service Description</h3>
                  <p>
                    IrrigoPro provides irrigation business management tools including customer management, 
                    work order tracking, billing, and QuickBooks integration to streamline your irrigation 
                    business operations.
                  </p>

                  <h3 className="text-lg font-medium mt-4 mb-2">2. User Responsibilities</h3>
                  <ul className="list-disc pl-6 space-y-2">
                    <li>Maintain accurate and up-to-date account information</li>
                    <li>Protect your login credentials and account security</li>
                    <li>Use the service in compliance with applicable laws and regulations</li>
                    <li>Respect the intellectual property rights of IrrigoPro and third parties</li>
                  </ul>

                  <h3 className="text-lg font-medium mt-4 mb-2">3. Data Security and Privacy</h3>
                  <p>
                    We are committed to protecting your data and privacy. All customer information, 
                    business data, and financial records are encrypted and stored securely. We do not 
                    share your data with third parties except as necessary to provide our services 
                    (such as QuickBooks integration when authorized by you).
                  </p>

                  <h3 className="text-lg font-medium mt-4 mb-2">4. QuickBooks Integration</h3>
                  <p>
                    Our QuickBooks integration allows you to sync customer data and create invoices 
                    directly in your QuickBooks account. By connecting QuickBooks, you authorize 
                    IrrigoPro to access your QuickBooks data as needed to provide these features. 
                    You can revoke this access at any time through your QuickBooks account settings.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold mb-3">Privacy Policy</h2>
                  
                  <h3 className="text-lg font-medium mt-4 mb-2">Information We Collect</h3>
                  <ul className="list-disc pl-6 space-y-2">
                    <li>Account information (name, email, company details)</li>
                    <li>Customer and business data you enter into the system</li>
                    <li>Usage data to improve our services</li>
                    <li>QuickBooks data when you authorize the integration</li>
                  </ul>

                  <h3 className="text-lg font-medium mt-4 mb-2">How We Use Your Information</h3>
                  <ul className="list-disc pl-6 space-y-2">
                    <li>Provide and maintain the IrrigoPro service</li>
                    <li>Process your business transactions and generate reports</li>
                    <li>Sync data with your authorized third-party services (like QuickBooks)</li>
                    <li>Send important service notifications and updates</li>
                    <li>Improve our platform based on usage patterns</li>
                  </ul>

                  <h3 className="text-lg font-medium mt-4 mb-2">Data Protection</h3>
                  <p>
                    We implement industry-standard security measures including encryption, 
                    secure data transmission, and regular security audits. Your data is stored 
                    in secure, compliant data centers with appropriate backup and disaster 
                    recovery procedures.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold mb-3">Third-Party Integrations</h2>
                  <p>
                    IrrigoPro integrates with third-party services like QuickBooks to enhance 
                    functionality. These integrations are subject to the terms and privacy 
                    policies of the respective third-party providers. We only access the 
                    minimum data necessary to provide the integrated features.
                  </p>
                </section>

                <section>
                  <h2 className="text-xl font-semibold mb-3">Contact Information</h2>
                  <p>
                    If you have questions about this license agreement or our privacy practices, 
                    please contact us at:
                  </p>
                  <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg mt-2">
                    <p><strong>IrrigoPro Support</strong></p>
                    <p>Email: support@irrigopro.com</p>
                    <p>Website: https://irrigopro.com</p>
                  </div>
                </section>

                <section>
                  <h2 className="text-xl font-semibold mb-3">Updates to This Agreement</h2>
                  <p>
                    We may update this license agreement from time to time. We will notify 
                    users of any significant changes via email or through the application. 
                    Continued use of IrrigoPro after changes constitutes acceptance of the 
                    updated terms.
                  </p>
                </section>

                <div className="text-center text-sm text-gray-600 dark:text-gray-400 mt-8 pt-6 border-t">
                  <p>Last updated: August 2025</p>
                  <p>© 2025 IrrigoPro. All rights reserved.</p>
                  <div className="mt-4">
                    <p className="text-xs">Powered by VRTSync</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}