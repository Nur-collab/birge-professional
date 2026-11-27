import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import '../i18n';
import Settings from './Settings';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({
  api: {
    updateProfile: vi.fn(),
    exportMyData: vi.fn(),
    deleteAccount: vi.fn(),
  },
}));

describe('Settings privacy export and account deletion', () => {
  const user = {
    id: 1,
    name: 'Айбек',
    phone: '+996555123456',
    is_verified: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('exports user data and revokes created object URL', async () => {
    api.exportMyData.mockResolvedValue({ exported_at: '2026-11-27T00:00:00Z', profile: user });
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:birge-export');
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    try {
      render(<Settings currentUser={user} onBack={vi.fn()} onUpdate={vi.fn()} onAccountDeleted={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Скачать мои данные (JSON)' }));

      expect(await screen.findByText('Архив данных в формате JSON скачан')).toBeInTheDocument();
      expect(api.exportMyData).toHaveBeenCalledTimes(1);
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:birge-export');
    } finally {
      clickSpy.mockRestore();
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  test('requires explicit confirmation before deleting account and handles 409 error', async () => {
    const onAccountDeleted = vi.fn();
    const err409 = Object.assign(new Error('Active trip in progress'), { status: 409 });
    api.deleteAccount.mockRejectedValueOnce(err409).mockResolvedValueOnce({ ok: true, deleted: true });

    render(<Settings currentUser={user} onBack={vi.fn()} onUpdate={vi.fn()} onAccountDeleted={onAccountDeleted} />);

    fireEvent.click(screen.getByRole('button', { name: 'Удалить аккаунт' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: 'Удалить навсегда' });
    expect(confirmBtn).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Я понимаю, что восстановить удалённый аккаунт невозможно'));
    expect(confirmBtn).not.toBeDisabled();

    fireEvent.click(confirmBtn);
    expect(await screen.findByText('Сначала завершите или отмените текущую поездку в пути')).toBeInTheDocument();
    expect(onAccountDeleted).not.toHaveBeenCalled();

    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(onAccountDeleted).toHaveBeenCalledTimes(1);
    });
  });
});
