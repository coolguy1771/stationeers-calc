// @vitest-environment jsdom
import '../../test/flowEnvironment';
import { mouseEventWithView } from '../../test/flowEnvironment';
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../App';
import { cancelScheduledNodePositions, flushNodePositions } from '../../state/schematicLayout';
import { stopPersistence } from '../../state/persistence';
import { projectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';

const PROJECT_ID = projectStore.state.meta.id;
const SCHEMATIC_PATH = `/project/${PROJECT_ID}/schematic`;

function renderSchematic() {
  return render(
    <MemoryRouter initialEntries={[SCHEMATIC_PATH]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

function handleFor(instanceId: string, portId: string): HTMLElement {
  const handle = document.querySelector<HTMLElement>(
    `[data-nodeid="${instanceId}"][data-handleid="${portId}"]`,
  );
  if (handle === null) throw new Error(`No handle ${instanceId}:${portId}`);
  return handle;
}

function nodeFor(instanceId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${instanceId}"]`);
}

afterEach(() => {
  cleanup();
  stopPersistence();
  cancelScheduledNodePositions();
  // The module-level canonical store is shared across this file's tests.
  while (projectStore.canUndo) projectStore.undo();
  useUiStore.getState().setSelection(null);
});

/**
 * The schematic editor against the canonical store (UI-02): nodes and intents
 * are projections of one project, and every authoring action is an undoable
 * command (2.2.1, 3.4).
 */
describe('schematic editor — typed instances and intents (UI-02)', () => {
  it('adds an unplaced instance from the catalog palette, and undo removes it (SYNC-001)', async () => {
    const user = userEvent.setup();
    renderSchematic();
    const countBefore = projectStore.state.devices.length;

    await user.click(screen.getByRole('button', { name: 'Add Digital Valve' }));

    expect(projectStore.state.devices).toHaveLength(countBefore + 1);
    const added = projectStore.state.devices[projectStore.state.devices.length - 1]!;
    expect(added.definitionId).toBe('mock.digital-valve');
    // SYNC-001: adding a schematic component creates an unplaced component.
    expect(added.placementId).toBeUndefined();
    expect(added.ports.map((port) => port.definitionId)).toEqual([
      'mock.port.dv.in',
      'mock.port.dv.out',
    ]);

    const node = nodeFor(added.id);
    expect(node).toBeInTheDocument();
    expect(node).toHaveTextContent('unplaced');
    expect(node).toHaveTextContent('Digital Valve');

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(projectStore.state.devices).toHaveLength(countBefore);
    expect(nodeFor(added.id)).toBeNull();
  });

  it('creates an intent by clicking two same-medium port handles, shown as Unrouted and undone in one step', async () => {
    const user = userEvent.setup();
    renderSchematic();
    const countBefore = projectStore.state.intents.length;

    fireEvent.click(handleFor('mock.inst.active-vent-1', 'mock.port.av1.gas'));
    fireEvent.click(handleFor('mock.inst.mixer-1', 'mock.port.gm1.out'));

    expect(projectStore.state.intents).toHaveLength(countBefore + 1);
    const created = projectStore.state.intents[projectStore.state.intents.length - 1]!;
    expect(created.medium).toBe('gas-pipe');
    expect(created.from).toEqual({ instanceId: 'mock.inst.active-vent-1', portId: 'mock.port.av1.gas' });
    expect(created.to).toEqual({ instanceId: 'mock.inst.mixer-1', portId: 'mock.port.gm1.out' });

    // Derived status only: the chip says Unrouted and the intent stores no status (9.1).
    expect(document.querySelectorAll('[data-intent-status="unrouted"]')).toHaveLength(2);
    expect(created).not.toHaveProperty('status');
    expect(screen.getByRole('status')).toHaveTextContent(/Intent created/i);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(projectStore.state.intents).toHaveLength(countBefore);
  });

  it('refuses to connect two different media and creates no intent (4.3)', () => {
    renderSchematic();
    const countBefore = projectStore.state.intents.length;

    fireEvent.click(handleFor('mock.inst.active-vent-1', 'mock.port.av1.power'));
    fireEvent.click(handleFor('mock.inst.mixer-1', 'mock.port.gm1.in-a'));

    expect(projectStore.state.intents).toHaveLength(countBefore);
    const feedback = screen.getByRole('status');
    expect(feedback).toHaveTextContent(/media must match/i);
    expect(feedback).toHaveAttribute('data-connection-feedback', 'error');
  });

  it('deletes a device and its intents in one command, and one undo restores both (SYNC-012/013)', async () => {
    const user = userEvent.setup();
    renderSchematic();
    const device = projectStore.state.devices.find(
      (candidate) => candidate.id === 'mock.inst.active-vent-1',
    )!;
    const intentIds = projectStore.state.intents
      .filter((intent) => intent.from.instanceId === device.id || intent.to.instanceId === device.id)
      .map((intent) => intent.id);
    expect(intentIds.length).toBeGreaterThan(0);
    const revisionBefore = projectStore.revision;

    // Select through the shared instance chip, then use the inspector (SYNC-004).
    await user.click(screen.getByRole('button', { name: 'Active Vent' }));
    await user.click(screen.getByRole('button', { name: 'Delete instance Active Vent' }));

    // Confirmation because the instance owns intents and settings (SYNC-011/012).
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(/SYNC-013/);
    await user.click(screen.getByRole('button', { name: 'Delete device' }));

    expect(projectStore.state.devices.some((candidate) => candidate.id === device.id)).toBe(false);
    for (const intentId of intentIds) {
      expect(projectStore.state.intents.some((intent) => intent.id === intentId)).toBe(false);
    }
    // One command, not one per cascaded intent.
    expect(projectStore.revision).toBe(revisionBefore + 1);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(projectStore.state.devices.some((candidate) => candidate.id === device.id)).toBe(true);
    for (const intentId of intentIds) {
      expect(projectStore.state.intents.some((intent) => intent.id === intentId)).toBe(true);
    }
  });

  it('selects a node on the canvas and drives the shared selection + inspector (SYNC-004)', () => {
    renderSchematic();
    expect(useUiStore.getState().selection).toBeNull();

    const node = nodeFor('mock.inst.mixer-1');
    expect(node).not.toBeNull();
    fireEvent.click(node!);

    expect(useUiStore.getState().selection).toEqual({
      kind: 'device-instance',
      id: 'mock.inst.mixer-1',
    });
    // The inspector follows the same shared selection.
    expect(screen.getByRole('button', { name: 'Delete instance Gas Mixer' })).toBeInTheDocument();
  });

  it('deletes the selected intent with the Delete key and undo restores it', async () => {
    const user = userEvent.setup();
    renderSchematic();
    const intent = projectStore.state.intents[0]!;

    await user.click(screen.getByRole('button', { name: intent.label! }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'intent', id: intent.id });

    await user.keyboard('{Delete}');
    expect(projectStore.state.intents.some((candidate) => candidate.id === intent.id)).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(projectStore.state.intents.some((candidate) => candidate.id === intent.id)).toBe(true);
  });

  it('persists a dragged node position to schematicLayout through a command', async () => {
    const user = userEvent.setup();
    renderSchematic();
    const instanceId = 'mock.inst.active-vent-1';
    const revisionBefore = projectStore.revision;
    const node = nodeFor(instanceId);
    expect(node).not.toBeNull();
    expect(projectStore.state.schematicLayout.nodePositions[instanceId]).toBeUndefined();

    // React Flow starts the node drag once the pointer passes its threshold,
    // so the first move starts it and the second one actually moves the node.
    fireEvent(node!, mouseEventWithView('mousedown', { clientX: 20, clientY: 30 }));
    fireEvent(window, mouseEventWithView('mousemove', { clientX: 21, clientY: 31 }));
    fireEvent(window, mouseEventWithView('mousemove', { clientX: 141, clientY: 111 }));
    fireEvent(window, mouseEventWithView('mouseup', { clientX: 141, clientY: 111 }));

    // The canvas debounces; the test flushes the same queue it uses.
    act(() => flushNodePositions());
    const position = projectStore.state.schematicLayout.nodePositions[instanceId];
    expect(position).toEqual({ x: 120, y: 80 });
    expect(projectStore.revision).toBe(revisionBefore + 1);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(projectStore.state.schematicLayout.nodePositions[instanceId]).toBeUndefined();
  });

  it('renders the intent in the panel with Routed when a physical connection exists (SYNC-005)', () => {
    const intent = projectStore.state.intents[0]!;
    const result = projectStore.dispatch({
      type: 'addEntity',
      collection: 'connections',
      entity: {
        id: 'mock.conn.routed',
        medium: 'gas-pipe',
        elements: [],
        endpoints: [intent.from, intent.to],
      },
    });
    expect(result.ok).toBe(true);

    renderSchematic();
    expect(document.querySelector('[data-intent-status="routed"]')).toBeInTheDocument();
    expect(document.querySelector('[data-intent-status="unrouted"]')).not.toBeInTheDocument();
    // A routed intent needs no CONN-UNROUTED diagnostic.
    expect(screen.queryByText('CONN-UNROUTED')).not.toBeInTheDocument();
  });
});
