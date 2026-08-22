import Image from 'next/image';
import { POWERED_BY, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/brand';

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Omnix"
      className="omnix-brand-mark shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark size={compact ? 32 : 36} />
      <div className="min-w-0">
        <p className={`${compact ? 'text-base' : 'text-lg'} font-display font-medium leading-none text-ink`}>{PRODUCT_NAME}</p>
        <p className={`${compact ? 'text-[10px]' : 'text-xs'} mt-0.5 truncate text-muted`}>{PRODUCT_TAGLINE}</p>
      </div>
    </div>
  );
}

export function CyryxAttribution() {
  return <p className="text-[10px] font-medium tracking-wide text-subtle">{POWERED_BY}</p>;
}

export function CyryxFooterLogo({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-[#aaa69e]">Powered by</span>
      <Image
        src="/cyryx-labs-footer.png"
        width={720}
        height={218}
        alt="Cyryx Labs"
        sizes="96px"
        className="h-auto w-24 object-contain"
      />
    </div>
  );
}
