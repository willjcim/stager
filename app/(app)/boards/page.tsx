// boards page
import { BoardsManager } from "@/components/boards-manager";

export const dynamic = "force-dynamic";

export default function BoardsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Pinterest boards</h1>
        <p className="text-sm text-muted-foreground">
          Add a board by URL. We&apos;ll scrape its pins and cache them so you can use it as a style
          reference on future runs.
        </p>
      </div>
      <BoardsManager />
    </div>
  );
}
