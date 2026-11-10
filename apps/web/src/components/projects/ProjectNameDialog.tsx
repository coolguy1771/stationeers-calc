import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { validateProjectName } from '../../state/projectLibrary';

/**
 * Name dialog shared by create, rename, import-naming and snapshots (7.1).
 *
 * The field is validated with the same rule the actions use
 * (`validateProjectName`: control characters stripped per 9.4, trimmed,
 * non-empty, length-bounded), so the dialog cannot submit a name the store or
 * the bundle schema would reject.
 */
export interface ProjectNameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly initialValue?: string;
  readonly submitLabel: string;
  readonly placeholder?: string;
  /** Called with the validated name; the dialog closes on submit. */
  readonly onSubmit: (name: string) => void;
}

export function ProjectNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue = '',
  submitLabel,
  placeholder = 'e.g. Atmospherics — starter base',
  onSubmit,
}: ProjectNameDialogProps) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the field each time the dialog opens (rename targets change).
  useEffect(() => {
    if (!open) return;
    setName(initialValue);
    setError(null);
  }, [open, initialValue]);

  const validation = validateProjectName(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!validation.ok) {
              setError(validation.message);
              return;
            }
            onSubmit(validation.name);
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className="mt-3 flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              autoFocus
              placeholder={placeholder}
              aria-invalid={error !== null}
              aria-describedby={error ? 'project-name-error' : undefined}
            />
            {error ? (
              <p id="project-name-error" role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={name.trim().length === 0}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
