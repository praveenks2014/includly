import { BookOpen } from "lucide-react";
import { ComingSoon } from "@/components/ComingSoon";

export default function ResourcesPage() {
  return (
    <ComingSoon
      icon={BookOpen}
      title="Resources coming soon"
      description="Expert guides, therapy tips, and in-depth resources for families navigating special needs."
    />
  );
}
