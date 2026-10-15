import type { Barcode } from "@/server/barcode";

/**
 * Renders a Code 128 barcode as plain SVG rectangles (black on white, crisp
 * when printed, no images and no innerHTML). The human-readable asset ID is
 * printed separately below it by the caller.
 */
export function BarcodeSvg({ barcode, label, className }: { barcode: Barcode; label: string; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${barcode.modules} 40`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={className}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={barcode.modules} height={40} fill="#ffffff" />
      {barcode.bars.map(([x, w]) => (
        <rect key={x} x={x} y={0} width={w} height={40} fill="#000000" />
      ))}
    </svg>
  );
}
