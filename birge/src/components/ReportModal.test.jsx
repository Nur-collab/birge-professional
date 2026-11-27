import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import '../i18n';
import ReportModal from './ReportModal';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({
  api: {
    submitReport: vi.fn(),
  },
}));

describe('ReportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('submits selected reason and details and shows confirmation', async () => {
    api.submitReport.mockResolvedValue({ id: 1, status: 'open' });
    const onClose = vi.fn();

    render(
      <ReportModal
        targetUser={{ id: 42, name: 'Марат' }}
        tripId={7}
        onClose={onClose}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Опасное вождение' }));
    fireEvent.change(screen.getByPlaceholderText('Опишите детали (необязательно)...'), {
      target: { value: 'Превышение скорости' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить жалобу' }));

    await waitFor(() => {
      expect(api.submitReport).toHaveBeenCalledWith({
        target_user_id: 42,
        trip_id: 7,
        reason: 'unsafe_driving',
        details: 'Превышение скорости',
      });
    });

    expect(await screen.findByText('Жалоба отправлена')).toBeInTheDocument();
  });
});
