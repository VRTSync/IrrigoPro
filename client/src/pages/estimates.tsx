import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EstimateWizard } from "@/components/estimates/estimate-wizard";
import { EstimateDetailModal } from "@/components/estimates/estimate-detail-modal";
import { QuickBooksIntegration } from "@/components/quickbooks/quickbooks-integration";
import { EstimateBoard } from "@/components/estimates/board/estimate-board";
import { useState, useEffect } from "react";
import { safeGet } from "@/utils/safeStorage";
import type { Estimate } from "@shared/schema";

export default function Estimates() {
  const [showEstimateWizard, setShowEstimateWizard] = useState(false);
  const [selectedEstimateId, setSelectedEstimateId] = useState<number | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [editEstimateId, setEditEstimateId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const queryClient = useQueryClient();

  const getCurrentUser = () => {
    const savedUser = safeGet("user");
    return savedUser ? JSON.parse(savedUser) : null;
  };
  const currentUser = getCurrentUser();
  const isIrrigationManager = currentUser?.role === "irrigation_manager";
  const isFieldTech = currentUser?.role === "field_tech";

  // ?create=true → open wizard
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("create") === "true") {
      setShowEstimateWizard(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // ?openEstimate=<id> → open detail modal
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("openEstimate");
    if (!v) return;
    const idNum = parseInt(v, 10);
    if (!Number.isFinite(idNum)) return;
    setSelectedEstimateId(idNum);
    setShowDetailModal(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("openEstimate");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const { data: estimates, isLoading, isError } = useQuery<Estimate[]>({
    queryKey: ["/api/estimates"],
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      await queryClient.refetchQueries({ queryKey: ["/api/estimates"] });
    } finally {
      setRefreshing(false);
    }
  };

  const handleCardClick = (estimateId: number) => {
    setSelectedEstimateId(estimateId);
    setShowDetailModal(true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <Tabs defaultValue="estimates" className="space-y-6">
        <TabsList
          className={`grid w-full ${
            isIrrigationManager || isFieldTech ? "grid-cols-1" : "grid-cols-2"
          }`}
        >
          <TabsTrigger value="estimates">Estimates</TabsTrigger>
          {!isIrrigationManager && !isFieldTech && (
            <TabsTrigger value="quickbooks">QuickBooks</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="estimates">
          <EstimateBoard
            estimates={estimates}
            isLoading={isLoading}
            isError={isError}
            refreshing={refreshing}
            onCardClick={handleCardClick}
            onRefresh={handleRefresh}
            onNewEstimate={() => setShowEstimateWizard(true)}
          />
        </TabsContent>

        {!isIrrigationManager && !isFieldTech && (
          <TabsContent value="quickbooks">
            <QuickBooksIntegration />
          </TabsContent>
        )}
      </Tabs>

      <EstimateWizard
        open={showEstimateWizard}
        onOpenChange={(open) => {
          setShowEstimateWizard(open);
          if (!open) setEditEstimateId(null);
        }}
        estimateId={editEstimateId}
      />

      <EstimateDetailModal
        open={showDetailModal}
        onOpenChange={setShowDetailModal}
        estimateId={selectedEstimateId}
        onEdit={(estimateId) => {
          setEditEstimateId(estimateId);
          setShowDetailModal(false);
          setShowEstimateWizard(true);
        }}
      />
    </div>
  );
}
