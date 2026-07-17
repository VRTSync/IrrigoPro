import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, parseApiError, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ResendPayload {
  to: string;
  cc: string[];
  bcc: string[];
  note?: string;
}

interface ResendArgs {
  id: number;
  payload: ResendPayload;
}

export function useEstimateResend() {
  const { toast } = useToast();
  const [resendingId, setResendingId] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ id, payload }: ResendArgs) => {
      return apiRequest(`/api/estimates/${id}/resend`, "POST", payload);
    },
    onSuccess: (_data, variables) => {
      toast({
        title: "Estimate resent",
        description: `Estimate resent to ${variables.payload.to}`,
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

  const resendEstimate = async (id: number, payload: ResendPayload) => {
    setResendingId(id);
    return mutation.mutateAsync({ id, payload });
  };

  return {
    resendEstimate,
    isResending: mutation.isPending,
    resendingId,
  };
}
