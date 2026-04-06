import { useState, useCallback } from "react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];

interface UploadResult {
  objectPath: string;
  uploadURL: string;
}

interface UseFileUploadOptions {
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: string) => void;
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      setError(null);
      setProgress(0);

      if (!ALLOWED_TYPES.includes(file.type)) {
        const msg = "Only PDF, JPG, and PNG files are allowed";
        setError(msg);
        options.onError?.(msg);
        return null;
      }

      if (file.size > MAX_FILE_SIZE) {
        const msg = "File size must be under 10MB";
        setError(msg);
        options.onError?.(msg);
        return null;
      }

      setIsUploading(true);
      try {
        const metaRes = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType: file.type,
          }),
        });

        if (!metaRes.ok) {
          throw new Error("Failed to get upload URL");
        }

        const { uploadURL, objectPath } = await metaRes.json() as { uploadURL: string; objectPath: string };

        setProgress(20);

        const uploadRes = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!uploadRes.ok) {
          throw new Error("Failed to upload file");
        }

        setProgress(100);
        const result = { objectPath, uploadURL };
        options.onSuccess?.(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
        options.onError?.(msg);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [options]
  );

  return { uploadFile, isUploading, progress, error };
}
