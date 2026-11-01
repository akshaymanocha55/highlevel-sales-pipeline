import { useEffect } from 'react';
import { cx } from '../../lib/dom';
import { count } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import type { Job, JobProgress } from '../../store/pipelineStore';
import { Button, IconButton, ProgressBar } from '../components';

export const AUTO_DISMISS_MS = 8000;
const MAX_VISIBLE = 3;

/** Bottom-left: progress, result and undo for each action, including bulk moves of thousands. */
export function ActivityStack() {
  const store = useStore();
  useTopic('meta');
  const visible = store.jobs.filter((j) => !j.dismissed).slice(0, MAX_VISIBLE);
  return (
    <div className="activity">
      {visible.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </div>
  );
}

export function jobStatus(job: Job, p: JobProgress): string {
  if (p.saving > 0) return p.total === 1 ? 'Saving…' : `${count(p.done)} of ${count(p.total)} saved…`;
  if (p.failed > 0 || p.conflicts > 0) {
    if (p.total === 1) return p.failed ? 'Not saved' : 'A teammate moved it too. Pick Mine or Theirs.';
    const parts = [`${count(p.done)} saved`];
    if (p.failed) parts.push(`${count(p.failed)} not saved`);
    if (p.conflicts) parts.push(`${count(p.conflicts)} moved by teammates, pick Mine or Theirs`);
    return parts.join(', ');
  }
  if (job.undone) return 'Undone';
  return p.total > 1 ? `All ${count(p.total)} saved` : 'Saved';
}

function JobCard({ job }: { job: Job }) {
  const store = useStore();
  const p = store.jobProgress(job);
  const running = p.saving > 0;
  const needsUser = p.failed + p.conflicts;

  // finished cleanly: fade out on its own. Failures and conflicts wait for the user.
  useEffect(() => {
    if (running || needsUser) return;
    const t = setTimeout(() => store.dismissJob(job.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [running, needsUser, job.id, store]);

  const pct = p.total ? Math.round(((p.done + needsUser) / p.total) * 100) : 100;
  const canUndo = job.kind === 'move' && !job.undone && p.done > 0;
  const failedIds = () =>
    job.ids.filter((id) => {
      const pending = store.getPending(id);
      return pending?.jobId === job.id && pending.status === 'failed';
    });

  return (
    <div className={cx('job', p.failed > 0 ? 'bad' : p.conflicts > 0 && 'warn')}>
      <div className="job-top">
        <span className="job-label">{job.label}</span>
        <IconButton label="Dismiss" onClick={() => store.dismissJob(job.id)} />
      </div>
      {p.total > 1 && <ProgressBar value={pct} label="Saved" />}
      <div className="job-bottom">
        <span className="muted">{jobStatus(job, p)}</span>
        {p.failed > 0 && <Button onClick={() => store.retry(failedIds())}>Retry failed</Button>}
        {canUndo && (
          <Button onClick={() => store.undo(job.id)} shortcut="Z">
            Undo
          </Button>
        )}
      </div>
    </div>
  );
}
