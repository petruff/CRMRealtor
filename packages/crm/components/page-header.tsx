import type { ReactNode } from 'react';

/**
 * One header rhythm for every hub: small eyebrow, confident title, one line of
 * purpose, and actions aligned right on desktop / stacked on phones.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleId,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="ox-page-header">
      <div className="min-w-0">
        {eyebrow ? <p className="ox-eyebrow">{eyebrow}</p> : null}
        <h1 id={titleId} className="ox-page-title">{title}</h1>
        {description ? <p className="ox-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="ox-page-actions">{actions}</div> : null}
    </header>
  );
}
