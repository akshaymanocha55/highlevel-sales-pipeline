import { useStore } from '../../store/context';
import { useTopic } from '../../store/hooks';

/** Screen-reader announcements for saves, failures and conflicts. */
export function LiveRegion() {
  const store = useStore();
  useTopic('meta');
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic>
      {/* the key re-mounts the text so an identical message is announced again */}
      <span key={store.announcement.n}>{store.announcement.text}</span>
    </div>
  );
}
