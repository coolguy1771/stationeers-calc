// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StorageManagerLike } from '../../state/storageDurability';
import { StoragePanel } from './StoragePanel';

/**
 * The storage panel as the user meets it (spec 2.1, 11; backlog QA-02):
 * grant state, usage/quota in human terms, install state, the Safari eviction
 * warning, and an export escape hatch — with honest copy when the browser has
 * no Storage API at all (jsdom's own situation).
 */
afterEach(cleanup);

const granted: StorageManagerLike = {
  persisted: async () => true,
  persist: async () => true,
  estimate: async () => ({ usage: 1_500_000, quota: 60 * 1024 ** 3 }),
};

describe('storage panel (2.1)', () => {
  it('shows a granted origin with human-readable usage and quota', async () => {
    render(<StoragePanel api={granted} installed={false} />);

    expect(await screen.findByText('Granted')).toBeInTheDocument();
    expect(screen.getByTestId('storage-panel')).toHaveAttribute(
      'data-storage-persistence',
      'granted',
    );
    expect(await screen.findByTestId('storage-usage')).toHaveTextContent(
      '1.4 MB of 60 GB',
    );
    expect(screen.getByText('Browser tab')).toBeInTheDocument();
    expect(screen.getByText(/Safari may evict this data/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Request persistence/ }),
    ).toBeDisabled();
  });

  it('shows a refused grant as evictable and keeps the request action', async () => {
    render(
      <StoragePanel
        api={{ persisted: async () => false, persist: async () => false }}
        installed={false}
      />,
    );

    expect(
      await screen.findByText('Not granted — may be evicted'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Request persistence/ })).toBeEnabled();
    expect(screen.getByTestId('storage-usage')).toHaveTextContent(
      'unavailable of unavailable',
    );
  });

  it('warns when usage approaches the quota', async () => {
    render(
      <StoragePanel
        api={{
          persisted: async () => true,
          estimate: async () => ({ usage: 95, quota: 100 }),
        }}
        installed
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /of the quota is in use/,
    );
    expect(screen.getByText('Installed (standalone)')).toBeInTheDocument();
  });

  it('says the Storage API is missing instead of pretending zero usage', async () => {
    render(<StoragePanel api={undefined} installed={false} />);

    expect(await screen.findByText(/exposes no Storage API/)).toBeInTheDocument();
    expect(screen.getByTestId('storage-usage')).toHaveTextContent(
      'unavailable of unavailable',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('notes that the dev server registers no offline worker', async () => {
    render(<StoragePanel api={granted} installed={false} devServer />);
    expect(
      await screen.findByText(/Dev server: the offline worker is not registered/),
    ).toBeInTheDocument();
  });
});
