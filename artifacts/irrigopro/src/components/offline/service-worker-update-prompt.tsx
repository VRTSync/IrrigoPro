import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { initServiceWorker, isOfflineServiceWorkerEnabled } from "@/lib/registerSW";

// Mounted at App root for every role so push delivery keeps working.
export function ServiceWorkerRegistration() {
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void initServiceWorker();
  }, []);
  return null;
}

// Mounted only inside the field-tech layout — installs the update toast.
export function ServiceWorkerUpdatePrompt() {
  const { toast } = useToast();
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (!isOfflineServiceWorkerEnabled()) return;
    void initServiceWorker({
      onNeedRefresh: (acceptUpdate) => {
        toast({
          title: "New version available",
          description: "Reload to get the latest field tools.",
          duration: 30_000,
          action: (
            <ToastAction
              altText="Reload to update"
              onClick={() => {
                void acceptUpdate();
              }}
            >
              Reload
            </ToastAction>
          ),
        });
      },
    });
  }, [toast]);
  return null;
}
