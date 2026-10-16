import type { StoredReport as Report, ReportDimension } from '../lib/report-types';
import styles from './report.module.css';

const dimensions: readonly ReportDimension[] = ['D', 'I', 'S', 'C'];

/** Pure presentation of stored snapshots: no scoring, tie resolution or seed lookup. */
export default function StoredReport({ result }: { result: Report }) {
  return <>
    <section aria-label="Profile result">
      <p className={styles.status}>COMPLETED</p>
      <h2>{result.profileStatus === 'TIED'
        ? `TIED — ${result.candidateProfiles.length} candidate profiles`
        : `SINGLE — ${result.profileCode}`}</h2>
      {result.profileStatus === 'TIED' && <p>All compatible ordered profiles are shown below.</p>}
      <div className={styles.profiles}>
        {result.candidateProfiles.map(profile => <article key={profile.code} className={styles.profileCard} aria-label={`Profile ${profile.code}`}>
          <h3><bdi>{profile.code}</bdi> — <span lang="ar" dir="rtl">{profile.nameAr}</span></h3>
          {/* The same N slogan supplies both fields: display the shared text once. */}
          {profile.descriptionAr !== profile.nameAr && <p lang="ar" dir="rtl">{profile.descriptionAr}</p>}
          {profile.descriptionEn && <p lang="en">{profile.descriptionEn}</p>}
        </article>)}
      </div>
    </section>

    <div className={styles.scoreLayout}>
      <section className={styles.panel} aria-label="Raw score chart">
        <figure className={styles.chart}>
          <figcaption>Four scores · raw points from 0 to 56</figcaption>
          <div role="img" aria-label={dimensions.map(dimension => `${dimension}: ${result.scores[dimension]} of 56`).join('; ')}>
            {dimensions.map(dimension => <div key={dimension} className={styles.chartRow} aria-hidden="true">
              <strong>{dimension}</strong>
              <div className={styles.track}><span className={styles.bar} style={{ width: `${result.scores[dimension] / 56 * 100}%` }} /></div>
              <span className={styles.value}>{result.scores[dimension]}</span>
            </div>)}
            <div className={styles.chartRow} aria-hidden="true">
              <span /><div className={styles.axis}>{[0, 14, 28, 42, 56].map(tick => <span key={tick}>{tick}</span>)}</div><span />
            </div>
          </div>
        </figure>
      </section>
      <section className={styles.panel} aria-label="Equal-score ranking groups">
        <h2>Score ranking</h2>
        <p className={styles.muted}>Dimensions in the same group share their rank.</p>
        <ol className={styles.ranking}>
          {result.scoreRanking.map(group => <li key={group.rank} value={group.rank}>
            <strong>Rank {group.rank}{group.dimensions.length > 1 ? ' (shared)' : ''}</strong>
            <div>{group.dimensions.join(' = ')} · {group.score} points</div>
          </li>)}
        </ol>
      </section>
    </div>

    <section className={styles.panel} aria-label="Score table">
      <table className={styles.table}>
        <caption>Four raw scores and shared ranks</caption>
        <thead><tr><th scope="col">Dimension</th><th scope="col">Points / 56</th><th scope="col">Rank</th></tr></thead>
        <tbody>{dimensions.map(dimension => <tr key={dimension}>
          <th scope="row">{dimension}</th><td>{result.scores[dimension]}</td>
          <td>{result.scoreRanking.find(group => group.dimensions.includes(dimension))?.rank ?? '—'}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Total points</th><td>{result.totalPoints}</td><td /></tr></tfoot>
      </table>
    </section>
    <p className={styles.muted}>Completed <time dateTime={result.completedAt}>{new Date(result.completedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>. This report shows your saved result.</p>
  </>;
}
