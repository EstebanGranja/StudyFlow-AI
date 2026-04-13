type LoadingSpinnerProps = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

function resolveSizeClasses(size: LoadingSpinnerProps["size"]): string {
  if (size === "sm") {
    return "h-4 w-4 border-2";
  }

  if (size === "lg") {
    return "h-10 w-10 border-[3px]";
  }

  return "h-6 w-6 border-2";
}

export function LoadingSpinner({ size = "md", className }: LoadingSpinnerProps) {
  const sizeClasses = resolveSizeClasses(size);
  const customClasses = className ? ` ${className}` : "";

  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-zinc-600 border-t-teal-300 ${sizeClasses}${customClasses}`}
    />
  );
}
