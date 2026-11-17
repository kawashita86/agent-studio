import type { ReactNode, Ref } from 'react'
import styles from './OverviewView.module.css'

interface CardProps {
  title: string
  /** Grid area name, see OverviewView.module.css. */
  area: 'needs' | 'lastHour' | 'sessions' | 'events' | 'timeline' | 'waits'
  /** Short text on the right of the title. */
  meta?: ReactNode
  /** Controls placed in the header, before the meta text. */
  actions?: ReactNode
  /** Makes the card focusable by code (not by Tab), so a chip can bring the user here. */
  focusRef?: Ref<HTMLElement>
  /** Highlights the card with an amber accent (stripe, pulsing dot, pill count). */
  attention?: boolean
  children: ReactNode
}

export function Card({ title, area, meta, actions, attention, focusRef, children }: CardProps) {
  return (
    <section className={`${styles.card} ${styles[area]} ${attention ? styles.attention : ''}`}
      data-attention={attention ? 'true' : undefined}
      aria-label={title}
      ref={focusRef}
      tabIndex={focusRef ? -1 : undefined}
    >
      <header className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>
          {attention && <span className={styles.attentionDot} aria-hidden="true" />}
          {title}
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
