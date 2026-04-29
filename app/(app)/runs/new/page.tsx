// new run page
import { NewRunForm } from "@/components/new-run-form";

export const dynamic = "force-dynamic";

export default function NewRunPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New staging run</h1>
        <p className="text-sm text-muted-foreground">
          Paste a Zillow listing and pick the boards we should use as style references.
        </p>
      </div>
      <NewRunForm />
    </div>
  );
}
