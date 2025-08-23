import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, MapPin, Phone, Mail, Building, FileText } from "lucide-react";
import { Customer } from "@shared/schema";

export default function CustomerProfile() {
  const { id } = useParams();
  const [, setLocation] = useLocation();

  const { data: customer, isLoading } = useQuery<Customer>({
    queryKey: [`/api/customers/${id}`],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-24 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="container mx-auto p-4">
        <div className="text-center py-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Customer Not Found</h2>
          <p className="text-gray-600 mb-4">The customer you're looking for doesn't exist.</p>
          <Button onClick={() => setLocation("/customers")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 max-w-4xl space-y-4 lg:space-y-6">
      {/* Mobile Header */}
      <div className="lg:hidden">
        <Button 
          variant="ghost" 
          size="sm"
          onClick={() => setLocation("/customers")}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Customers
        </Button>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">{customer.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">Active Customer</Badge>
            {customer.quickbooksId && (
              <Badge variant="outline">QuickBooks Synced</Badge>
            )}
          </div>
          <Button 
            onClick={() => setLocation(`/customers/${id}/site-map`)}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            <MapPin className="w-4 h-4 mr-2" />
            View Site Map
          </Button>
        </div>
      </div>

      {/* Desktop Header */}
      <div className="hidden lg:flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setLocation("/customers")}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Customers
          </Button>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{customer.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="default">Active Customer</Badge>
              {customer.quickbooksId && (
                <Badge variant="outline">QuickBooks Synced</Badge>
              )}
            </div>
          </div>
        </div>

        <Button 
          onClick={() => setLocation(`/customers/${id}/site-map`)}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <MapPin className="w-4 h-4 mr-2" />
          View Site Map
        </Button>
      </div>

      {/* Customer Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />
            Customer Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mobile Layout */}
          <div className="lg:hidden space-y-4">
            <h3 className="font-semibold text-gray-900 text-lg">Contact Details</h3>
            
            {customer.email && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Mail className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">{customer.email}</span>
              </div>
            )}
            
            {customer.phone && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Phone className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">{customer.phone}</span>
              </div>
            )}
            
            {customer.address && (
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <MapPin className="w-5 h-5 text-blue-600 mt-0.5" />
                <span className="text-sm font-medium leading-relaxed">{customer.address}</span>
              </div>
            )}
          </div>

          {/* Desktop Layout */}
          <div className="hidden lg:block space-y-3">
            <h3 className="font-semibold text-gray-900">Contact Details</h3>
            
            {customer.email && (
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-gray-500" />
                <span className="text-sm">{customer.email}</span>
              </div>
            )}
            
            {customer.phone && (
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-gray-500" />
                <span className="text-sm">{customer.phone}</span>
              </div>
            )}
            
            {customer.address && (
              <div className="flex items-start gap-3">
                <MapPin className="w-4 h-4 text-gray-500 mt-1" />
                <span className="text-sm">{customer.address}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Property Notes */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Property Notes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {customer.propertyNotes ? (
            <div className="lg:prose lg:prose-sm max-w-none">
              <div 
                className="whitespace-pre-wrap text-gray-700 leading-relaxed text-sm lg:text-base p-4 lg:p-0 bg-gray-50 lg:bg-transparent rounded-lg lg:rounded-none"
                style={{ wordBreak: 'break-word' }}
              >
                {customer.propertyNotes}
              </div>
            </div>
          ) : (
            <div className="text-center py-8 lg:py-12 text-gray-500">
              <FileText className="w-10 h-10 lg:w-12 lg:h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm lg:text-base">No property notes available for this customer.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Mobile Quick Actions */}
          <div className="lg:hidden space-y-3">
            <Button 
              onClick={() => setLocation(`/customers/${id}/site-map`)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              size="lg"
            >
              <MapPin className="w-5 h-5 mr-2" />
              View Site Map
            </Button>
            
            {customer.phone && (
              <Button 
                variant="outline"
                onClick={() => window.open(`tel:${customer.phone}`, '_self')}
                className="w-full border-green-600 text-green-600 hover:bg-green-50"
                size="lg"
              >
                <Phone className="w-5 h-5 mr-2" />
                Call Customer
              </Button>
            )}
            
            {customer.email && (
              <Button 
                variant="outline"
                onClick={() => window.open(`mailto:${customer.email}`, '_self')}
                className="w-full border-blue-600 text-blue-600 hover:bg-blue-50"
                size="lg"
              >
                <Mail className="w-5 h-5 mr-2" />
                Email Customer
              </Button>
            )}
          </div>

          {/* Desktop Quick Actions */}
          <div className="hidden lg:flex flex-wrap gap-3">
            <Button 
              variant="outline" 
              onClick={() => setLocation(`/customers/${id}/site-map`)}
            >
              <MapPin className="w-4 h-4 mr-2" />
              View Site Map
            </Button>
            
            {customer.phone && (
              <Button 
                variant="outline"
                onClick={() => window.open(`tel:${customer.phone}`, '_self')}
              >
                <Phone className="w-4 h-4 mr-2" />
                Call Customer
              </Button>
            )}
            
            {customer.email && (
              <Button 
                variant="outline"
                onClick={() => window.open(`mailto:${customer.email}`, '_self')}
              >
                <Mail className="w-4 h-4 mr-2" />
                Email Customer
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}