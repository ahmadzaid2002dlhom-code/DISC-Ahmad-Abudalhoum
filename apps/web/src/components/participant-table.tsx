import type { StaffParticipant } from '../lib/staff-types';
import styles from './staff.module.css';

export default function ParticipantTable({ participants }: { participants: StaffParticipant[] }) {
  return <section className={styles.panel} aria-label="Cohort participants">
    <h2>Participants</h2>
    {!participants.length ? <p>No invitations yet. Create the first invitation above.</p> : <>
      <p className={styles.muted}>Completed rows show saved results. Scroll the table horizontally on a small screen.</p>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Scrollable participant table">
        <table className={`${styles.table} ${styles.participants}`}>
          <caption>One shared demo cohort · {participants.length} participants</caption>
          <thead><tr><th scope="col">Participant</th><th scope="col">Status</th>
            {['D', 'I', 'S', 'C'].map(d => <th scope="col" key={d}>{d}</th>)}
            <th scope="col">Profile / source name</th><th scope="col">Report</th>
          </tr></thead>
          <tbody>{participants.map(participant => {
            const result = participant.status === 'COMPLETED' ? participant.result : null;
            return <tr key={participant.id}>
              <th scope="row">{participant.name}</th><td>{participant.status}</td>
              {(['D', 'I', 'S', 'C'] as const).map(d => <td key={d}>{result ? result.scores[d] : '—'}</td>)}
              <td>{result ? <>
                <strong>{result.profileStatus === 'TIED' ? `TIED — ${result.candidateProfileCodes.join(' / ')}` : `SINGLE — ${result.profileCode}`}</strong>
                <ul className={styles.profiles}>{result.candidateProfiles.map(p => <li key={p.code}>
                  <bdi>{p.code}</bdi> — <span lang="ar" dir="rtl">{p.nameAr}</span>
                </li>)}</ul>
              </> : 'Pending'}</td>
              <td>{result ? <a href={`/staff/participants/${participant.id}/report`} aria-label={`Full report for ${participant.name}`}>Full report</a> : 'Not available'}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
