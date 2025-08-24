import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building, Mail, Phone, Globe, MapPin, Image, Upload } from "lucide-react";
import type { Company, InsertCompany } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import CompanySetup from "@/components/company/company-setup";
import { ObjectUploader } from "@/components/ObjectUploader";

const companyProfileSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  logo: z.string().optional(),
  subscription: z.enum(["basic", "pro", "enterprise"]).optional(),
});

type CompanyProfileFormData = z.infer<typeof companyProfileSchema>;

export default function CompanyProfile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [requiresSetup, setRequiresSetup] = useState(false);

  // Get current user info from localStorage for now (working solution)
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const companyId = user?.companyId;

  // Fetch company profile
  const { data: company, isLoading, error } = useQuery<Company>({
    queryKey: [`/api/company/${companyId}/profile`],
    enabled: !!companyId,
    retry: false,
  });

  // Check if setup is required based on error response
  useEffect(() => {
    if (error && (error.message.includes('404') || error.message.includes('not found'))) {
      setRequiresSetup(true);
    }
  }, [error]);

  // Handle setup completion
  const handleSetupComplete = () => {
    setRequiresSetup(false);
    queryClient.invalidateQueries({ queryKey: [`/api/company/${companyId}/profile`] });
  };

  // If setup is required, show setup component
  if (requiresSetup) {
    return <CompanySetup companyId={companyId} onComplete={handleSetupComplete} />;
  }

  // Set up form with current company data
  const form = useForm<CompanyProfileFormData>({
    resolver: zodResolver(companyProfileSchema),
    defaultValues: {
      name: "",
      address: "",
      phone: "",
      email: "",
      website: "",
      logo: "",
      subscription: "basic",
    },
  });

  // Reset form when company data changes
  useEffect(() => {
    if (company) {
      form.reset({
        name: company.name,
        address: company.address || "",
        phone: company.phone || "",
        email: company.email || "",
        website: company.website || "",
        logo: company.logo || "",
        subscription: company.subscription as "basic" | "pro" | "enterprise",
      });
    }
  }, [company, form]);

  // Update company profile mutation
  const updateCompanyMutation = useMutation({
    mutationFn: async (data: CompanyProfileFormData) => {
      return apiRequest(`/api/company/${companyId}/profile`, "PUT", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/company/${companyId}/profile`] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Company profile updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update company profile",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (data: CompanyProfileFormData) => {
    updateCompanyMutation.mutate(data);
  };

  const handleCancel = () => {
    form.reset();
    setIsEditing(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    console.log("Company profile error:", error);
  }

  if (!company && !isLoading && !error) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-6">
            <div className="text-center text-muted-foreground">
              Company profile not found. CompanyId: {companyId}, User: {JSON.stringify(user)}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building className="h-6 w-6" />
              Company Profile
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your company information and settings
            </p>
          </div>
          {!isEditing && (
            <Button onClick={() => setIsEditing(true)}>
              Edit Profile
            </Button>
          )}
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Company Name */}
                  <div className="space-y-2">
                    <Label htmlFor="name">Company Name *</Label>
                    <Input
                      id="name"
                      {...form.register("name")}
                      disabled={!isEditing}
                      className={!isEditing ? "bg-muted" : ""}
                    />
                    {form.formState.errors.name && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="flex items-center gap-2">
                      <Phone className="h-4 w-4" />
                      Phone Number
                    </Label>
                    <Input
                      id="phone"
                      type="tel"
                      {...form.register("phone")}
                      disabled={!isEditing}
                      className={!isEditing ? "bg-muted" : ""}
                      placeholder="(555) 123-4567"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <Label htmlFor="email" className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      {...form.register("email")}
                      disabled={!isEditing}
                      className={!isEditing ? "bg-muted" : ""}
                      placeholder="contact@company.com"
                    />
                    {form.formState.errors.email && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.email.message}
                      </p>
                    )}
                  </div>

                  {/* Website */}
                  <div className="space-y-2">
                    <Label htmlFor="website" className="flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      Website
                    </Label>
                    <Input
                      id="website"
                      type="url"
                      {...form.register("website")}
                      disabled={!isEditing}
                      className={!isEditing ? "bg-muted" : ""}
                      placeholder="https://www.company.com"
                    />
                    {form.formState.errors.website && (
                      <p className="text-sm text-destructive">
                        {form.formState.errors.website.message}
                      </p>
                    )}
                  </div>
                </div>

                {/* Address */}
                <div className="space-y-2">
                  <Label htmlFor="address" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Business Address
                  </Label>
                  <Textarea
                    id="address"
                    {...form.register("address")}
                    disabled={!isEditing}
                    className={!isEditing ? "bg-muted" : ""}
                    placeholder="123 Main Street, City, State, ZIP"
                    rows={3}
                  />
                </div>

                {/* Subscription Plan */}
                <div className="space-y-2">
                  <Label htmlFor="subscription">Subscription Plan</Label>
                  <select
                    id="subscription"
                    {...form.register("subscription")}
                    disabled={!isEditing}
                    className={`flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${!isEditing ? "bg-muted" : ""}`}
                  >
                    <option value="basic">Basic</option>
                    <option value="pro">Professional</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                {/* Company Logo */}
                <div className="space-y-4">
                  <Label className="flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    Company Logo
                  </Label>
                  
                  {/* Current logo display */}
                  {company?.logo ? (
                    <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/50">
                      <img
                        src={company.logo}
                        alt="Company Logo"
                        className="h-16 w-16 object-contain rounded border"
                        onError={(e) => {
                          console.error('Logo failed to load:', company.logo);
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Current Logo</p>
                        <p className="text-xs text-muted-foreground">Used in emails and documents</p>
                        <p className="text-xs text-blue-600 mt-1">✓ Logo saved</p>
                      </div>
                      {isEditing && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={async () => {
                            try {
                              await apiRequest(`/api/company/${companyId}/logo-reset`, 'PUT');
                              queryClient.invalidateQueries({ queryKey: [`/api/company/${companyId}/profile`] });
                              toast({
                                title: "Logo removed",
                                description: "Company logo has been removed successfully",
                              });
                            } catch (error) {
                              console.error('Error removing logo:', error);
                              toast({
                                title: "Error",
                                description: "Failed to remove logo. Please try again.",
                                variant: "destructive",
                              });
                            }
                          }}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="p-6 border-2 border-dashed border-muted rounded-lg text-center">
                      <Image className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No logo uploaded</p>
                      <p className="text-xs text-muted-foreground">Upload a logo to display your company branding</p>
                    </div>
                  )}

                  {/* Upload new logo when editing */}
                  {isEditing && (
                    <div className="border rounded-lg p-4">
                      <ObjectUploader
                        maxNumberOfFiles={1}
                        maxFileSize={2097152}
                        onGetUploadParameters={async () => {
                          const response = await apiRequest('/api/company/logo/upload', 'POST');
                          return response;
                        }}
                        onComplete={async (uploadUrl) => {
                          console.log('Upload completed with URL:', uploadUrl);
                          try {
                            // Save the logo URL to the company profile
                            console.log('Saving logo to company profile...');
                            const result = await apiRequest(`/api/company/${companyId}/logo`, 'PUT', {
                              logoUrl: uploadUrl
                            });
                            console.log('Logo save result:', result);
                            
                            // Invalidate and refetch company data
                            queryClient.invalidateQueries({ queryKey: [`/api/company/${companyId}/profile`] });
                            
                            toast({
                              title: "Logo uploaded",
                              description: "Your company logo has been uploaded and saved successfully",
                            });
                          } catch (error) {
                            console.error('Error saving logo:', error);
                            toast({
                              title: "Upload error", 
                              description: "Logo uploaded but failed to save. Please try again.",
                              variant: "destructive",
                            });
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <Upload className="h-4 w-4" />
                          Upload New Logo
                        </div>
                      </ObjectUploader>
                      <p className="text-sm text-muted-foreground mt-2">
                        Upload a high-quality logo image (PNG, JPG, or SVG). Maximum size: 2MB.
                        This logo will appear in customer emails and documents.
                      </p>
                    </div>
                  )}
                </div>

                {isEditing && (
                  <div className="flex gap-4 pt-4">
                    <Button
                      type="submit"
                      disabled={updateCompanyMutation.isPending}
                      className="flex-1 sm:flex-initial"
                    >
                      {updateCompanyMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Updating...
                        </>
                      ) : (
                        "Save Changes"
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleCancel}
                      disabled={updateCompanyMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Email Templates */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold text-gray-900 mb-2">Estimate Approval Email</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Template used when sending estimate approval requests to customers
                  </p>
                  <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 font-mono">
                    <div className="space-y-2">
                      <div><strong>Subject:</strong> Estimate #{`{estimateNumber}`} - Approval Required</div>
                      <div><strong>Header:</strong> IRRIGATION ESTIMATE - APPROVAL REQUIRED</div>
                      <div><strong>Content:</strong> Estimate details, project information, work zones</div>
                      <div><strong>Actions:</strong> Approve/Decline links</div>
                      <div><strong>Footer:</strong> Company information and contact details</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-gray-500">
                    Templates automatically include your company logo, name, phone, email, and website
                  </div>
                </div>

                <div className="p-4 border rounded-lg">
                  <h4 className="font-semibold text-gray-900 mb-2">Approval Confirmation Email</h4>
                  <p className="text-sm text-gray-600 mb-3">
                    Template sent to customers after they approve or decline an estimate
                  </p>
                  <div className="bg-gray-50 p-3 rounded text-sm text-gray-700 font-mono">
                    <div className="space-y-2">
                      <div><strong>Subject:</strong> Estimate Approved/Declined - #{`{estimateNumber}`}</div>
                      <div><strong>Content:</strong> Confirmation message with next steps</div>
                      <div><strong>Approved:</strong> "We will begin scheduling your irrigation work..."</div>
                      <div><strong>Declined:</strong> "Thank you for your time. Please feel free to contact us..."</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="text-blue-600 mt-0.5">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <h5 className="font-medium text-blue-900">Professional Email Branding</h5>
                      <p className="text-sm text-blue-800 mt-1">
                        All emails automatically include your company logo and information from this profile. 
                        Update your company details above to customize how your emails appear to customers.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Company Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-primary">
                    {(company as any)?.subscription?.charAt(0).toUpperCase() + (company as any)?.subscription?.slice(1) || "Basic"}
                  </div>
                  <div className="text-sm text-muted-foreground">Current Plan</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-green-600">Active</div>
                  <div className="text-sm text-muted-foreground">Account Status</div>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {(company as any)?.createdAt ? new Date((company as any).createdAt).getFullYear() : new Date().getFullYear()}
                  </div>
                  <div className="text-sm text-muted-foreground">Member Since</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}