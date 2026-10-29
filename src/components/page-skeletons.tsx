import { Skeleton } from "@/components/ui/skeleton";

/**
 * Piezas reutilizables para mostrar un estado de carga de verdad (en vez de
 * "..." o guiones) mientras las queries principales de una pantalla están
 * en vuelo. No reemplazan los Skeletons a medida de cada caso particular,
 * son el mínimo común para las pantallas de más tráfico.
 */

export function KpiSkeletons({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className = "h-[250px] w-full rounded-lg" }: { className?: string }) {
  return <Skeleton className={className} />;
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}
