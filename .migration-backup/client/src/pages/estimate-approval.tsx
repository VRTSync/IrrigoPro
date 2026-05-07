import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";

export default function EstimateApproval() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'not-found'>('loading');
  const [estimateNumber, setEstimateNumber] = useState<string>('');
  const [customerEmail, setCustomerEmail] = useState<string>('');

  useEffect(() => {
    // Get token from URL path
    const pathParts = window.location.pathname.split('/');
    const token = pathParts[pathParts.length - 1];
    
    if (!token || token === 'estimate-approval') {
      setStatus('not-found');
      return;
    }

    // Process the approval
    const processApproval = async () => {
      try {
        const response = await fetch(`/api/estimates/approve-via-token/${token}`, {
          method: 'GET',
        });

        if (response.ok) {
          // Try to extract estimate info from response if it's JSON
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            setEstimateNumber(data.estimateNumber || '');
            setCustomerEmail(data.customerEmail || '');
          }
          setStatus('success');
        } else {
          setStatus('error');
        }
      } catch (error) {
        console.error('Error processing approval:', error);
        setStatus('error');
      }
    };

    processApproval();
  }, []);

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Processing Your Approval</h1>
            <p className="text-gray-600">Please wait while we confirm your estimate approval...</p>
          </div>
        );

      case 'success':
        return (
          <div className="text-center">
            <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-green-600 mb-4">Estimate Approved!</h1>
            {estimateNumber && (
              <p className="text-lg text-gray-700 mb-3">
                Thank you for approving estimate <strong>{estimateNumber}</strong>.
              </p>
            )}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <p className="text-green-800 font-medium mb-2">What happens next?</p>
              <ul className="text-green-700 text-sm space-y-1 text-left">
                <li>• We will contact you soon with scheduling details</li>
                <li>• A work order will be created for your project</li>
                <li>• You'll receive confirmation via email</li>
              </ul>
            </div>
            {customerEmail && (
              <p className="text-gray-500 text-sm">
                A confirmation email has been sent to {customerEmail}
              </p>
            )}
          </div>
        );

      case 'error':
        return (
          <div className="text-center">
            <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-red-600 mb-4">Approval Failed</h1>
            <p className="text-gray-700 mb-4">
              We encountered an error while processing your approval.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 text-sm">
                Please contact us directly to confirm your estimate approval, or try the link again.
              </p>
            </div>
          </div>
        );

      case 'not-found':
        return (
          <div className="text-center">
            <AlertCircle className="h-16 w-16 text-yellow-600 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-yellow-600 mb-4">Invalid Link</h1>
            <p className="text-gray-700 mb-4">
              This approval link appears to be invalid or has expired.
            </p>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800 text-sm">
                Please contact us if you need a new approval link for your estimate.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Card className="w-full max-w-lg bg-white shadow-lg">
        <CardContent className="p-8">
          {renderContent()}
          <div className="mt-8 pt-6 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500">
              You can now close this window.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}