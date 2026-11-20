import { useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListInvoiceGuideVersionsQueryKey, useListInvoiceGuideVersions,
  useUploadInvoiceGuideVersion, type InvoiceGuideVersion,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { openAuthedPdf } from "@/lib/open-authed-pdf";

const MAX_GUIDE_BYTES = 5 * 1024 * 1024;

function serverMessage(error: unknown, fallback: string) {
  const data = (error as { data?: { message?: unknown } } | null)?.data;
  return typeof data?.message === "string" ? data.message : fallback;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result.slice(reader.result.indexOf(",") + 1));
      else reject(new Error("Could not read the selected PDF."));
    };
    reader.onerror = reader.onabort = () => reject(new Error("Could not read the selected PDF."));
    reader.readAsDataURL(file);
  });
}

export function DocumentsTab() {
  const fileInput = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const query = useListInvoiceGuideVersions({
    query: { queryKey: getListInvoiceGuideVersionsQueryKey(), staleTime: 0 },
  });
  const upload = useUploadInvoiceGuideVersion({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListInvoiceGuideVersionsQueryKey() });
        toast({ title: "Invoice guide uploaded" });
      },
      onError: (error) => toast({
        title: "Couldn't upload the invoice guide",
        description: serverMessage(error, "Try again."),
        variant: "destructive",
      }),
    },
  });

  async function selectFile(file?: File) {
    if (!file || upload.isPending) return;
    if (file.size < 1 || file.size > MAX_GUIDE_BYTES) {
      toast({ title: "The guide must be a PDF of 5 MB or less.", variant: "destructive" });
      return;
    }
    let contentBase64: string;
    try {
      contentBase64 = await readBase64(file);
    } catch {
      toast({ title: "Could not read the selected PDF.", variant: "destructive" });
      return;
    }
    upload.mutate({ data: { filename: file.name, contentBase64 } });
  }

  async function view(doc: InvoiceGuideVersion) {
    const result = await openAuthedPdf(`/api/platform-documents/${doc.id}/file`);
    if (!result.ok) toast({ title: result.message, variant: "destructive" });
  }

  const current = query.data?.current;
  return (
    <Card className="min-w-0" data-testid="card-invoice-guide">
      <CardHeader><CardTitle>Understanding Your Invoice</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        {query.isPending ? (
          <p role="status" className="text-sm text-muted-foreground">Loading invoice guide versions…</p>
        ) : query.isError ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">{serverMessage(query.error, "Could not load the invoice guide versions.")}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()} data-testid="button-retry-invoice-guide">Retry</Button>
          </div>
        ) : (
          <>
            <input ref={fileInput} type="file" accept="application/pdf" className="hidden" aria-label="Select invoice guide PDF"
              data-testid="input-invoice-guide" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void selectFile(file);
              }} />
            <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-start md:justify-between">
              {current ? (
                <div className="min-w-0 space-y-1 [overflow-wrap:anywhere]" data-testid="text-current-invoice-guide">
                  <p className="font-medium">{current.filename}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatSize(current.byteSize)} · {current.pageCount} {current.pageCount === 1 ? "page" : "pages"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Uploaded {new Date(current.uploadedAt).toLocaleDateString()} by {current.uploaderName}
                  </p>
                </div>
              ) : <p className="text-sm text-muted-foreground">No guide uploaded. Invoice emails go without it.</p>}
              <div className="flex shrink-0 flex-wrap gap-2">
                {current && <Button variant="outline" onClick={() => void view(current)} data-testid="button-view-current-invoice-guide">View</Button>}
                <Button disabled={upload.isPending} onClick={() => fileInput.current?.click()} data-testid="button-upload-invoice-guide">
                  {upload.isPending ? "Uploading…" : current ? "Replace" : "Upload"}
                </Button>
              </div>
            </div>
            {!!query.data.history.length && (
              <section className="space-y-2 border-t pt-4">
                <h3 className="text-sm font-semibold">Earlier versions</h3>
                <ul className="divide-y">
                  {query.data.history.map((doc) => (
                    <li key={doc.id} className="flex min-w-0 flex-col gap-2 py-2 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
                        <p className="font-medium">{doc.filename}</p>
                        <p className="text-muted-foreground">{new Date(doc.uploadedAt).toLocaleDateString()}</p>
                      </div>
                      <Button className="self-start" size="sm" variant="outline" onClick={() => void view(doc)}
                        data-testid={`button-view-invoice-guide-${doc.id}`}>View</Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
