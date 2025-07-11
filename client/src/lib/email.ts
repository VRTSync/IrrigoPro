import { apiRequest } from "./queryClient";

export interface EmailEstimateData {
  estimateId: number;
  customerEmail: string;
  customerName: string;
  projectName: string;
  totalAmount: string;
}

export const sendEstimateEmail = async (data: EmailEstimateData): Promise<void> => {
  await apiRequest("POST", `/api/estimates/${data.estimateId}/email`, data);
};

export const generateEstimatePDF = async (estimateId: number): Promise<{ downloadUrl: string }> => {
  const response = await apiRequest("POST", `/api/estimates/${estimateId}/pdf`);
  return response.json();
};
