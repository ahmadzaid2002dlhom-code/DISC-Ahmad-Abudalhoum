import type { ManagerSummary } from '../lib/staff-types';
import styles from './staff.module.css';

export default function ManagerMetrics({ summary }: { summary: ManagerSummary }) {
  return <section aria-label="Manager cohort metrics">
    <h2>Cohort overview</h2>
    <dl className={styles.metrics}>
      {[['Total invited (N)', summary.totalInvited], ['Completed (K)', summary.completed], ['Pending (P)', summary.pending],
        ['Completion', `${summary.completionPercentage.toFixed(2)}%`]].map(([label, value]) =>
        <div key={label} className={styles.metric}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <p>Completed includes SINGLE and TIED results. Pending includes INVITED and IN_PROGRESS.</p>
    {summary.totalInvited === 0 && <p>No invitations yet. Completion is 0%.</p>}
    <div className={styles.summaryGrid}>
      <section className={styles.panel} aria-label="Exclusive profile distribution">
        <h2>Profile distribution</h2>
        <p>Each completed participant counts once: one SINGLE code or TIED.</p>
        <ul className={styles.distribution} aria-label="Completed participants by category">
          {Object.entries(summary.distribution).map(([code, count]) => <li key={code}>
            <strong>{code}</strong>
            <div className={styles.track} aria-hidden="true"><span className={styles.bar} style={{ width: `${100 * count / Math.max(1, summary.completed)}%` }} /></div>
            <span aria-label={`${code}: ${count} participants`}>{count}</span>
          </li>)}
        </ul>
        <p>Distribution total: {Object.values(summary.distribution).reduce((sum, count) => sum + count, 0)} completed participants.</p>
      </section>
      <section className={styles.panel} aria-label="Completed score means">
        <h2>Mean scores</h2>
        {summary.means ? <>
          <p>All {summary.completed} completed results, including ties. Values rounded to two decimal places.</p>
          <table className={styles.table}>
            <caption>Mean raw points · 0–56 scale</caption>
            <thead><tr><th scope="col">Dimension</th><th scope="col">Mean / 56</th></tr></thead>
            <tbody>{(['D', 'I', 'S', 'C'] as const).map(d => <tr key={d}><th scope="row">{d}</th><td>{summary.means![d].toFixed(2)}</td></tr>)}</tbody>
          </table>
        </> : <p>No completed results. Score means are unavailable.</p>}
      </section>
    </div>
  </section>;
}
