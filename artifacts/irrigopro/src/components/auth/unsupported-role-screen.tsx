import { Button } from "@/components/ui/button";
import { clearSessionAndLogout } from "@/lib/queryClient";

export function UnsupportedRoleScreen({ role }: { role: string }) {
  return (
    <div className="max-w-sm mx-auto mt-24 rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">No screens for this account</h1>
      <p className="mt-3 text-sm text-gray-600">
        This account&apos;s role ({role}) has no screens in IrrigoPro yet. Ask your company admin to check your role.
      </p>
      <Button className="mt-6" onClick={clearSessionAndLogout}>Log out</Button>
    </div>
  );
}
