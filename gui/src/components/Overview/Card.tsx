import type { ReactNode } from 'react'
import styles from './OverviewView.module.css'

interface CardProps {
  title: string
  /** Grid area name, see OverviewView.module.css. */
  area: 'usage' | 'needs' | 'lastHour' | 'sessions' | 'events' | 'timeline' | 'waits'
  /** Short text on the right of the title. */
  meta?: ReactNode
  /** Controls placed in the header, before the meta text. */
  actions?: ReactNode
  /** Makes the title a button, for example to open a chart. */
  onTitleClick?: (trigger: HTMLElement) => void
  titleExpanded?: boolean
  titleLabel?: string
  /** Highlights the card with an amber accent (stripe, pulsing dot, pill count). */
  attention?: boolean
  children: ReactNode
}

export function Card({ title, area, meta, actions, attention, onTitleClick, titleExpanded, titleLabel, children }: CardProps) {
  return (
    <section className={`${styles.card} ${styles[area]} ${attention ? styles.attention : ''}`}
      data-attention={attention ? 'true' : undefined}
      aria-label={title}
    >
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          {attention && <span className={styles.attentionDot} aria-hidden="true" />}
          {onTitleClick ? (
            <button
              type="button"
              className={styles.cardTitleBtn}
              aria-expanded={titleExpanded ?? false}
              aria-label={titleLabel}
              onClick={(e) => onTitleClick(e.currentTarget)}
            >
              {title}
            </button>
          ) : (
            title
          )}
        </h3>
        {(actions || meta !== undefined) && (
          <div className={styles.cardHeaderEnd}>
            {actions}
            {meta !== undefined && <span className={styles.cardMeta}>{meta}</span>}
          </div>
        )}
      </header>
      <div className={styles.cardBody}>{children}</div>
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>
}
