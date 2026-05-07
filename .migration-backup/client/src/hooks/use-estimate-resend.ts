import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, parseApiError, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ResendArgs {
  id: number;
  email: string;
}

export function useEstimateResend() {
  const { toast } = useToast();
  const [resendingId, setResendingId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ id }: ResendArgs) => {
      return apiRequest(`/api/estimates/${id}/transition`, "POST", {
        action: "resend",
      });
    },
    onSuccess: (_data, variables) => {
      toast({
        title: "Estimate resent",
        description: `Estimate resent to ${variables.email}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
    },
    onError: (error) => {
      toast({
        title: "Couldn't resend estimate",
        description: parseApiError(error, "Couldn't resend estimate. Please try again."),
        variant: "destructive",
      });
    },
    onSettled: () => {
      setResendingId(null);
    },
  });

  const resendEstimate = async (id: number, email: string) => {
    setResendingId(id);
    return mutation.mutateAsync({ id, email });
  };

  return {
    resendEstimate,
    isResending: mutation.isPending,
    resendingId,
  };
}
