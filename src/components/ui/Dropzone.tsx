import { UploadCloud } from 'lucide-react';
import { useId, useState } from 'react';
import type { DragEvent } from 'react';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  accept: string;
  maxBytes: number;
  onError: (message: string) => void;
  multiple?: boolean;
}

export function Dropzone({ onFiles, accept, maxBytes, onError, multiple = false }: DropzoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  const handle = (list: FileList | File[] | null | undefined) => {
    const picked = Array.from(list ?? []);
    if (picked.length === 0) return;
    const valid: File[] = [];
    for (const file of picked) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        onError(`${file.name} is not a CSV file. Only CSV files are supported right now.`);
        return;
      }
      if (file.size > maxBytes) {
        onError(`${file.name} is too large. The limit is ${Math.round(maxBytes / 1024 / 1024)} MB per file.`);
        return;
      }
      valid.push(file);
    }
    onFiles(multiple ? valid : valid.slice(0, 1));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    handle(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${
        dragging ? 'border-primary bg-accent' : 'border-border bg-muted/40'
      }`}
    >
      <UploadCloud size={28} className="text-primary" aria-hidden="true" />
      <p className="font-medium">{multiple ? 'Drop CSV files here' : 'Drop a CSV here'}</p>
      <p className="text-xs text-muted-foreground">or</p>
      <label htmlFor={inputId} className="btn-secondary cursor-pointer">
        {multiple ? 'Choose files' : 'Choose file'}
      </label>
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          handle(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
