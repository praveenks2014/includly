import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, CheckCircle2, XCircle } from "lucide-react";
import { useFileUpload } from "@/hooks/useFileUpload";

interface FileUploadFieldProps {
  label: string;
  accept?: string;
  onUploaded: (objectPath: string) => void;
  uploadedPath?: string;
  disabled?: boolean;
}

export function FileUploadField({
  label,
  accept = ".pdf,.jpg,.jpeg,.png",
  onUploaded,
  uploadedPath,
  disabled,
}: FileUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, error } = useFileUpload({
    onSuccess: (result) => onUploaded(result.objectPath),
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-1">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleChange}
        disabled={isUploading || disabled}
      />

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading || disabled}
          className="gap-2"
        >
          {isUploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} />
          )}
          {isUploading ? "Uploading…" : label}
        </Button>

        {uploadedPath && !isUploading && (
          <span className="flex items-center gap-1 text-sm text-green-600">
            <CheckCircle2 size={14} />
            Uploaded
          </span>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <XCircle size={12} />
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">PDF, JPG, or PNG — max 10MB</p>
    </div>
  );
}
