import { PageContainer, PageContent, PageHeader } from "@/components/ui/page-header";
import { WetChecksTab } from "@/components/billing-workspace/wet-checks-tab";

export default function WetCheckBillings() {
  return (
    <PageContainer>
      <PageHeader
        title="Wet Check Billings"
        subtitle="Auto-generated from wet check submissions"
      />
      <PageContent>
        <WetChecksTab />
      </PageContent>
    </PageContainer>
  );
}
