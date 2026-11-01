import { cx } from '../../lib/dom';
import { count } from '../../lib/format';
import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';
import { Button } from '../components';

/** Teammates' changes wait here instead of reshuffling the list under the user. */
export function UpdatesBanner() {
  const store = useStore();
  useTopic('meta');
  useTopic('view');
  const n = store.stale.size;
  if (store.viewError) {
    return (
      <div className="updates error" role="alert">
        <span>Couldn't load deals: {store.viewError}</span>
        <Button onClick={() => store.refreshView()}>Try again</Button>
      </div>
    );
  }
  return (
    <div className={cx('updates', n > 0 && 'has', store.viewLoading && 'loading')}>
      {store.viewLoading && <span className="loading-bar" aria-hidden />}
      {n ? (
        <>
          <span>
            ↻ <strong>{count(n)}</strong> {n === 1 ? 'deal has' : 'deals have'} changed since this list was loaded. The
            list won't move until you say so.
          </span>
          <Button onClick={() => store.refreshView()} shortcut="R">
            Show changes
          </Button>
        </>
      ) : (
        <span className="muted" role="status">
          {store.viewLoading && !store.viewIds.length
            ? 'Loading deals…'
            : `${count(store.viewIds.length)} deals in this view, loaded ${store.pageSize} at a time as you scroll. Teammates' edits appear live.`}
        </span>
      )}
    </div>
  );
}
