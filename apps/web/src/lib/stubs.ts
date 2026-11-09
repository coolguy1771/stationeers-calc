import { toast } from 'sonner';

/**
 * Uniform placeholder action for UI-01 stubs (7.1 project management, export,
 * editor tools). Every stub names the backlog item that will implement it so
 * reviewers know the affordance is intentional, not forgotten.
 */
export function stubbedAction(label: string, owner: string): void {
  toast.info(`TODO (${owner}): ${label}`, {
    description: 'Placeholder affordance — the real action lands with its owning backlog item.',
  });
}
