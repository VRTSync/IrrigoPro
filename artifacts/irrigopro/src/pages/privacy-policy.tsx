import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-blue-600 mb-4">Privacy Policy</h1>
          <p className="text-gray-600 text-lg">
            Protecting your privacy is our priority
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-blue-600">IrrigoPro Privacy Policy</CardTitle>
            <p className="text-sm text-gray-500">Effective Date: August 18, 2025</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">1. Information We Collect</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  We collect information you provide directly to us, including:
                </p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>Account information (name, email address, company details)</li>
                  <li>Business data (customer information, work orders, estimates)</li>
                  <li>Usage information and application interactions</li>
                  <li>Device and browser information for technical support</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">2. How We Use Your Information</h2>
              <div className="space-y-3 text-gray-700">
                <p>We use the information we collect to:</p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>Provide and maintain our irrigation management services</li>
                  <li>Process transactions and manage customer relationships</li>
                  <li>Integrate with QuickBooks for accounting and invoicing</li>
                  <li>Send service notifications and updates</li>
                  <li>Improve our platform and develop new features</li>
                  <li>Provide customer support and technical assistance</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">3. Information Sharing and Disclosure</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  We do not sell, trade, or rent your personal information to third parties. We may share your information only in the following circumstances:
                </p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>With QuickBooks for accounting integration services</li>
                  <li>With service providers who assist in platform operations</li>
                  <li>When required by law or to protect our legal rights</li>
                  <li>With your explicit consent for specific purposes</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">4. QuickBooks Integration</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  When you connect IrrigoPro with QuickBooks:
                </p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>We access only the data necessary for invoicing and customer synchronization</li>
                  <li>Your QuickBooks data remains under Intuit's privacy policy</li>
                  <li>You can disconnect the integration at any time</li>
                  <li>We follow QuickBooks API security and privacy standards</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">5. Data Security</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  We implement appropriate security measures to protect your information:
                </p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>Encrypted data transmission using SSL/TLS protocols</li>
                  <li>Secure database storage with access controls</li>
                  <li>Regular security assessments and updates</li>
                  <li>Employee training on data protection practices</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">6. Your Rights and Choices</h2>
              <div className="space-y-3 text-gray-700">
                <p>You have the right to:</p>
                <ul className="list-disc ml-6 space-y-1">
                  <li>Access and update your personal information</li>
                  <li>Request deletion of your account and data</li>
                  <li>Opt out of non-essential communications</li>
                  <li>Export your business data</li>
                  <li>Disconnect third-party integrations</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">7. Data Retention</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  We retain your information for as long as your account is active or as needed to provide services. We may retain certain information for legitimate business purposes or legal compliance after account closure.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">8. Children's Privacy</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  Our service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">9. Changes to This Privacy Policy</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  We may update this privacy policy from time to time. We will notify you of any changes by posting the new policy on this page and updating the effective date.
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3 text-gray-800">10. Contact Us</h2>
              <div className="space-y-3 text-gray-700">
                <p>
                  If you have any questions about this privacy policy, please contact us at:
                </p>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="font-semibold">IrrigoPro Support</p>
                  <p>Email: privacy@irrigopro.com</p>
                  <p>Address: [Your Business Address]</p>
                </div>
              </div>
            </section>

            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
                <span>Powered by</span>
                <div className="flex items-center space-x-2">
                  <img 
                    src="/api/placeholder/24/24" 
                    alt="VRTSync" 
                    className="w-6 h-6"
                  />
                  <span className="font-semibold text-blue-600">VRTSync</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}