import { useState, useEffect } from "react";
import { safeSet } from "@/utils/safeStorage";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { 
  Loader2, 
  Building2, 
  Users, 
  CheckCircle, 
  ArrowRight, 
  ArrowLeft,
  Sparkles,
  Target,
  Shield,
  Zap
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import irrigoproLogo from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";

const companySetupSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  address: z.string().min(1, "Address is required for billing and service"),
  phone: z.string().min(1, "Phone number is required"),
  email: z.string().email("Invalid email").min(1, "Email is required"),
  website: z.string().url("Invalid website URL").optional().or(z.literal("")),
  subscription: z.enum(["basic", "pro", "enterprise"]).default("basic"),
});

const adminSetupSchema = z.object({
  name: z.string().min(1, "Your name is required"),
  email: z.string().email("Invalid email").min(1, "Email is required"),
});

type CompanySetupFormData = z.infer<typeof companySetupSchema>;
type AdminSetupFormData = z.infer<typeof adminSetupSchema>;

interface OnboardingFlowProps {
  companyId: number;
  currentUser: any;
  onComplete: () => void;
}

export default function OnboardingFlow({ companyId, currentUser, onComplete }: OnboardingFlowProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [isCompleting, setIsCompleting] = useState(false);

  const companyForm = useForm<CompanySetupFormData>({
    resolver: zodResolver(companySetupSchema),
    defaultValues: {
      name: "",
      address: "",
      phone: "",
      email: "",
      website: "",
      subscription: "basic",
    },
  });

  const adminForm = useForm<AdminSetupFormData>({
    resolver: zodResolver(adminSetupSchema),
    defaultValues: {
      name: currentUser?.name || "",
      email: currentUser?.email || "",
    },
  });

  const createCompanyMutation = useMutation({
    mutationFn: async (data: CompanySetupFormData) => {
      return apiRequest(`/api/company/${companyId}/profile`, "PUT", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Company profile updated successfully!",
      });
      setCurrentStep(3);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update company profile",
        variant: "destructive",
      });
    },
  });

  const updateAdminMutation = useMutation({
    mutationFn: async (data: AdminSetupFormData) => {
      return apiRequest(`/api/users/${currentUser.id}`, "PATCH", data);
    },
    onSuccess: () => {
      // Update stored user (safe for Safari private browsing)
      const updatedUser = { ...currentUser, ...adminForm.getValues() };
      safeSet("user", JSON.stringify(updatedUser));
      
      setCurrentStep(4);
      toast({
        title: "Profile Updated",
        description: "Your administrator profile has been updated!",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error", 
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const completeOnboarding = async () => {
    setIsCompleting(true);
    
    // Mark onboarding as complete (safe for Safari private browsing)
    safeSet("onboarding_completed", "true");
    
    // Refresh queries
    await queryClient.invalidateQueries({ queryKey: [`/api/company/${companyId}/profile`] });
    
    setTimeout(() => {
      setIsCompleting(false);
      onComplete();
      toast({
        title: "Welcome to IrrigoPro!",
        description: "Your company setup is complete. Let's get started!",
      });
    }, 2000);
  };

  const onCompanySubmit = (data: CompanySetupFormData) => {
    createCompanyMutation.mutate(data);
  };

  const onAdminSubmit = (data: AdminSetupFormData) => {
    updateAdminMutation.mutate(data);
  };

  const getProgressPercentage = () => {
    switch (currentStep) {
      case 1: return 0;
      case 2: return 33;
      case 3: return 66;
      case 4: return 100;
      default: return 0;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-center mb-4">
            <img src={irrigoproLogo} alt="IrrigoPro" className="h-12 w-auto" />
          </div>
          <div className="text-center mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Welcome to IrrigoPro</h1>
            <p className="text-gray-600">Let's get your irrigation business set up</p>
          </div>
          <Progress value={getProgressPercentage()} className="w-full h-2" />
          <div className="flex justify-between text-sm text-gray-500 mt-2">
            <span>Welcome</span>
            <span>Company Info</span>
            <span>Your Profile</span>
            <span>Complete</span>
          </div>
        </div>

        {/* Step 1: Welcome */}
        {currentStep === 1 && (
          <Card className="shadow-2xl border-0">
            <CardHeader className="text-center pb-4">
              <div className="flex justify-center mb-6">
                <div className="bg-blue-100 p-4 rounded-full">
                  <Sparkles className="h-12 w-12 text-blue-600" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold text-gray-900">
                Welcome to IrrigoPro!
              </CardTitle>
              <p className="text-lg text-gray-600 mt-4 max-w-2xl mx-auto">
                The complete irrigation business management platform. Let's set up your company 
                profile and get you started with powerful tools to manage estimates, work orders, 
                billing, and field operations.
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="text-center p-6 bg-blue-50 rounded-xl">
                  <Target className="h-8 w-8 text-blue-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">Complete Business Workflow</h3>
                  <p className="text-sm text-gray-600">From estimates to invoices, manage your entire irrigation business</p>
                </div>
                <div className="text-center p-6 bg-green-50 rounded-xl">
                  <Shield className="h-8 w-8 text-green-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">QuickBooks Integration</h3>
                  <p className="text-sm text-gray-600">Seamless accounting and invoice management</p>
                </div>
                <div className="text-center p-6 bg-purple-50 rounded-xl">
                  <Zap className="h-8 w-8 text-purple-600 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">Mobile-First Design</h3>
                  <p className="text-sm text-gray-600">Perfect for field technicians and mobile work</p>
                </div>
              </div>
              <div className="text-center">
                <Button 
                  onClick={() => setCurrentStep(2)}
                  size="lg"
                  className="px-8 py-3 text-lg"
                >
                  Get Started
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Company Setup */}
        {currentStep === 2 && (
          <Card className="shadow-2xl border-0">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <Building2 className="h-12 w-12 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Tell us about your company</CardTitle>
              <p className="text-gray-600">
                This information helps us personalize your experience and set up billing.
              </p>
            </CardHeader>
            <CardContent>
              <Form {...companyForm}>
                <form onSubmit={companyForm.handleSubmit(onCompanySubmit)} className="space-y-6">
                  <FormField
                    control={companyForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Green Valley Irrigation Co." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={companyForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number *</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={companyForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Email *</FormLabel>
                          <FormControl>
                            <Input placeholder="contact@greenvalley.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={companyForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Address *</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="123 Main Street, City, State, ZIP"
                            className="min-h-[100px]"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={companyForm.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Website</FormLabel>
                        <FormControl>
                          <Input placeholder="https://www.greenvalley.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={companyForm.control}
                    name="subscription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Choose Your Plan</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a plan" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="basic">
                              <div className="flex flex-col">
                                <span className="font-medium">Basic Plan</span>
                                <span className="text-xs text-gray-500">Perfect for small teams</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="pro">
                              <div className="flex flex-col">
                                <span className="font-medium">Pro Plan</span>
                                <span className="text-xs text-gray-500">Advanced features & integrations</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="enterprise">
                              <div className="flex flex-col">
                                <span className="font-medium">Enterprise Plan</span>
                                <span className="text-xs text-gray-500">Full customization & support</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-between pt-6">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCurrentStep(1)}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={createCompanyMutation.isPending}
                      className="min-w-[120px]"
                    >
                      {createCompanyMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Admin Profile Setup */}
        {currentStep === 3 && (
          <Card className="shadow-2xl border-0">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <Users className="h-12 w-12 text-blue-600" />
              </div>
              <CardTitle className="text-2xl">Set up your administrator profile</CardTitle>
              <p className="text-gray-600">
                As the company admin, you'll have full access to manage users, settings, and operations.
              </p>
            </CardHeader>
            <CardContent>
              <Form {...adminForm}>
                <form onSubmit={adminForm.handleSubmit(onAdminSubmit)} className="space-y-6">
                  <FormField
                    control={adminForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Full Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="John Smith" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={adminForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Your Email Address *</FormLabel>
                        <FormControl>
                          <Input placeholder="john@greenvalley.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="bg-blue-50 p-4 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">Administrator Privileges</h3>
                    <ul className="text-sm text-blue-800 space-y-1">
                      <li>• Manage company settings and billing</li>
                      <li>• Add and manage team members</li>
                      <li>• Access all estimates, work orders, and invoices</li>
                      <li>• Configure QuickBooks integration</li>
                      <li>• View comprehensive business analytics</li>
                    </ul>
                  </div>

                  <div className="flex justify-between pt-6">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCurrentStep(2)}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                    <Button
                      type="submit"
                      disabled={updateAdminMutation.isPending}
                      className="min-w-[120px]"
                    >
                      {updateAdminMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Updating...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Welcome Complete */}
        {currentStep === 4 && (
          <Card className="shadow-2xl border-0">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-6">
                <div className="bg-green-100 p-4 rounded-full">
                  <CheckCircle className="h-12 w-12 text-green-600" />
                </div>
              </div>
              <CardTitle className="text-3xl font-bold text-gray-900">
                You're all set up!
              </CardTitle>
              <p className="text-lg text-gray-600 mt-4">
                Welcome to IrrigoPro! Your irrigation business management platform is ready to use.
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid md:grid-cols-2 gap-6 mb-8">
                <div className="p-6 bg-gray-50 rounded-xl">
                  <h3 className="font-semibold text-gray-900 mb-3">Next Steps:</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li>• Add your first customer</li>
                    <li>• Create parts catalog</li>
                    <li>• Set up your first estimate</li>
                    <li>• Configure QuickBooks integration</li>
                    <li>• Invite team members</li>
                  </ul>
                </div>
                <div className="p-6 bg-blue-50 rounded-xl">
                  <h3 className="font-semibold text-gray-900 mb-3">Your Role:</h3>
                  <p className="text-sm text-gray-600 mb-3">Company Administrator</p>
                  <ul className="space-y-2 text-xs text-gray-500">
                    <li>• Full system access</li>
                    <li>• User management</li>
                    <li>• Billing & settings</li>
                    <li>• Business analytics</li>
                  </ul>
                </div>
              </div>
              <div className="text-center">
                <Button 
                  onClick={completeOnboarding}
                  size="lg"
                  className="px-8 py-3 text-lg"
                  disabled={isCompleting}
                >
                  {isCompleting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      Enter IrrigoPro Dashboard
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}