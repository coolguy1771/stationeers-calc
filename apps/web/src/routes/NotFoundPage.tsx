import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button';

export function NotFoundPage() {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="font-mono text-sm">404 — no such route</p>
      <p className="text-sm text-muted-foreground">This workspace path does not exist.</p>
      <Button asChild variant="outline">
        <Link to="/">Back to projects</Link>
      </Button>
    </div>
  );
}
