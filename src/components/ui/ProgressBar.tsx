interface ProgressBarProps {
  value: number;
  label: string;
  tone?: 'primary' | 'amber' | 'purple';
}

const toneClasses = {
  primary: 'bg-primary',
  amber: 'bg-amber-500',
  purple: 'bg-purple-500',
};

export function ProgressBar({ value, label, tone = 'primary' }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium tabular-nums text-foreground">{clamped}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className={`h-full rounded-full transition-all ${toneClasses[tone]}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
